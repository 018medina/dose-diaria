'use strict';

/* =========================================================
   Dose Diária — dados 100% no LocalStorage deste aparelho.
   O servidor só recebe os horários dos lembretes (push).
   ========================================================= */

const APP_VERSION = '1.0.1';
const STORAGE_KEY = 'dose-diaria:v1';
const BACKUP_KEY = 'dose-diaria:last-export';
const MAX_DOSES = 6;
const ALWAYS = '0000-01-01';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- utilitários ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clipChars = (s, n) => Array.from(String(s)).slice(0, n).join('');
const fmtLong = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtMonth = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHEV_SVG = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

/* ---------- estado ---------- */
function defaultState() {
  return {
    version: 1,
    startDate: dateKey(),
    items: [
      { id: uid(), name: 'Remédio', emoji: '💊', createdAt: null, archivedAt: null, doseHistory: [{ from: ALWAYS, doses: 1 }], times: [''] },
      { id: uid(), name: 'Creatina', emoji: '💪', createdAt: null, archivedAt: null, doseHistory: [{ from: ALWAYS, doses: 1 }], times: [''] },
    ],
    log: {},
    push: { enabled: false, pendingSync: false },
  };
}

/** Valida e normaliza um estado (vindo do LocalStorage ou de um backup). Lança erro se for inválido. */
function normalizeState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.items) || !s.log || typeof s.log !== 'object') {
    throw new Error('Formato inválido');
  }
  const items = s.items.map((it) => {
    if (!it || typeof it.id !== 'string' || typeof it.name !== 'string') throw new Error('Item inválido');
    const hist = (Array.isArray(it.doseHistory) ? it.doseHistory : [])
      .filter((h) => h && typeof h.from === 'string' && Number.isInteger(h.doses) && h.doses >= 1 && h.doses <= MAX_DOSES)
      .sort((a, b) => a.from.localeCompare(b.from));
    if (!hist.length) hist.push({ from: ALWAYS, doses: 1 });
    const doses = hist[hist.length - 1].doses;
    return {
      id: it.id,
      name: clipChars(it.name.trim(), 40) || 'Item',
      emoji: typeof it.emoji === 'string' ? clipChars(it.emoji, 4) : '',
      createdAt: DATE_RE.test(it.createdAt) ? it.createdAt : null,
      archivedAt: DATE_RE.test(it.archivedAt) ? it.archivedAt : null,
      doseHistory: hist,
      times: Array.from({ length: doses }, (_, i) => (TIME_RE.test(it.times?.[i]) ? it.times[i] : '')),
    };
  });
  const log = {};
  for (const [k, day] of Object.entries(s.log)) {
    if (!DATE_RE.test(k) || !day || typeof day !== 'object') continue;
    for (const [id, rec] of Object.entries(day)) {
      if (!rec || typeof rec !== 'object') continue;
      for (const [i, v] of Object.entries(rec)) {
        if (!/^\d+$/.test(i) || !v || typeof v !== 'object') continue;
        ((log[k] ||= {})[id] ||= {})[i] = { at: TIME_RE.test(v.at) ? v.at : null };
      }
    }
  }
  return {
    version: 1,
    startDate: DATE_RE.test(s.startDate) ? s.startDate : dateKey(),
    items,
    log,
    push: { enabled: !!s.push?.enabled, pendingSync: !!s.push?.pendingSync },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch (e) {
    console.error('Falha ao ler dados', e);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Não foi possível salvar no aparelho');
  }
}

let state = loadState();
const ui = {
  tab: 'day',
  date: dateKey(),
  month: dateKey().slice(0, 7),
  editingItemId: null,
  dose: null, // { itemId, index, date }
};

/* ---------- regras ---------- */
const activeItems = () => state.items.filter((it) => !it.archivedAt);
const currentDoses = (it) => it.doseHistory[it.doseHistory.length - 1].doses;

