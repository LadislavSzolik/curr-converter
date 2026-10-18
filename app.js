(() => {
  'use strict';

  /* ---------- Settings ---------- */

  const API_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR';
  const KEY_STATE = 'wechsel.state.v1';
  const KEY_RATES = 'wechsel.rates.v1';
  const DEFAULT_FAVS = ['EUR', 'CHF', 'INR'];
  const REFRESH_AFTER_MS = 2 * 60 * 60 * 1000; // refetch when stored rates are older than this
  const FETCH_TIMEOUT_MS = 8000;
  const STALE_AFTER_DAYS = 4;                  // ECB skips weekends, so a few days is normal
  const AMOUNT_BASE_PX = 60;
  const RESULT_BASE_PX = 72;

  // Currency identity colour: [hue, chroma, lightness] in OKLCH.
  // The three defaults take their flag colour. Other codes pick a stable hue from a short list
  // that stays clear of those three and of the muddy yellow-brown range.
  const IDENTITY = {
    CHF: [27, 0.2, 0.53],
    EUR: [262, 0.16, 0.5],
    INR: [158, 0.115, 0.47],
    USD: [215, 0.12, 0.48],
    GBP: [300, 0.15, 0.46],
    JPY: [350, 0.17, 0.52]
  };
  const SPARE_HUES = [205, 185, 300, 325, 345];

  function identity(code) {
    if (IDENTITY[code]) return IDENTITY[code];
    let h = 0;
    for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return [SPARE_HUES[h % SPARE_HUES.length], 0.13, 0.48];
  }

  /* ---------- Storage ---------- */

  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    }
  };

  /* ---------- Rates ---------- */

  function validRates(r) {
    return !!r && typeof r.date === 'string' && !!r.rates && typeof r.rates === 'object' &&
      r.rates.EUR === 1 &&
      Object.values(r.rates).every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  }

  function pickRates(saved, builtin) {
    const base = { date: builtin.date, rates: builtin.rates, fetchedAt: 0, builtin: true };
    // Prefer stored rates unless the bundled snapshot is newer (e.g. after an app update).
    if (validRates(saved) && saved.date >= base.date) {
      return { date: saved.date, rates: saved.rates, fetchedAt: saved.fetchedAt || 0, builtin: false };
    }
    return base;
  }

  let rates = pickRates(store.get(KEY_RATES), window.FALLBACK_RATES);
  let net = 'idle'; // idle | ok | offline | failed
  if (navigator.onLine === false) net = 'offline';
  else if (!rates.builtin && Date.now() - rates.fetchedAt < REFRESH_AFTER_MS) net = 'ok';

  /* ---------- State ---------- */

  function loadState() {
    const s = store.get(KEY_STATE) || {};
    const known = (c) => typeof c === 'string' && rates.rates[c] > 0;
    const favsOk = Array.isArray(s.favs) && s.favs.length === 3 && new Set(s.favs).size === 3 && s.favs.every(known);
    const favs = favsOk ? s.favs : DEFAULT_FAVS.slice();
    const from = favs.includes(s.from) ? s.from : (favs.includes('CHF') ? 'CHF' : favs[0]);
    const targets = s.targets && typeof s.targets === 'object' ? s.targets : {};
    return { favs, from, targets, amount: '' };
  }

  function saveState() {
    store.set(KEY_STATE, { favs: state.favs, from: state.from, targets: state.targets });
  }

  const state = loadState();

  function currentTarget() {
    const saved = state.targets[state.from];
    if (saved && saved !== state.from && rates.rates[saved] > 0) return saved;
    return state.favs.find((c) => c !== state.from);
  }

  /* ---------- Numbers ---------- */

  // Accepts "1250", "1'250.50", "1.250,50", "12,5" and similar; returns a number or null.
  function parseAmount(raw) {
    let s = String(raw).replace(/[\s'’]/g, '');
    if (!s) return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      const dec = lastComma > lastDot ? ',' : '.';
      const thou = dec === ',' ? '.' : ',';
      s = s.split(thou).join('').replace(dec, '.');
    } else if (lastComma > -1) {
      s = s.replace(/,/g, (m, i) => (i === lastComma ? '.' : ''));
    } else if (lastDot > -1) {
      s = s.replace(/\./g, (m, i) => (i === lastDot ? '.' : ''));
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function fractionDigits(code) {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
    } catch (e) {
      return 2;
    }
  }

  const formatters = new Map();
  function formatter(code, digits) {
    const key = code + ':' + digits;
    if (!formatters.has(key)) {
      // Rupees use lakh/crore grouping (1,00,000); everything else uses Swiss grouping (1’000).
      formatters.set(key, new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'de-CH', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }));
    }
    return formatters.get(key);
  }

  function money(value, code, compact) {
    if (!Number.isFinite(value)) return '–';
    let digits = fractionDigits(code);
    if (compact && Math.abs(value) >= 1000) digits = 0;
    return formatter(code, digits).format(value);
  }

  const rateFormat = new Intl.NumberFormat('de-CH', { maximumSignificantDigits: 5 });

  function convert(amount, from, to) {
    return (amount / rates.rates[from]) * rates.rates[to];
  }

  let displayNames = null;
  try { displayNames = new Intl.DisplayNames(['en'], { type: 'currency' }); } catch (e) { /* older browser */ }
  const nameOf = (code) => (displayNames && displayNames.of(code)) || code;
  const allCodes = () => Object.keys(rates.rates).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  /* ---------- DOM ---------- */

  const $ = (id) => document.getElementById(id);
  const el = {
    root: document.documentElement,
    from: $('from'),
    amountRow: $('amountRow'),
    amount: $('amount'),
    clear: $('clear'),
    amountCode: $('amountCode'),
    result: $('result'),
    fit: $('fit'),
    num: $('resultNum'),
    code: $('resultCode'),
    rate: $('rate'),
    to: $('to'),
    status: $('status'),
    edit: $('edit'),
    dialog: $('dialog'),
    slots: [$('slot0'), $('slot1'), $('slot2')],
    measure: $('measure')
  };

  function tint(node, code) {
    const [h, c, l] = identity(code);
    node.style.setProperty('--h', h);
    node.style.setProperty('--c', c);
    node.style.setProperty('--l', l);
  }

  function renderFrom() {
    el.from.replaceChildren(...state.favs.map((code) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tinted';
      b.dataset.code = code;
      b.textContent = code;
      tint(b, code);
      return b;
    }));
  }

  const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let chipsKey = '';
  let more = null; // { label, text, select }

  function buildChips(from) {
    el.to.replaceChildren();
    for (const code of state.favs.filter((c) => c !== from)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.code = code;
      b.innerHTML = '<span class="chip-code"></span><span class="chip-val"></span>';
      b.firstChild.textContent = code;
      el.to.append(b);
    }

    const label = document.createElement('label');
    label.className = 'chip chip-more';
    label.innerHTML = '<span class="chip-code">More</span>' + CHEVRON + '<select aria-label="Show result in another currency"></select>';
    const select = label.querySelector('select');
    select.append(new Option('Choose a currency', '', true, true));
    select.options[0].disabled = true;
    for (const code of allCodes()) {
      if (code !== from) select.append(new Option(`${nameOf(code)} (${code})`, code));
    }
    el.to.append(label);
    more = { label, text: label.querySelector('.chip-code'), select };
  }

  function renderChips(from, to, amount) {
    const key = from + '|' + state.favs.join(',');
    if (key !== chipsKey) {
      chipsKey = key;
      buildChips(from);
    }

    for (const chip of el.to.querySelectorAll('button.chip')) {
      const code = chip.dataset.code;
      const selected = code === to;
      chip.setAttribute('aria-pressed', String(selected));
      chip.querySelector('.chip-val').textContent =
        !selected && amount !== null ? money(convert(amount, from, code), code, true) : '';
    }

    const custom = !state.favs.includes(to);
    more.label.dataset.active = String(custom);
    more.text.textContent = custom ? to : 'More';
    more.select.value = custom ? to : '';
  }

  function renderStatus() {
    const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(new Date(rates.date + 'T12:00:00Z'));
    const age = Math.floor((Date.now() - Date.parse(rates.date + 'T00:00:00Z')) / 86400000);
    const stale = age > STALE_AFTER_DAYS;
    const kind = rates.builtin ? 'built-in rates' : 'rates';
    const basis = stale ? `${kind} are ${age} days old (${when})` : `${kind} from ${when}`;

    let text;
    let tone = 'idle';
    if (net === 'offline') {
      text = `Offline: using ${basis}`;
    } else if (net === 'failed') {
      text = `Couldn’t refresh: using ${basis}`;
      tone = 'warn';
    } else if (rates.builtin) {
      text = `Using ${basis}. Connect once to refresh.`;
    } else {
      text = `ECB ${basis}`;
      if (net === 'ok') tone = 'ok';
    }
    if (stale && tone !== 'idle') tone = 'warn';
    if (stale && net === 'offline') tone = 'warn';

    el.status.textContent = text;
    el.status.dataset.state = tone;
  }

  function fitText(node, base, min, text, available) {
    el.measure.style.fontSize = base + 'px';
    el.measure.textContent = text;
    const width = el.measure.offsetWidth;
    const scale = width > 0 && available > 0 ? Math.min(1, available / (width + 2)) : 1;
    node.style.fontSize = Math.max(min, base * scale) + 'px';
  }

  function fitAll() {
    fitText(el.amount, AMOUNT_BASE_PX, 26, el.amount.value || el.amount.placeholder, el.amount.clientWidth);
    fitText(el.num, RESULT_BASE_PX, 30, el.num.textContent, el.fit.clientWidth);
  }

  let renderPending = false;

  function render() {
    // Don't rebuild anything while the system currency picker is open.
    if (more && document.activeElement === more.select) {
      renderPending = true;
      return;
    }
    renderPending = false;

    const from = state.from;
    const to = currentTarget();
    const amount = parseAmount(state.amount);

    el.root.style.setProperty('--bg-h', identity(from)[0]);
    tint(el.amountRow, from);
    el.amountCode.textContent = from;
    el.amount.setAttribute('aria-label', `Amount in ${from}`);
    el.clear.hidden = !state.amount;

    for (const b of el.from.children) {
      b.setAttribute('aria-pressed', String(b.dataset.code === from));
    }

    tint(el.result, to);
    el.code.textContent = to;
    const out = amount === null ? null : convert(amount, from, to);
    el.num.textContent = out === null ? '–' : money(out, to);
    el.result.classList.toggle('is-empty', out === null);
    el.rate.textContent = `1 ${from} = ${rateFormat.format(rates.rates[to] / rates.rates[from])} ${to}`;

    renderChips(from, to, amount);
    renderStatus();
    fitAll();
  }

  /* ---------- Actions ---------- */

  function setFrom(code) {
    if (code === state.from) return;
    state.from = code;
    saveState();
    render();
  }

  function setTarget(code) {
    if (!code || code === state.from) return;
    state.targets[state.from] = code;
    saveState();
    render();
  }

  /* ---------- Events ---------- */

  el.from.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-code]');
    if (b) setFrom(b.dataset.code);
  });

  el.to.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-code]');
    if (b) setTarget(b.dataset.code);
  });

  el.to.addEventListener('change', (e) => {
    if (!e.target.matches('select')) return;
    const code = e.target.value;
    e.target.blur(); // render() waits while the picker is focused
    setTarget(code);
  });

  el.to.addEventListener('focusout', (e) => {
    if (renderPending && e.target.matches && e.target.matches('select')) setTimeout(render, 0);
  });

  el.amount.addEventListener('input', () => {
    const clean = el.amount.value.replace(/[^\d.,]/g, '');
    if (clean !== el.amount.value) el.amount.value = clean;
    state.amount = clean;
    render();
  });

  // Selecting the old amount on focus means the next digit replaces it.
  el.amount.addEventListener('focus', () => setTimeout(() => el.amount.select(), 0));

  el.clear.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard open
  el.clear.addEventListener('click', () => {
    el.amount.value = '';
    state.amount = '';
    render();
    el.amount.focus();
  });

  // The iPhone decimal pad has no Done key, so tapping empty space closes it.
  document.addEventListener('pointerdown', (e) => {
    if (document.activeElement === el.amount && !e.target.closest('input, button, select, label, dialog')) {
      el.amount.blur();
    }
  });

  /* Edit currencies */

  el.edit.addEventListener('click', () => {
    const codes = allCodes();
    el.slots.forEach((select, i) => {
      select.replaceChildren(...codes.map((c) => new Option(`${nameOf(c)} (${c})`, c)));
      select.value = state.favs[i];
    });
    if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
  });

  el.slots.forEach((select, i) => {
    select.addEventListener('change', () => {
      const next = select.value;
      const favs = state.favs.slice();
      const clash = favs.indexOf(next);
      if (clash > -1 && clash !== i) favs[clash] = favs[i]; // swap instead of duplicating
      favs[i] = next;
      state.favs = favs;
      el.slots.forEach((s, k) => { s.value = favs[k]; });
      if (!favs.includes(state.from)) state.from = favs[0];
      saveState();
      renderFrom();
      render();
    });
  });

  el.dialog.addEventListener('click', (e) => {
    const r = el.dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) el.dialog.close();
  });

  /* ---------- Refreshing rates ---------- */

  function reconcileState() {
    const known = (c) => rates.rates[c] > 0;
    if (!state.favs.every(known)) state.favs = DEFAULT_FAVS.slice();
    if (!state.favs.includes(state.from)) state.from = state.favs[0];
    renderFrom();
  }

  async function refreshRates(force) {
    if (navigator.onLine === false) {
      net = 'offline';
      renderStatus();
      return;
    }
    if (!force && !rates.builtin && Date.now() - rates.fetchedAt < REFRESH_AFTER_MS) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const next = { date: data.date, rates: Object.assign({ EUR: 1 }, data.rates), fetchedAt: Date.now(), builtin: false };
      if (!validRates(next)) throw new Error('Unexpected response');
      rates = next;
      net = 'ok';
      store.set(KEY_RATES, rates);
      reconcileState();
    } catch (e) {
      net = navigator.onLine === false ? 'offline' : 'failed';
    } finally {
      clearTimeout(timer);
      chipsKey = ''; // the list of currencies may have changed
      render();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshRates(false);
  });
  window.addEventListener('online', () => refreshRates(true));
  window.addEventListener('offline', () => { net = 'offline'; renderStatus(); });
  window.addEventListener('resize', fitAll);

  /* ---------- Start ---------- */

  renderFrom();
  render();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
  refreshRates(false);

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
