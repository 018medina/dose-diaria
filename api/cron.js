// GET /api/cron — chamado a cada minuto pelo cron-job.org.
// Protegido pelo cabeçalho  Authorization: Bearer <CRON_SECRET>
import { timingSafeEqual } from 'node:crypto';
import { buildPayload, dueGroups, minutesToProcess } from '../lib/schedule.js';
import { keys, redis, sendPush } from '../lib/server.js';

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const r = redis();
    const now = Date.now();
    const lastRun = Number(await r.get(keys.lastRun)) || 0;
    const minutes = minutesToProcess(lastRun, now);
    const ids = await r.smembers(keys.subs);
    if (!ids.length) {
      await r.set(keys.lastRun, minutes[minutes.length - 1]);
      return res.status(200).json({ ok: true, subscriptions: 0, sent: 0 });
    }

    const records = await r.mget(...ids.map(keys.sub));
    let sent = 0;
    await Promise.all(ids.map(async (id, i) => {
      const rec = records[i];
      if (!rec) { await r.srem(keys.subs, id); return; }
      for (const group of dueGroups(rec.reminders || [], rec.timezone, minutes)) {
        // evita notificação duplicada se o cron rodar duas vezes no mesmo minuto
        const first = await r.set(keys.sent(id, group.date, group.time), 1, { nx: true, ex: 7200 });
        if (!first) continue;
        if (await sendPush(id, rec.subscription, buildPayload(group))) sent++;
      }
    }));
    // só avança depois de processar: se algo falhar, a próxima execução recupera (sem duplicar, graças ao NX)
    await r.set(keys.lastRun, minutes[minutes.length - 1]);

    res.status(200).json({ ok: true, subscriptions: ids.length, minutes: minutes.length, sent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no servidor' });
  }
}