function itemsForDay(k) {
  return state.items.filter((it) => (!it.createdAt || it.createdAt <= k) && (!it.archivedAt || it.archivedAt > k));
}

function dosesFor(it, k) {
  let n = it.doseHistory[0].doses;
  for (const h of it.doseHistory) if (h.from <= k) n = h.doses;
  return n;
}

const getRec = (k, itemId, i) => state.log[k]?.[itemId]?.[i] || null;

function setRec(k, itemId, i, value) {
  if (value) {
    ((state.log[k] ||= {})[itemId] ||= {})[i] = value;
    if (k < state.startDate) state.startDate = k;
  } else if (state.log[k]?.[itemId]) {
    delete state.log[k][itemId][i];
    if (!Object.keys(state.log[k][itemId]).length) delete state.log[k][itemId];
    if (!Object.keys(state.log[k]).length) delete state.log[k];
  }
  saveState();
}

function dayCounts(k) {
  let expected = 0;
  let done = 0;
  for (const it of itemsForDay(k)) {
    const n = dosesFor(it, k);
    expected += n;
    for (let i = 0; i < n; i++) if (getRec(k, it.id, i)) done++;
  }
  return { expected, done };
}

/** full | partial | empty | none (sem itens) | before (antes de começar a usar) | future */
function dayStatus(k, today = dateKey()) {
  if (k > today) return 'future';
  if (k < state.startDate) return 'before';
  const { expected, done } = dayCounts(k);
  if (!expected) return 'none';
  if (done >= expected) return 'full';
  return done ? 'partial' : 'empty';
}

