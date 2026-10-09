// POST /api/test — envia uma notificação de teste para este aparelho
import { body, keys, onlyMethod, redis, sendPush, subId } from '../lib/server.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, 'POST')) return;
  const { endpoint } = body(req);
  if (typeof endpoint !== 'string' || !endpoint) return res.status(400).json({ error: 'Endpoint ausente' });
  try {
    const id = subId(endpoint);
    const record = await redis().get(keys.sub(id));
    if (!record) return res.status(404).json({ error: 'Aparelho não inscrito. Desative e ative de novo.' });
    const ok = await sendPush(id, record.subscription, {
      title: 'Dose Diária',
      body: 'Teste ok! Os lembretes vão chegar assim. ✅',
      tag: 'dose-test',
      url: '/',
    });
    if (!ok) return res.status(502).json({ error: 'O serviço de push recusou o envio' });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
