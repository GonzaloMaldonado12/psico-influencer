// Mini-utilidades de interfaz: creación de nodos, avisos, diálogos y controles.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else if (k === 'value' || k === 'checked') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function icon(name, size = 20) {
  const paths = ICONS[name] || ICONS.dot;
  const span = document.createElement('span');
  span.className = 'ic';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  return span;
}

const ICONS = {
  dot: '<circle cx="12" cy="12" r="3"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  script: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  brand: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>',
  flip: '<path d="M4 7h11l-3-3M20 17H9l3 3"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  share: '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  text: '<path d="M4 6V4h16v2M12 4v16M9 20h6"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3"/>',
  layout: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M4 16h16"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  color: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 3a9 9 0 0 1 0 18" fill="currentColor"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  magic: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  grid: '<path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M17 7.5h4M3 12h18M3 16.5h4M17 16.5h4"/>',
  speed: '<path d="M12 14l4-4"/><path d="M3.3 17A9 9 0 1 1 20.7 17"/>',
  aspect: '<rect x="7" y="2" width="10" height="20" rx="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21 12h0"/>',
  photos: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5-11 11"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  lens: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
};

let toastRoot = null;
export function toast(msg, type = 'info', ms = 3200) {
  toastRoot ||= document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${type}`, role: 'status' }, msg);
  toastRoot.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/** Diálogo modal genérico. `actions`: [{label, value, kind}] → devuelve el value pulsado. */
export function modal({ title, body, actions = [{ label: 'Cerrar', value: null }], wide = false, onOpen } = {}) {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 200);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    const panel = h(
      'div',
      { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Diálogo' },
      title ? h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => close(null) }, icon('close'))) : null,
      h('div', { class: 'modal-body' }, body),
      actions.length
        ? h(
            'div',
            { class: 'modal-actions' },
            actions.map((a) =>
              h('button', { class: `btn ${a.kind ? 'btn-' + a.kind : ''}`, onclick: async () => {
                if (a.validate && !(await a.validate())) return;
                close(typeof a.value === 'function' ? a.value() : a.value);
              } }, a.label)
            )
          )
        : null
    );
    const overlay = h('div', { class: 'overlay', onclick: (e) => e.target === overlay && close(null) }, panel);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => overlay.classList.add('show'));
    onOpen?.(panel, close);
  });
}

export async function confirmDialog(message, { title = '¿Seguro?', ok = 'Aceptar', danger = false } = {}) {
  const v = await modal({
    title,
    body: h('p', null, message),
    actions: [
      { label: 'Cancelar', value: false },
      { label: ok, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
  return v === true;
}

export async function promptDialog(title, value = '', { multiline = false, placeholder = '' } = {}) {
  const input = multiline
    ? h('textarea', { class: 'input', rows: 8, placeholder })
    : h('input', { class: 'input', type: 'text', placeholder });
  input.value = value;
  const v = await modal({
    title,
    body: input,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Aceptar', value: () => input.value, kind: 'primary' },
    ],
    onOpen: () => setTimeout(() => input.focus(), 50),
  });
  return v;
}

// ---------- Controles de formulario ----------

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
}

export function slider({ label, value, min, max, step = 0.01, format = (v) => v, onInput, onChange }) {
  const out = h('output', { class: 'slider-val' }, format(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: () => {
      out.textContent = format(Number(input.value));
      onInput?.(Number(input.value));
    },
    onchange: () => onChange?.(Number(input.value)),
  });
  input.value = value;
  return h('label', { class: 'field slider' }, h('span', { class: 'field-label' }, label, out), input);
}

export function toggle({ label, checked, onChange, hint }) {
  const input = h('input', { type: 'checkbox', role: 'switch', onchange: () => onChange(input.checked) });
  input.checked = !!checked;
  return h('label', { class: 'toggle' }, h('span', null, label, hint ? h('small', { class: 'hint' }, hint) : null), input);
}

export function select({ label, value, options, onChange }) {
  const sel = h(
    'select',
    { class: 'input', onchange: () => onChange(sel.value) },
    options.map(([v, l]) => h('option', { value: v }, l))
  );
  sel.value = value;
  return label ? field(label, sel) : sel;
}

export function colorPick({ label, value, onChange }) {
  const input = h('input', { type: 'color', class: 'color', oninput: () => onChange(input.value), onchange: () => onChange(input.value, true) });
  input.value = toHex6(value);
  return h('label', { class: 'field field-row' }, h('span', { class: 'field-label' }, label), input);
}

function toHex6(v) {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('');
  return '#000000';
}

export function segmented({ value, options, onChange, label }) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label || '' });
  const render = (val) => {
    wrap.replaceChildren(
      ...options.map(([v, l]) =>
        h('button', {
          class: `seg-btn${v === val ? ' active' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(v === val),
          onclick: () => {
            render(v);
            onChange(v);
          },
        }, l)
      )
    );
  };
  render(value);
  return label ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), wrap) : wrap;
}

export function textInput({ label, value, placeholder = '', onInput, onChange, multiline = false, rows = 3 }) {
  const input = multiline
    ? h('textarea', { class: 'input', rows, placeholder })
    : h('input', { class: 'input', type: 'text', placeholder });
  input.value = value ?? '';
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  if (onChange) input.addEventListener('change', () => onChange(input.value));
  return label ? field(label, input) : input;
}

export function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve([...input.files]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function progressModal(title) {
  const bar = h('div', { class: 'progress-fill' });
  const label = h('p', { class: 'muted' }, 'Preparando…');
  let closeFn = null;
  let cancelled = false;
  const done = modal({
    title,
    body: h('div', null, h('div', { class: 'progress' }, bar), label),
    actions: [{ label: 'Cancelar', value: 'cancel' }],
    onOpen: (_p, close) => (closeFn = close),
  }).then((v) => {
    if (v === 'cancel' || v === null) cancelled = true;
  });
  return {
    set(p, text) {
      bar.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
      if (text) label.textContent = text;
    },
    get cancelled() {
      return cancelled;
    },
    close() {
      closeFn?.('done');
    },
    done,
  };
}