function streak() {
  const today = dateKey();
  let k = dayStatus(today, today) === 'full' ? today : addDays(today, -1);
  let n = 0;
  for (let guard = 0; guard < 3660; guard++) {
    if (dayStatus(k, today) !== 'full') break;
    n++;
    k = addDays(k, -1);
  }
  return n;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- navegação ---------- */
function setTab(tab) {
  ui.tab = tab;
  for (const v of ['day', 'history', 'settings']) $(`#view-${v}`).hidden = v !== tab;
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (ui.tab === 'day') renderDay();
  else if (ui.tab === 'history') renderHistory();
  else renderSettings();
}

/* ---------- tela: dia ---------- */
function renderDay() {
  const today = dateKey();
  if (ui.date > today) ui.date = today;
  const k = ui.date;

  $('#day-title').textContent = k === today ? 'Hoje' : k === addDays(today, -1) ? 'Ontem' : fmtLong.format(parseKey(k)).split(',')[0];
  $('#day-sub').textContent = fmtLong.format(parseKey(k));
  $('#day-next').disabled = k >= today;
  $('#go-today').hidden = k === today;

  const { expected, done } = dayCounts(k);
  const pct = expected ? done / expected : 0;
  $('#ring-fg').style.strokeDashoffset = String(97.4 * (1 - pct));
  $('#ring-label').textContent = `${done}/${expected}`;
  if (!expected) {
    $('#progress-title').textContent = 'Nada para este dia';
    $('#progress-sub').textContent = 'Adicione itens em Ajustes.';
  } else if (done >= expected) {
    $('#progress-title').textContent = 'Tudo tomado ✓';
    $('#progress-sub').textContent = k === today ? 'Pode ficar tranquilo hoje.' : 'Dia completo.';
  } else {
    const left = expected - done;
    $('#progress-title').textContent = `${left} ${left === 1 ? 'dose pendente' : 'doses pendentes'}`;
    $('#progress-sub').textContent = k === today ? 'Toque na dose quando tomar.' : 'Toque para marcar retroativamente.';
  }

  const items = itemsForDay(k);
  const box = $('#day-items');
  if (!items.length) {
    box.innerHTML = '<div class="card empty-state">Nenhum item cadastrado.<br>Vá em <strong>Ajustes</strong> para adicionar.</div>';
    return;
  }
  const now = nowHM();
  box.innerHTML = items.map((it) => {
    const n = dosesFor(it, k);
    let taken = 0;
    const doses = Array.from({ length: n }, (_, i) => {
      const rec = getRec(k, it.id, i);
      if (rec) taken++;
      const label = n === 1 ? (rec ? 'Tomado' : 'Não tomado') : `Dose ${i + 1}`;
      const time = k === today ? it.times[i] : '';
      let sub;
      if (rec) sub = rec.at ? `${n === 1 ? 'Às' : 'Tomado às'} ${rec.at}` : 'Horário não informado';
      else if (time) sub = time <= now ? `Era às ${time}` : `Lembrete às ${time}`;
      else sub = 'Toque para marcar';
      const late = !rec && time && time <= now;
      return `<button class="dose${rec ? ' taken' : ''}${late ? ' late' : ''}" data-item="${esc(it.id)}" data-dose="${i}" aria-pressed="${!!rec}">
        <span class="dose-check">${CHECK_SVG}</span>
        <span class="dose-text"><strong>${label}</strong><small>${esc(sub)}</small></span>
      </button>`;
    }).join('');
    return `<article class="card item-card">
      <div class="item-head">
        <span class="item-emoji" aria-hidden="true">${esc(it.emoji)}</span>
        <h2>${esc(it.name)}</h2>
        ${n > 1 ? `<span class="count">${taken}/${n}</span>` : ''}
      </div>
      <div class="doses">${doses}</div>
    </article>`;
  }).join('');
}

// Ignora um segundo toque logo depois de marcar (evita marcar e já abrir o "desmarcar")
let lastMark = { key: '', at: 0 };

function onDoseTap(itemId, index) {
  const k = ui.date;
  const it = state.items.find((x) => x.id === itemId);
  if (!it) return;
  const tapKey = `${k}|${itemId}|${index}`;
  if (lastMark.key === tapKey && Date.now() - lastMark.at < 600) return;
  const rec = getRec(k, itemId, index);
  if (!rec && k === dateKey()) {
    lastMark = { key: tapKey, at: Date.now() };
    setRec(k, itemId, index, { at: nowHM() });
    if (navigator.vibrate) navigator.vibrate(15);
    toast(`${it.emoji} ${it.name} marcado`);
    renderDay();
    return;
  }
  openDoseDialog(it, index, k, rec);
}

function openDoseDialog(it, index, k, rec) {
  ui.dose = { itemId: it.id, index, date: k };
  const n = dosesFor(it, k);
  $('#dose-dialog-title').textContent = `${it.emoji} ${it.name}${n > 1 ? ` — dose ${index + 1}` : ''}`;
  $('#dose-dialog-sub').textContent = `${fmtLong.format(parseKey(k))}${rec ? ' · já marcado' : ''}`;
  $('#dose-time').value = rec?.at || '';
  $('#dose-unmark').hidden = !rec;
  $('#dose-save').textContent = rec ? 'Salvar' : 'Marcar';
  $('#dose-dialog').showModal();
}

/* ---------- tela: histórico ---------- */
function renderHistory() {
  const today = dateKey();
  const curMonth = today.slice(0, 7);
  if (ui.month > curMonth) ui.month = curMonth;
  const [y, m] = ui.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();

  const monthLabel = fmtMonth.format(first);
  $('#cal-title').textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  $('#cal-next').disabled = ui.month >= curMonth;

  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<span class="cal-day blank"></span>');
  let monthFull = 0;
  let monthDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const k = `${ui.month}-${pad(d)}`;
    const st = dayStatus(k, today);
    if (['full', 'partial', 'empty'].includes(st)) {
      monthDays++;
      if (st === 'full') monthFull++;
    }
    const cls = `cal-day ${st}${k === today ? ' today' : ''}`;
    const label = `${d} — ${({ full: 'completo', partial: 'parcial', empty: 'nada marcado', none: 'sem itens', before: 'antes do início', future: 'futuro' })[st]}`;
    cells.push(`<button class="${cls}" data-date="${k}" aria-label="${label}" ${st === 'future' ? 'disabled' : ''}>${d}</button>`);
  }
  $('#cal-grid').innerHTML = cells.join('');

  const s = streak();
  $('#stats').innerHTML = `
    <div class="stat"><strong>${s}</strong><span>${s === 1 ? 'dia seguido completo' : 'dias seguidos completos'}</span></div>
    <div class="stat"><strong>${monthFull}<small class="muted" style="font-size:16px">/${monthDays}</small></strong><span>dias completos no mês</span></div>`;

  // Adesão por item no mês
  const rows = [];
  for (const it of state.items) {
    let exp = 0;
    let done = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const k = `${ui.month}-${pad(d)}`;
      if (k > today || k < state.startDate) continue;
      if (!itemsForDay(k).includes(it)) continue;
      const n = dosesFor(it, k);
      exp += n;
      for (let i = 0; i < n; i++) if (getRec(k, it.id, i)) done++;
    }
    if (!exp) continue;
    const pct = Math.round((done / exp) * 100);
    rows.push(`<div>
      <div class="adh-row"><span class="item-emoji" aria-hidden="true">${esc(it.emoji)}</span><span class="name">${esc(it.name)}${it.archivedAt ? ' <span class="muted small">(removido)</span>' : ''}</span><span class="val">${done}/${exp} · ${pct}%</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`);
  }
  $('#month-items').innerHTML = rows.length
    ? `<h2 style="margin-bottom:14px">Doses no mês</h2>${rows.join('<div style="height:12px"></div>')}`
    : '<p class="muted small center">Sem registros neste mês.</p>';
}

