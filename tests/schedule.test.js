import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPayload, dueGroups, isAllowedEndpoint, isValidTimeZone, localParts,
  minutesToProcess, sanitizeReminders, sanitizeSubscription,
} from '../lib/schedule.js';

const TZ = 'America/Sao_Paulo';
// 2026-10-09 08:00 em São Paulo (UTC-3) = 11:00 UTC
const at = (iso) => Date.parse(iso);

test('localParts converte para o fuso do usuário', () => {
  assert.deepEqual(localParts(at('2026-10-09T11:00:30Z'), TZ), { date: '2026-10-09', time: '08:00' });
  assert.deepEqual(localParts(at('2026-10-10T02:59:00Z'), TZ), { date: '2026-10-09', time: '23:59' });
});

test('minutesToProcess: primeira execução processa só o minuto atual', () => {
  const now = at('2026-10-09T11:00:42Z');
  assert.deepEqual(minutesToProcess(0, now), [at('2026-10-09T11:00:00Z')]);
});

test('minutesToProcess: recupera minutos perdidos e não repete o último', () => {
  const last = at('2026-10-09T10:57:00Z');
  const now = at('2026-10-09T11:00:05Z');
  assert.deepEqual(minutesToProcess(last, now), [
    at('2026-10-09T10:58:00Z'), at('2026-10-09T10:59:00Z'), at('2026-10-09T11:00:00Z'),
  ]);
});

test('minutesToProcess: limita a recuperação a 15 minutos', () => {
  const now = at('2026-10-09T11:00:00Z');
  const mins = minutesToProcess(at('2026-10-09T05:00:00Z'), now);
  assert.equal(mins.length, 15);
  assert.equal(mins[mins.length - 1], now);
});

test('minutesToProcess: mesmo minuto de novo continua processando o minuto atual (dedupe fica no Redis)', () => {
  const now = at('2026-10-09T11:00:50Z');
  assert.deepEqual(minutesToProcess(at('2026-10-09T11:00:00Z'), now), [at('2026-10-09T11:00:00Z')]);
});

test('dueGroups agrupa lembretes no mesmo horário e respeita o fuso', () => {
  const reminders = [
    { time: '08:00', label: '💊 Remédio', dose: 1, doses: 2 },
    { time: '08:00', label: '💪 Creatina', dose: 1, doses: 1 },
    { time: '20:00', label: '💊 Remédio', dose: 2, doses: 2 },
  ];
  const groups = dueGroups(reminders, TZ, [at('2026-10-09T11:00:00Z')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].date, '2026-10-09');
  assert.equal(groups[0].reminders.length, 2);
  const p = buildPayload(groups[0]);
  assert.equal(p.title, 'Hora da dose · 08:00');
  assert.equal(p.body, '💊 Remédio (dose 1) · 💪 Creatina');
  assert.equal(p.tag, 'dose-2026-10-09-08:00');
});

test('dueGroups: nada vence fora do horário', () => {
  const groups = dueGroups([{ time: '08:00', label: 'x', dose: 1, doses: 1 }], TZ, [at('2026-10-09T11:01:00Z')]);
  assert.equal(groups.length, 0);
});

test('dueGroups: lembrete às 23:59 pertence ao dia local certo', () => {
  const groups = dueGroups([{ time: '23:59', label: 'x', dose: 1, doses: 1 }], TZ, [at('2026-10-10T02:59:00Z')]);
  assert.equal(groups[0].date, '2026-10-09');
});

test('sanitizeReminders rejeita horários inválidos e corta rótulos', () => {
  assert.equal(sanitizeReminders([{ time: '25:00', label: 'x' }]), null);
  assert.equal(sanitizeReminders('nope'), null);
  const ok = sanitizeReminders([{ time: '07:30', label: 'a'.repeat(80), dose: 9, doses: 2 }]);
  assert.equal(ok[0].label.length, 50);
  assert.equal(ok[0].dose, 1);
  assert.equal(ok[0].doses, 2);
});

test('sanitizeSubscription aceita só serviços de push oficiais', () => {
  const keys = { p256dh: 'BKey', auth: 'auth' };
  assert.ok(sanitizeSubscription({ endpoint: 'https://web.push.apple.com/QAbc', keys }));
  assert.ok(sanitizeSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }));
  assert.equal(sanitizeSubscription({ endpoint: 'https://evil.example.com/x', keys }), null);
  assert.equal(sanitizeSubscription({ endpoint: 'http://web.push.apple.com/x', keys }), null);
  assert.equal(sanitizeSubscription({ endpoint: 'https://web.push.apple.com/x' }), null);
  assert.equal(isAllowedEndpoint('https://wns2-par02p.notify.windows.com/w/?token=1'), true);
});

test('isValidTimeZone', () => {
  assert.equal(isValidTimeZone(TZ), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  assert.equal(isValidTimeZone(''), false);
});
