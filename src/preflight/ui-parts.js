// Motor diagnostics: the shared presentation parts. Every part here is built from the main app's own classes and tokens
// (src/styles.css: .btn, .badge, .dash-card, .status, .check-row, .chip, .hint, .stat, the --* tokens) through the app's el()
// builder. There is no diagnostics theme and no second token set: ui-parts.css only arranges these parts with the same tokens.
// bench-ui.js (the workspace and the engineering lab both mount it) and the readiness view use these exports, so one definition
// renders everywhere. Text goes in through textContent; the only innerHTML is the constant icon paths below.
import { el, statusEl } from '../cards.js';

export { el, statusEl };

// ---- icons: constant 24x24 stroke paths (the app's icon style: stroke currentColor, round caps)
const ICON_PATHS = Object.freeze({
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4l9 16H3L12 4zM12 10v4.5M12 17.5h.01',
  cross: 'M6 6l12 12M18 6L6 18',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  usb: 'M12 3v13M8 8l4-5 4 5M7 16h3v3H7zM14 14h4v4h-4z',
  chip: 'M8 8h8v8H8zM10 4v4M14 4v4M10 16v4M14 16v4M4 10h4M4 14h4M16 10h4M16 14h4',
  back: 'M15 5l-7 7 7 7',
  stop: 'M7 7h10v10H7z',
  dot: 'M12 12h.01',
});
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  s.setAttribute('class', ('dg-icon ' + cls).trim());
  for (const d of [].concat(ICON_PATHS[name] || ICON_PATHS.dot)) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

// ---- status vocabulary: a state always has an icon AND a word; colour only supports them
export const STATUS = Object.freeze({
  passed: { label: 'Passed', icon: 'check', badge: 'ok' },
  action: { label: 'Action needed', icon: 'alert', badge: 'no' },
  checking: { label: 'Checking', icon: 'clock', badge: 'info' },
  unavailable: { label: 'Unavailable', icon: 'help', badge: '' },
  unconfirmed: { label: 'Not confirmed', icon: 'help', badge: '' },
});
export function statusBadge(kind) {
  const s = STATUS[kind] || STATUS.unconfirmed;
  const b = el('span', `badge dg-state ${s.badge}`.trim());
  b.append(icon(s.icon), document.createTextNode(s.label));
  b.dataset.state = kind;
  return b;
}