/* ---------- tela: ajustes ---------- */
function renderSettings() {
  const items = activeItems();
  $('#items-list').innerHTML = items.length
    ? items.map((it) => {
      const n = currentDoses(it);
      const times = it.times.filter(Boolean);
      const sub = `${n} ${n === 1 ? 'dose' : 'doses'}/dia · ${times.length ? `lembrete ${times.join(', ')}` : 'sem lembrete'}`;
      return `<button class="list-row" data-edit="${esc(it.id)}">
        <span class="item-emoji" aria-hidden="true">${esc(it.emoji)}</span>
        <span class="meta"><strong>${esc(it.name)}</strong><small>${esc(sub)}</small></span>
        ${CHEV_SVG}
      </button>`;
    }).join('')
    : '<p class="muted small" style="padding:16px">Nenhum item. Adicione abaixo.</p>';

  renderPushCard();

  let last = null;
  try { last = localStorage.getItem(BACKUP_KEY); } catch { /* ignora */ }
  $('#last-backup').textContent = last ? `Último backup exportado: ${fmtShort.format(new Date(last))}` : 'Nenhum backup exportado ainda.';
  $('#app-version').textContent = `Dose Diária v${APP_VERSION}`;
}

/* ---------- dialog de item ---------- */
function fillDoseSelect(selected) {
  $('#item-doses').innerHTML = Array.from({ length: MAX_DOSES }, (_, i) => `<option value="${i + 1}"${i + 1 === selected ? ' selected' : ''}>${i + 1}</option>`).join('');
}

function renderTimeInputs(count, values) {
  $('#item-times').innerHTML = Array.from({ length: count }, (_, i) => `
    <div class="time-row">
      <label for="time-${i}">Dose ${i + 1}</label>
      <input type="time" id="time-${i}" value="${esc(values[i] || '')}">
      <button type="button" class="icon-btn" data-clear="${i}" aria-label="Limpar horário da dose ${i + 1}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`).join('');
}

function readTimeInputs() {
  return Array.from(document.querySelectorAll('#item-times input')).map((el) => (TIME_RE.test(el.value) ? el.value : ''));
}

