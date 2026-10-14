import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import webpush from 'web-push';

// A integração Upstash da Vercel pode criar as variáveis com prefixo KV_ ou UPSTASH_REDIS_
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let redisClient;
export function redis() {
  if (!url || !token) throw new Error('Upstash Redis não configurado (variáveis de ambiente ausentes)');
  redisClient ||= new Redis({ url, token });
  return redisClient;
}

let vapidReady = false;
export function push() {
  if (!vapidReady) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) throw new Error('Chaves VAPID não configuradas');
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  }
  return webpush;
}

export const MAX_SUBSCRIPTIONS = 100; // limita quantos aparelhos podem ativar lembretes (protege a cota gratuita do Redis)

export const keys = {
  subs: 'dd:subs',
  sub: (id) => `dd:sub:${id}`,
  lastRun: 'dd:cron:last',
  sent: (id, date, time) => `dd:sent:${id}:${date}:${time}`,
};

export const subId = (endpoint) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export function onlyMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  res.status(405).json({ error: 'Método não permitido' });
  return false;
}

export async function removeSubscription(id) {
  const r = redis();
  await Promise.all([r.srem(keys.subs, id), r.del(keys.sub(id))]);
}

/** Envia um push; remove a inscrição se o serviço disser que ela expirou. */
export async function sendPush(id, subscription, payload) {
  try {
    await push().sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await removeSubscription(id);
    } else {
      console.error('Falha no push', id, err.statusCode, err.body || err.message);
    }
    return false;
  }
}
