// Lógica pura de agendamento (sem Redis/rede) — testada em tests/schedule.test.js

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MINUTE = 60_000;
export const MAX_CATCHUP_MIN = 15; // se o cron atrasar, recupera até 15 min de lembretes

const formatters = new Map();
function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatters.get(tz);
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { formatter(tz); return true; } catch { return false; }
}

/** Data e hora local ("YYYY-MM-DD", "HH:MM") de um instante num fuso. */
export function localParts(ms, tz) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/**
 * Minutos (em ms, alinhados ao minuto) a processar nesta execução:
 * todos depois de lastRunMs até nowMs, limitado a MAX_CATCHUP_MIN.
 */
export function minutesToProcess(lastRunMs, nowMs) {
  const end = Math.floor(nowMs / MINUTE) * MINUTE;
  const minStart = end - (MAX_CATCHUP_MIN - 1) * MINUTE;
  let start = Number.isFinite(lastRunMs) && lastRunMs > 0 ? Math.floor(lastRunMs / MINUTE) * MINUTE + MINUTE : end;
  if (start < minStart) start = minStart;
  if (start > end) start = end; // rodou de novo no mesmo minuto: reprocessa (o Redis evita duplicar)
  const out = [];
  for (let m = start; m <= end; m += MINUTE) out.push(m);
  return out;
}

/**
 * Agrupa os lembretes que vencem nos minutos informados, no fuso do usuário.
 * Retorna [{ date, time, reminders: [...] }].
 */
export function dueGroups(reminders, tz, minutes) {
  const slots = new Map();
  for (const m of minutes) {
    const { date, time } = localParts(m, tz);
    slots.set(time, date);
  }
  const groups = new Map();
  for (const r of reminders) {
    if (!slots.has(r.time)) continue;
    const key = `${slots.get(r.time)} ${r.time}`;
    if (!groups.has(key)) groups.set(key, { date: slots.get(r.time), time: r.time, reminders: [] });
    groups.get(key).reminders.push(r);
  }
  return [...groups.values()];
}

/** Monta o conteúdo da notificação para um grupo de lembretes no mesmo horário. */
export function buildPayload(group) {
  const parts = group.reminders.map((r) => (r.doses > 1 ? `${r.label} (dose ${r.dose})` : r.label));
  return {
    title: `Hora da dose · ${group.time}`,
    body: parts.join(' · '),
    tag: `dose-${group.date}-${group.time}`,
    url: '/',
  };
}

/** Valida e limpa a lista de lembretes enviada pelo app. */
export function sanitizeReminders(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const r of input.slice(0, 60)) {
    if (!r || !TIME_RE.test(r.time) || typeof r.label !== 'string') return null;
    const dose = Number.isInteger(r.dose) && r.dose >= 1 && r.dose <= 6 ? r.dose : 1;
    const doses = Number.isInteger(r.doses) && r.doses >= 1 && r.doses <= 6 ? r.doses : 1;
    out.push({ time: r.time, label: Array.from(r.label).slice(0, 50).join(''), dose, doses });
  }
  return out;
}

// Só aceita endpoints dos serviços de push oficiais (evita o servidor ser usado para chamar URLs arbitrárias)
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export function isAllowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

/** Valida o objeto PushSubscription (toJSON) enviado pelo navegador. */
export function sanitizeSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || !isAllowedEndpoint(s.endpoint)) return null;
  if (!s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return null;
  if (s.keys.p256dh.length > 200 || s.keys.auth.length > 100) return null;
  return { endpoint: s.endpoint, expirationTime: s.expirationTime ?? null, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}