function openItemDialog(itemId) {
  const it = itemId ? state.items.find((x) => x.id === itemId) : null;
  ui.editingItemId = it ? it.id : null;
  $('#item-dialog-title').textContent = it ? 'Editar item' : 'Novo item';
  $('#item-emoji').value = it ? it.emoji : '💊';
  $('#item-name').value = it ? it.name : '';
  const n = it ? currentDoses(it) : 1;
  fillDoseSelect(n);
  renderTimeInputs(n, it ? it.times : []);
  $('#item-remove').hidden = !it;
  $('#item-doses-note').hidden = true;
  $('#item-dialog').showModal();
  if (!it) setTimeout(() => $('#item-name').focus(), 50);
}

function saveItemFromDialog() {
  const name = clipChars($('#item-name').value.trim(), 40);
  if (!name) { toast('Dê um nome ao item'); return false; }
  const emoji = clipChars($('#item-emoji').value.trim(), 4);
  const n = Number($('#item-doses').value);
  const times = readTimeInputs().slice(0, n);
  const today = dateKey();

  if (ui.editingItemId) {
    const it = state.items.find((x) => x.id === ui.editingItemId);
    it.name = name;
    it.emoji = emoji;
    const last = it.doseHistory[it.doseHistory.length - 1];
    if (last.doses !== n) {
      if (last.from === today || it.createdAt === today) last.doses = n;
      else it.doseHistory.push({ from: today, doses: n });
      // limpa marcações de hoje que ficaram acima da nova quantidade
      const rec = state.log[today]?.[it.id];
      if (rec) for (const i of Object.keys(rec)) if (Number(i) >= n) setRec(today, it.id, Number(i), null);
    }
    it.times = Array.from({ length: n }, (_, i) => times[i] || '');
  } else {
    state.items.push({
      id: uid(), name, emoji, createdAt: today, archivedAt: null,
      doseHistory: [{ from: ALWAYS, doses: n }],
      times: Array.from({ length: n }, (_, i) => times[i] || ''),
    });
  }
  saveState();
  syncReminders();
  return true;
}

function removeEditingItem() {
  const it = state.items.find((x) => x.id === ui.editingItemId);
  if (!it) return;
  if (!confirm(`Remover "${it.name}"?\nOs registros de dias anteriores continuam no histórico.`)) return;
  const today = dateKey();
  const hasLogs = Object.values(state.log).some((day) => day[it.id]);
  if (!hasLogs || it.createdAt === today) {
    state.items = state.items.filter((x) => x !== it);
    for (const k of Object.keys(state.log)) {
      delete state.log[k][it.id];
      if (!Object.keys(state.log[k]).length) delete state.log[k];
    }
  } else {
    it.archivedAt = today;
  }
  saveState();
  syncReminders();
  $('#item-dialog').close();
  toast('Item removido');
  render();
}

