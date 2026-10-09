// POST /api/unsubscribe — remove a inscrição deste aparelho
import { body, onlyMethod, removeSubscription, subId } from '../lib/server.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, 'POST')) return;
  const { endpoint } = body(req);
  if (typeof endpoint !== 'string' || !endpoint) return res.status(400).json({ error: 'Endpoint ausente' });
  try {
    await removeSubscription(subId(endpoint));
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no servidor' });
  }
}
