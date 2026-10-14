// POST /api/subscribe — salva/atualiza a inscrição de push e os horários dos lembretes
import { isValidTimeZone, sanitizeReminders, sanitizeSubscription } from '../lib/schedule.js';
import { body, keys, MAX_SUBSCRIPTIONS, onlyMethod, redis, subId } from '../lib/server.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, 'POST')) return;
  const data = body(req);
  const subscription = sanitizeSubscription(data.subscription);
  const reminders = sanitizeReminders(data.reminders);
  if (!subscription) return res.status(400).json({ error: 'Inscrição inválida' });
  if (!reminders) return res.status(400).json({ error: 'Lembretes inválidos' });
  if (!isValidTimeZone(data.timezone)) return res.status(400).json({ error: 'Fuso horário inválido' });

  try {
    const r = redis();
    const id = subId(subscription.endpoint);
    const exists = await r.sismember(keys.subs, id);
    if (!exists && (await r.scard(keys.subs)) >= MAX_SUBSCRIPTIONS) {
      return res.status(403).json({ error: 'As vagas de lembretes estão esgotadas no momento', code: 'limit' });
    }
    await r.set(keys.sub(id), { subscription, timezone: data.timezone, reminders, updatedAt: Date.now() });
    if (!exists) await r.sadd(keys.subs, id);
    res.status(200).json({ ok: true, reminders: reminders.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no servidor' });
  }
}