// ---- buttons (production .btn)
export function button(text, onClick, { id, cls = '', disabled = false, primary = false, small = false } = {}) {
  const b = el('button', ['btn', primary && 'primary', small && 'small', cls].filter(Boolean).join(' '), text);
  b.type = 'button'; if (id) b.id = id; b.disabled = !!disabled;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// ---- cards and sections
// A section card. kind keeps the three kinds of content visibly apart (checks, the active sweep, the result): data-kind drives
// the small label above the title, which is text, so the distinction never depends on colour.
const KICKERS = Object.freeze({ safety: 'Safety and readiness', sweep: 'Active test', result: 'Observed result', scan: 'ESC identification' });
export function section(title, id, kind = 'safety') {
  const s = el('section', 'dash-card dg-section'); s.id = id; s.dataset.kind = kind;
  s.append(el('p', 'eyebrow', KICKERS[kind] || KICKERS.safety), el('h2', 'section-title', title));
  return s;
}

// ---- workspace header and progress
export const STEPS = Object.freeze([
  'Connect', 'Readiness', 'Safety checklist', 'Battery and zero check', 'ESC identification', 'Restore and re-check', 'Motor tests', 'Stop check', 'Result',
]);

export function progress({ step, label, paused }) {
  const wrap = el('div', 'dg-progress'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'Progress');
  const now = el('p', 'dg-step-now');
  if (paused) now.textContent = label;
  else now.append(el('b', '', `Step ${step} of ${STEPS.length}`), document.createTextNode(` · ${label}`));
  now.id = 'bt-step';
  const bar = el('progress', 'dg-bar'); bar.max = STEPS.length; bar.value = paused ? 0 : step; bar.setAttribute('aria-label', 'Overall progress');
  bar.setAttribute('aria-valuetext', paused ? label : `Step ${step} of ${STEPS.length}: ${label}`);
  const list = el('ol', 'dg-steps'); // wide screens only (CSS): the compact current-step line above is what phones show
  STEPS.forEach((t, i) => {
    const li = el('li', i + 1 < step ? 'done' : i + 1 === step ? 'now' : '', t);
    if (i + 1 === step && !paused) li.setAttribute('aria-current', 'step');
    list.append(li);
  });
  wrap.append(now, bar, list);
  return wrap;
}

// connection: { text, kind: 'ok' | 'no' | '' }. The word is always shown.
export function workspaceHeader({ backHref, canLeave, title = 'Motor diagnostics', badgeText = 'Beta', connection, prog, notice }) {
  const h = el('header', 'dg-header');
  const top = el('div', 'dg-header-row');
  if (canLeave && backHref) { const a = el('a', 'btn small dg-back'); a.href = backHref; a.id = 'bt-back'; a.append(icon('back'), document.createTextNode('Dashboard')); a.setAttribute('aria-label', 'Back to the dashboard'); top.append(a); }
  const t = el('h1', 'dg-title', title + ' '); t.append(el('span', 'badge', badgeText));
  top.append(t);
  if (connection) { const c = el('span', `badge dg-conn ${connection.kind || ''}`.trim()); c.id = 'bt-mode'; c.dataset.mode = connection.mode || 'none'; c.append(icon(connection.icon || 'usb'), document.createTextNode(connection.text)); top.append(c); }
  h.append(top);
  if (!canLeave) h.append(el('p', 'hint dg-lockline', 'Leaving is blocked while anything may be powered. Use Stop & zero, confirm the motors are still, then disconnect the battery.'));
  if (prog) h.append(progress(prog));
  if (notice) { const n = el('p', 'hint dg-notice', notice); n.setAttribute('role', 'status'); h.append(n); }
  return h;
}

// ---- confirmation rows (a large tappable row, at least 44 px high, the whole row is the target)
export function confirmRow({ id, attest, label, help, checked, onChange }) {
  const row = el('label', 'check-row dg-confirm');
  if (id) row.htmlFor = id;
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!checked; if (id) cb.id = id; if (attest) cb.dataset.attest = attest;
  cb.addEventListener('change', () => onChange(cb.checked));
  const text = el('span', 'dg-confirm-text');
  text.append(el('b', '', label));
  if (help) text.append(el('small', '', help));
  row.append(cb, text);
  return row;
}

// ---- an automatic check row: icon, title, status word, short explanation, expandable technical evidence
export function checkRow({ id, title, status, text, evidence = [] }) {
  const s = STATUS[status] || STATUS.unconfirmed;
  const li = el('li', `dg-check dg-${status}`); li.dataset.gate = id; li.dataset.status = status;
  const head = el('div', 'dg-check-head');
  const ic = el('span', 'dg-check-icon'); ic.append(icon(s.icon));
  head.append(ic, el('b', 'dg-check-title', title), statusBadge(status));
  li.append(head);
  if (text) li.append(el('p', 'dg-check-text', text));
  const rows = evidence.filter(([, v]) => v);
  if (rows.length) {
    const d = el('details', 'dg-evidence'); d.append(el('summary', '', 'Technical details'));
    const dl = el('dl'); for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', v));
    d.append(dl); li.append(d);
  }
  return li;
}

// ---- the quad diagram: four position cells, front at the top. Each cell shows motor, position, a state icon and the state in words.
// cells: [{ motor: 0..3, position, state, text, sub }]. state is a STATUS key or a scan state ('waiting' | 'connecting' | 'identified' | 'mismatch').
const CELL_ICON = Object.freeze({ passed: 'check', action: 'alert', checking: 'clock', unavailable: 'help', unconfirmed: 'help', waiting: 'clock', connecting: 'clock', identified: 'check', mismatch: 'alert' });
export function quad(cells, { label = 'Motor positions, front at the top', tag = 'div' } = {}) {
  const g = el('div', 'dg-quad'); g.setAttribute('role', 'list'); g.setAttribute('aria-label', label);
  const front = el('span', 'dg-quad-front', 'Front'); front.setAttribute('aria-hidden', 'true');
  g.append(front);
  for (const m of [3, 1, 2, 0]) { // front left, front right, rear left, rear right
    const c = cells[m];
    const cell = el(tag, `dg-motor dg-m-${c.state}`); cell.setAttribute('role', 'listitem'); cell.dataset.motor = String(m); cell.dataset.state = c.state;
    cell.append(el('span', 'dg-motor-n', `Motor ${m + 1}`), el('span', 'dg-motor-pos', c.position));
    const st = el('span', 'dg-motor-state'); st.append(icon(CELL_ICON[c.state] || 'help'), document.createTextNode(c.text)); cell.append(st);
    if (c.sub) cell.append(el('small', 'dg-motor-sub', c.sub));
    g.append(cell);
  }
  return g;
}

// A picker version of the quad: four toggle buttons (the user chooses the motor to test). Same cell look.
export function quadPicker({ cells, selected, onPick, disabled }) {
  const g = el('div', 'dg-quad dg-picker'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Choose the motor to test, front at the top');
  const front = el('span', 'dg-quad-front', 'Front'); front.setAttribute('aria-hidden', 'true'); g.append(front);
  for (const m of [3, 1, 2, 0]) {
    const c = cells[m];
    const b = el('button', `dg-motor dg-m-${c.state}` + (selected === m ? ' dg-selected' : '')); b.type = 'button'; b.id = 'btn-motor-' + (m + 1); b.dataset.motor = String(m);
    b.disabled = !!disabled || !onPick; b.setAttribute('aria-pressed', String(selected === m));
    b.append(el('span', 'dg-motor-n', `Motor ${m + 1}`), el('span', 'dg-motor-pos', c.position));
    const st = el('span', 'dg-motor-state'); st.append(icon(CELL_ICON[c.state] || 'help'), document.createTextNode(c.text)); b.append(st);
    if (onPick) b.addEventListener('click', () => onPick(m));
    g.append(b);
  }
  return g;
}

// ---- the persistent Stop & zero action (one tap, no confirmation). `state` says honestly whether a zero command can be delivered.
export function stopBar({ onStop, controlText }) {
  const wrap = el('div', 'dg-stopbar'); wrap.id = 'bt-stopwrap';
  const b = el('button', 'btn dg-stop'); b.type = 'button'; b.id = 'btn-stop-zero';
  b.append(icon('stop'), document.createTextNode('Stop & zero'));
  b.setAttribute('aria-label', 'Stop and zero: send external 1000 to all motors now');
  b.addEventListener('click', onStop);
  wrap.append(b);
  if (controlText) { const p = el('p', 'dg-stop-note', controlText); p.id = 'bt-control-note'; p.setAttribute('role', 'status'); wrap.append(p); }
  return wrap;
}

export const plural = (n, one, many) => (n === 1 ? one : many);
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export const countWord = (n) => (n >= 0 && n <= 10 ? WORDS[n] : String(n));