/* ---------- push / lembretes ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlB64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function buildReminders() {
  const list = [];
  for (const it of activeItems()) {
    const n = currentDoses(it);
    it.times.slice(0, n).forEach((time, i) => {
      if (TIME_RE.test(time)) list.push({ time, label: `${it.emoji} ${it.name}`.trim(), dose: i + 1, doses: n });
    });
  }
  return list;
}

async function getSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

async function syncReminders({ silent = false } = {}) {
  if (!state.push.enabled) return;
  try {
    const sub = await getSubscription();
    if (!sub) {
      state.push.enabled = false;
      saveState();
      if (ui.tab === 'settings') renderPushCard();
      return;
    }
    await api('/api/subscribe', {
      subscription: sub.toJSON(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reminders: buildReminders(),
    });
    state.push.pendingSync = false;
    saveState();
  } catch (e) {
    console.error(e);
    state.push.pendingSync = true;
    saveState();
    if (!silent) toast('Não consegui atualizar os lembretes no servidor');
  }
  if (ui.tab === 'settings') renderPushCard();
}

async function enablePush() {
  if (!pushSupported()) { toast('Este navegador não suporta notificações'); return; }
  // Precisa ser a primeira coisa no toque (exigência do iOS)
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { renderPushCard(); toast('Permissão de notificação negada'); return; }
  const btn = $('#push-enable');
  if (btn) { btn.disabled = true; btn.textContent = 'Ativando…'; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const cfg = await fetch('/api/config').then((r) => r.json());
      if (!cfg.publicKey) throw new Error('Servidor sem chave VAPID configurada');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(cfg.publicKey) });
    }
    state.push.enabled = true;
    saveState();
    await syncReminders();
    if (!state.push.pendingSync) toast('Lembretes ativados');
  } catch (e) {
    console.error(e);
    toast(`Falha ao ativar: ${e.message}`);
  }
  renderPushCard();
}

async function disablePush() {
  try {
    const sub = await getSubscription();
    if (sub) {
      await api('/api/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch (e) { console.error(e); }
  state.push.enabled = false;
  state.push.pendingSync = false;
  saveState();
  toast('Lembretes desativados');
  renderPushCard();
}

async function testPush() {
  try {
    const sub = await getSubscription();
    if (!sub) throw new Error('Inscrição não encontrada');
    await api('/api/test', { endpoint: sub.endpoint });
    toast('Notificação de teste enviada');
  } catch (e) {
    toast(`Falha no teste: ${e.message}`);
  }
}

function renderPushCard() {
  const card = $('#push-card');
  const count = buildReminders().length;

  if (!pushSupported() && !(isIOS && !isStandalone())) {
    card.innerHTML = '<div class="status warn">Não suportado</div><p class="muted small">Este navegador não aceita notificações push.</p>';
    return;
  }
  if (isIOS && !isStandalone()) {
    card.innerHTML = `<div class="status warn">Instale o app primeiro</div>
      <p class="muted small">No iPhone, notificações só funcionam com o app na Tela de Início:</p>
      <ol class="steps">
        <li>Toque em <strong>Compartilhar</strong> no Safari</li>
        <li>Escolha <strong>Adicionar à Tela de Início</strong></li>
        <li>Abra o <strong>Dose Diária</strong> pelo ícone e volte aqui</li>
      </ol>`;
    return;
  }
  if (Notification.permission === 'denied') {
    card.innerHTML = `<div class="status warn">Notificações bloqueadas</div>
      <p class="muted small">${isIOS ? 'Libere em <strong>Ajustes do iPhone › Notificações › Dose Diária</strong> e volte aqui.' : 'Libere as notificações deste site nas configurações do navegador e volte aqui.'}</p>`;
    return;
  }
  if (state.push.enabled) {
    card.innerHTML = `<div class="status on">Ativados neste aparelho</div>
      <p class="muted small">${count ? `${count} ${count === 1 ? 'lembrete agendado' : 'lembretes agendados'} por dia.` : 'Nenhum horário definido. Edite um item e coloque o horário de cada dose.'}
      ${state.push.pendingSync ? '<br><strong style="color:var(--warn)">Alterações ainda não enviadas ao servidor.</strong>' : ''}</p>
      <div class="btn-row">
        ${state.push.pendingSync ? '<button class="btn btn-primary" id="push-retry">Reenviar</button>' : ''}
        <button class="btn btn-secondary" id="push-test">Testar</button>
        <button class="btn btn-danger" id="push-disable">Desativar</button>
      </div>`;
    return;
  }
  card.innerHTML = `<div class="status">Desativados</div>
    <p class="muted small">Receba uma notificação no horário de cada dose. Os horários são definidos em cada item.</p>
    <div class="btn-row"><button class="btn btn-primary" id="push-enable">Ativar lembretes</button></div>`;
}

/* ---------- backup ---------- */
async function exportBackup() {
  const data = { app: 'dose-diaria', exportedAt: new Date().toISOString(), ...state, push: undefined };
  const json = JSON.stringify(data, null, 2);
  const name = `dose-diaria-backup-${dateKey()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup Dose Diária' });
    } else {
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch { /* ignora */ }
    renderSettings();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Não foi possível exportar');
  }
}

async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const next = normalizeState(parsed);
    const days = Object.keys(next.log).length;
    if (!confirm(`Importar backup com ${next.items.length} itens e ${days} dias registrados?\nIsso substitui os dados atuais deste aparelho.`)) return;
    next.push = state.push; // a inscrição de push é deste aparelho
    state = next;
    saveState();
    syncReminders();
    toast('Backup importado');
    render();
  } catch (e) {
    toast('Arquivo de backup inválido');
  }
}

/* ---------- eventos ---------- */
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) setTab(b.dataset.tab);
});

$('#day-prev').addEventListener('click', () => { ui.date = addDays(ui.date, -1); renderDay(); });
$('#day-next').addEventListener('click', () => { if (ui.date < dateKey()) { ui.date = addDays(ui.date, 1); renderDay(); } });
$('#go-today').addEventListener('click', () => { ui.date = dateKey(); renderDay(); });
$('#day-items').addEventListener('click', (e) => {
  const b = e.target.closest('.dose');
  if (b) onDoseTap(b.dataset.item, Number(b.dataset.dose));
});

$('#cal-prev').addEventListener('click', () => {
  const [y, m] = ui.month.split('-').map(Number);
  ui.month = dateKey(new Date(y, m - 2, 1)).slice(0, 7);
  renderHistory();
});
$('#cal-next').addEventListener('click', () => {
  const [y, m] = ui.month.split('-').map(Number);
  ui.month = dateKey(new Date(y, m, 1)).slice(0, 7);
  renderHistory();
});
$('#cal-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.cal-day[data-date]');
  if (!b || b.disabled) return;
  ui.date = b.dataset.date;
  setTab('day');
});

// dialog de dose
$('#dose-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const { itemId, index, date } = ui.dose;
  const t = $('#dose-time').value;
  setRec(date, itemId, index, { at: TIME_RE.test(t) ? t : null });
  $('#dose-dialog').close();
  renderDay();
});
$('#dose-unmark').addEventListener('click', () => {
  const { itemId, index, date } = ui.dose;
  setRec(date, itemId, index, null);
  $('#dose-dialog').close();
  toast('Dose desmarcada');
  renderDay();
});
$('#dose-cancel').addEventListener('click', () => $('#dose-dialog').close());

// itens
$('#items-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit]');
  if (b) openItemDialog(b.dataset.edit);
});
$('#add-item').addEventListener('click', () => openItemDialog(null));
$('#item-doses').addEventListener('change', () => {
  const n = Number($('#item-doses').value);
  renderTimeInputs(n, readTimeInputs());
  const it = state.items.find((x) => x.id === ui.editingItemId);
  $('#item-doses-note').hidden = !it || currentDoses(it) === n;
});
$('#item-times').addEventListener('click', (e) => {
  const b = e.target.closest('[data-clear]');
  if (b) $(`#time-${b.dataset.clear}`).value = '';
});
$('#item-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (saveItemFromDialog()) {
    $('#item-dialog').close();
    render();
  }
});
$('#item-cancel').addEventListener('click', () => $('#item-dialog').close());
$('#item-remove').addEventListener('click', removeEditingItem);

// lembretes (botões recriados a cada render)
$('#push-card').addEventListener('click', (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'push-enable') enablePush();
  else if (id === 'push-disable') disablePush();
  else if (id === 'push-test') testPush();
  else if (id === 'push-retry') syncReminders();
});

// backup
$('#export-btn').addEventListener('click', exportBackup);
$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) importBackup(f);
  e.target.value = '';
});

// fecha dialogs tocando fora
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

// voltando ao app (ex.: virou o dia ou veio de uma notificação)
let lastToday = dateKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const today = dateKey();
  if (today !== lastToday) {
    if (ui.date === lastToday) ui.date = today;
    lastToday = today;
  }
  render();
  if (state.push.pendingSync) syncReminders({ silent: true });
});

/* ---------- início ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW', e));
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
saveState();
setTab('day');
if (state.push.enabled) syncReminders({ silent: true });
