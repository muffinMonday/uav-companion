// Community flying areas, Phase 1: the "Details and save" dialog of a drawing session: name (required, 80), description (500), and the Pilot setup spots
// (type and a note of up to 120 characters each; positions are placed and dragged on the map). All text goes in through textContent / input.value.
import { el } from '../cards.js';
import { showModalQuiet } from '../touch.js';
import { NAME_MAX, DESC_MAX, SPOT_NOTE_MAX, MAX_SPOTS, SPOT_TYPES, SPOT_LABELS, validateArea, ENVIRONMENTS, ACCESS, ACTIVITIES, SURFACES, HAZARDS, OBSERVED_MIN } from './core.js';
import { DISCLAIMER } from './layer.js';

/**
 * @param {object} o
 * @param {object} o.editor     the open editor (editor.js)
 * @param {string|null} o.editingId
 * @param {() => void} o.onChange  called after a spot is changed or removed here, so the map repaints
 * @param {(draft) => ({ok, errors})} o.onSave  stores the draft; on success the caller ends the session (and this dialog closes with it)
 */
export function openDetails({ editor, editingId, onChange, onSave }) {
  document.querySelector('dialog.area-dialog')?.remove();
  const dlg = el('dialog', 'area-dialog'); dlg.setAttribute('aria-labelledby', 'area-dlg-title');
  const form = el('form', 'area-form'); form.method = 'dialog'; form.noValidate = true;
  const h = el('h2', 'area-dlg-title', editingId ? 'Edit flying area' : 'Save flying area'); h.id = 'area-dlg-title';
  const note = el('p', 'area-note', 'Saved privately in this browser only. Nothing is sent anywhere. ' + DISCLAIMER);

  const nameIn = el('input'); nameIn.type = 'text'; nameIn.id = 'area-name'; nameIn.maxLength = NAME_MAX; nameIn.value = editor.name; nameIn.required = true; nameIn.autocomplete = 'off'; nameIn.setAttribute('aria-describedby', 'area-name-count');
  const nameCount = el('span', 'area-count'); nameCount.id = 'area-name-count';
  const descIn = el('textarea'); descIn.id = 'area-desc'; descIn.maxLength = DESC_MAX; descIn.rows = 4; descIn.value = editor.description; descIn.setAttribute('aria-describedby', 'area-desc-count');
  const descCount = el('span', 'area-count'); descCount.id = 'area-desc-count';
  const field = (label, input, count) => { const l = el('label', 'area-field'); l.append(el('span', 'area-label', label), input, ...(count ? [count] : [])); return l; };

  // Site details (Stage 4): the person's own observations. Environment and access are needed to submit (Unknown is a valid answer); everything else may stay empty = not provided.
  const attrs = editor.attributes;
  const sel1 = (id, label, map, value, { required = false, blank } = {}) => {
    const s = el('select'); s.id = id; s.dataset.attr = id.replace('area-attr-', '');
    const first = el('option', '', blank ?? (required ? 'Choose…' : 'Not specified')); first.value = ''; s.append(first);
    for (const [k, t] of Object.entries(map)) { const o = el('option', '', t); o.value = k; s.append(o); }
    s.value = value ?? ''; return field(label + (required ? ' (needed to submit)' : ''), s, null);
  };
  const checks = (key, label, map, chosen) => {
    const fs = el('fieldset', 'area-checks'); fs.dataset.attr = key; fs.append(el('legend', 'area-label', label));
    for (const [k, t] of Object.entries(map)) { const l = el('label', 'area-check'); const c = el('input'); c.type = 'checkbox'; c.value = k; c.checked = chosen.includes(k); l.append(c, el('span', '', t)); fs.append(l); }
    return fs;
  };
  const envSel = sel1('area-attr-environment', 'Site environment', ENVIRONMENTS, attrs.environment, { required: true });
  const accSel = sel1('area-attr-access', 'Access / permission status', ACCESS, attrs.access, { required: true });
  const accNote = el('p', 'area-hint', 'Showing a place on the map does not mean the public may enter it or that flying is allowed. Say what you know; choose Unknown if you have not checked.');
  const actBox = checks('activities', 'Suitable flying activities (optional)', ACTIVITIES, attrs.activities ?? []);
  const surfSel = sel1('area-attr-surface', 'Ground / launch surface', SURFACES, attrs.surface);
  const hazBox = checks('hazards', 'Known hazards (optional)', HAZARDS, attrs.hazards ?? []);
  const hazHint = el('p', 'area-hint', '“None reported” means you saw none, not that the site is hazard-free. “Unknown” means you did not check.');
  hazBox.addEventListener('change', (e) => { // "None reported" and "Unknown" stand alone
    const c = e.target; if (!(c instanceof HTMLInputElement) || !c.checked) return;
    const boxes = [...hazBox.querySelectorAll('input')];
    if (c.value === 'none_reported' || c.value === 'unknown') boxes.forEach((b) => { if (b !== c) b.checked = false; });
    else boxes.forEach((b) => { if (b.value === 'none_reported' || b.value === 'unknown') b.checked = false; });
  });
  const obsIn = el('input'); obsIn.type = 'date'; obsIn.id = 'area-attr-observed'; obsIn.min = OBSERVED_MIN; obsIn.max = new Date().toISOString().slice(0, 10); obsIn.value = attrs.observed_on ?? '';
  const obsField = field('Date you last visited or checked the site (optional)', obsIn, null);
  const obsHint = el('p', 'area-hint', 'Leave empty unless you personally checked. It is never filled in for you.');
  const siteBox = el('div', 'area-site'); siteBox.append(el('h3', 'area-site-h', 'Site details'), el('p', 'area-hint', 'Your own observations, shown with the area if it is approved. They are not verified and not an authorisation to enter or fly.'), envSel, accSel, accNote, actBox, surfSel, hazBox, hazHint, obsField, obsHint);
  const readAttrs = () => {
    const a = {};
    if (envSel.querySelector('select').value) a.environment = envSel.querySelector('select').value;
    if (accSel.querySelector('select').value) a.access = accSel.querySelector('select').value;
    const act = [...actBox.querySelectorAll('input:checked')].map((c) => c.value); if (act.length) a.activities = act;
    if (surfSel.querySelector('select').value) a.surface = surfSel.querySelector('select').value;
    const haz = [...hazBox.querySelectorAll('input:checked')].map((c) => c.value); if (haz.length) a.hazards = haz;
    if (obsIn.value) a.observed_on = obsIn.value;
    return a;
  };

  const spotsBox = el('div', 'area-spots');
  const errBox = el('div', 'area-errors'); errBox.setAttribute('role', 'alert');
  const actions = el('div', 'area-dlg-actions');
  const save = el('button', 'btn primary', 'Save'); save.type = 'submit'; save.dataset.act = 'save';
  const back = el('button', 'btn', 'Back to the map'); back.type = 'button'; back.dataset.act = 'back';
  actions.append(save, back);

  const counts = () => { nameCount.textContent = `${Array.from(nameIn.value).length} / ${NAME_MAX}`; descCount.textContent = `${Array.from(descIn.value).length} / ${DESC_MAX}`; };
  function drawSpots() {
    spotsBox.replaceChildren(el('h3', 'area-sub', `Pilot setup spots (${editor.spots.length} of ${MAX_SPOTS})`),
      el('p', 'area-hint', editor.spots.length ? 'Places where pilots can sit, shelter and set up. Not take-off permission. To move one, use Setup spots on the map.' : 'Optional. Use Setup spots on the map to add places to sit, shelter or set up. No spots means “not mapped”.'));
    const out = new Set(editor.outsideSpotIds());
    editor.spots.forEach((s, i) => {
      const row = el('div', 'area-spot-row' + (out.has(s.id) ? ' out' : '')); row.dataset.spot = s.id;
      const sel = el('select'); sel.setAttribute('aria-label', `Spot ${i + 1} type`);
      for (const t of SPOT_TYPES) { const o = el('option', '', SPOT_LABELS[t]); o.value = t; sel.append(o); }
      sel.value = s.type; sel.addEventListener('change', () => { editor.setSpot(s.id, { type: sel.value }); onChange(); });
      const n = el('input'); n.type = 'text'; n.maxLength = SPOT_NOTE_MAX; n.value = s.note; n.placeholder = 'Note (optional)'; n.setAttribute('aria-label', `Spot ${i + 1} note`);
      n.addEventListener('change', () => { editor.setSpot(s.id, { note: n.value }); });
      const rm = el('button', 'btn', 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', `Remove spot ${i + 1}`);
      rm.addEventListener('click', () => { editor.removeSpot(s.id); drawSpots(); onChange(); });
      row.append(sel, n, rm);
      if (out.has(s.id)) row.append(el('span', 'area-spot-out', 'Outside the area: move it or the outline.'));
      spotsBox.append(row);
    });
  }
  function showErrors(list) { errBox.replaceChildren(...list.map((e) => el('p', '', e.message))); }

  nameIn.addEventListener('input', counts); descIn.addEventListener('input', counts);
  back.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    editor.setText({ name: nameIn.value, description: descIn.value }); editor.setAttributes(readAttrs());
    // spot notes are committed on 'change'; make sure a note still being typed is not lost
    dlg.querySelectorAll('.area-spot-row').forEach((row) => { const n = row.querySelector('input'); editor.setSpot(row.dataset.spot, { note: n.value }); });
    const check = editor.validate();
    if (!check.ok) { showErrors(check.errors); return; }
    const draft = editor.toDraft();
    if (!validateArea(draft).ok) { showErrors(validateArea(draft).errors); return; }
    const r = onSave(draft);
    if (r && !r.ok) showErrors(r.errors);
  });
  dlg.addEventListener('close', () => { editor.setText({ name: nameIn.value, description: descIn.value }); editor.setAttributes(readAttrs()); dlg.remove(); onChange(); });
  form.append(h, note, field('Name', nameIn, nameCount), field('Description (optional)', descIn, descCount), siteBox, spotsBox, errBox, actions);
  dlg.append(form);
  document.body.append(dlg);
  counts(); drawSpots();
  showModalQuiet(dlg);
  return dlg;
}
