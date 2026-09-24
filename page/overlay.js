// The on-page UI: viewfinder brackets around the field, the tag card with its
// name and location, the little status bar and a toast. Lives in a shadow root
// so the page's CSS cannot reach it, and in the top layer so it sits above
// modal dialogs. Built with DOM calls only (no innerHTML) — names and paths
// come from the page and are always inserted as text.
(() => {
  const V = '0.1.0';
  const lib = (window.__REACT_FORM_INSPECTOR_LIB__ ??= {});
  if (lib.overlay?.v === V) return;

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.ui {
  --graphite: #1c1d21;
  --graphite-2: #26272c;
  --ink: #ededea;
  --muted: #a3a6ae;
  --line: rgba(255, 255, 255, 0.1);
  --marker: #ffd60a;
  --marker-deep: #f5b700;
  --warn: #ff9e8a;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "Cascadia Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font: 12px/1.45 var(--sans);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
[hidden] { display: none !important; }

/* viewfinder */
.box {
  position: fixed; left: 0; top: 0; pointer-events: none;
  background: rgba(255, 214, 10, 0.12);
  outline: 1px dashed rgba(28, 29, 33, 0.55);
  outline-offset: 0;
  border-radius: 2px;
}
.box.pinned { background: rgba(255, 214, 10, 0.2); outline: 1.5px solid var(--marker-deep); }
.corner {
  position: absolute; width: 11px; height: 11px;
  border: 0 solid var(--marker);
  filter: drop-shadow(0 0 0.6px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 0.6px rgba(0, 0, 0, 0.9));
}
.tl { left: -5px; top: -5px; border-left-width: 3px; border-top-width: 3px; }
.tr { right: -5px; top: -5px; border-right-width: 3px; border-top-width: 3px; }
.bl { left: -5px; bottom: -5px; border-left-width: 3px; border-bottom-width: 3px; }
.br { right: -5px; bottom: -5px; border-right-width: 3px; border-bottom-width: 3px; }

/* tag */
.tag {
  position: fixed; left: 0; top: 0;
  width: max-content; max-width: min(440px, calc(100vw - 16px));
  pointer-events: none;
  background: var(--graphite);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  overflow: hidden auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.tag.pinned { pointer-events: auto; }
.tag-body { padding: 9px 12px 10px; display: grid; gap: 3px; }
.title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.fname {
  font: 600 15px/1.25 var(--mono); color: var(--marker);
  overflow-wrap: anywhere; min-width: 0;
}
.fname.none { color: var(--muted); font-weight: 500; }
.fname.element { color: var(--ink); }
.chip {
  margin-left: auto; flex: none;
  font: 500 10px/1 var(--sans); letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--graphite); background: var(--marker); border-radius: 3px; padding: 3px 5px 2px;
}
.chip.quiet { color: var(--muted); background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
.owner { color: var(--muted); overflow-wrap: anywhere; }
.owner b { color: var(--ink); font-weight: 600; font-family: var(--mono); font-size: 12px; }
.owner code { font-family: var(--mono); font-size: 11.5px; color: var(--muted); }
.path { font: 11.5px/1.4 var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.path b { color: var(--ink); font-weight: 600; }
.path .approx { font-family: var(--sans); color: var(--muted); }
.meta { color: var(--muted); }
.warn { color: var(--warn); }

.actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 9px 12px; border-top: 1px solid var(--line); }
button {
  all: unset; box-sizing: border-box; cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px;
  font: 500 12px/1 var(--sans); color: var(--ink);
  padding: 7px 9px; border-radius: 5px;
  background: var(--graphite-2); box-shadow: inset 0 0 0 1px var(--line);
}
button:hover { background: #303137; }
button.primary { background: var(--marker); color: var(--graphite); box-shadow: none; }
button.primary:hover { background: #ffe14d; }
button[disabled] { opacity: 0.45; cursor: default; }
button.ghost { background: transparent; box-shadow: none; color: var(--muted); margin-left: auto; }
button.ghost:hover { background: var(--graphite-2); color: var(--ink); }
kbd {
  font: 500 10px/1 var(--mono); padding: 2px 4px; border-radius: 3px;
  background: rgba(0, 0, 0, 0.25); color: inherit; opacity: 0.8;
}
.copies { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; padding: 0 12px 9px; color: var(--muted); }
.link { all: unset; cursor: pointer; color: var(--ink); text-decoration: underline; text-decoration-color: rgba(255, 214, 10, 0.5); text-underline-offset: 2px; }
.link:hover { text-decoration-color: var(--marker); }

.stack { border-top: 1px solid var(--line); padding: 7px 6px 7px; display: grid; }
.stack-h { font: 600 10px/1 var(--sans); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); padding: 2px 6px 6px; }
.row {
  all: unset; box-sizing: border-box; cursor: pointer;
  display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: 12px; align-items: baseline;
  padding: 4px 6px; border-radius: 4px;
}
.row:hover { background: var(--graphite-2); }
.row .n { font: 600 11.5px/1.3 var(--mono); color: var(--ink); white-space: nowrap; }
.row .w { font: 11px/1.3 var(--mono); color: var(--muted); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; }
.row .w span { direction: ltr; unicode-bidi: isolate; }
.hint { border-top: 1px solid var(--line); padding: 6px 12px; color: var(--muted); font-size: 11px; }
.hint kbd { margin: 0 1px; }

/* status bar */
.bar {
  position: fixed; right: 14px; bottom: 14px; pointer-events: auto;
  display: flex; align-items: center; gap: 10px;
  background: var(--graphite); border-radius: 999px; padding: 5px 5px 5px 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  max-width: calc(100vw - 28px);
}
.brand { display: flex; align-items: center; gap: 7px; font-weight: 600; white-space: nowrap; }
.mark { width: 12px; height: 12px; position: relative; flex: none; }
.mark::before, .mark::after { content: ""; position: absolute; width: 5px; height: 5px; border: 0 solid var(--marker); }
.mark::before { left: 0; top: 0; border-left-width: 2px; border-top-width: 2px; }
.mark::after { right: 0; bottom: 0; border-right-width: 2px; border-bottom-width: 2px; }
.seg { display: flex; background: var(--graphite-2); border-radius: 999px; padding: 2px; box-shadow: inset 0 0 0 1px var(--line); }
.seg button { padding: 5px 9px; border-radius: 999px; background: transparent; box-shadow: none; font-size: 11.5px; color: var(--muted); }
.seg button[aria-pressed="true"] { background: var(--marker); color: var(--graphite); }
.folder { color: var(--muted); font: 11px/1.2 var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
.folder.warn { color: var(--warn); font-family: var(--sans); }
.close { padding: 6px 8px; border-radius: 999px; background: transparent; box-shadow: none; color: var(--muted); font-size: 13px; }
.close:hover { color: var(--ink); }

.toast {
  position: fixed; right: 14px; bottom: 58px; pointer-events: none;
  background: var(--marker); color: var(--graphite); font-weight: 600;
  padding: 7px 11px; border-radius: 6px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  opacity: 0; transform: translateY(4px); transition: opacity 0.14s, transform 0.14s;
}
.toast.on { opacity: 1; transform: none; }
.toast.bad { background: var(--warn); }
@media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;

  /** h('div', { class: 'x', dataset: { action: 'copy' } }, 'text', child) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'text') el.textContent = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function splitPath(display) {
    const i = display.lastIndexOf('/');
    return i < 0 ? ['', display] : [display.slice(0, i + 1), display.slice(i + 1)];
  }

  function shortDir(dir, max = 46) {
    if (dir.length <= max) return dir;
    const parts = dir.split('/').filter(Boolean);
    let out = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      const next = parts[i] + '/' + out;
      if (next.length > max - 2) break;
      out = next;
    }
    return '…/' + out;
  }

  const fileOf = (display) => splitPath(display)[1];

  function create() {
    const host = document.createElement('react-form-inspector');
    host.setAttribute('popover', 'manual');
    // Set through the CSSOM (allowed under a strict CSP, unlike a style="" attribute).
    // !important so neither page CSS nor the UA's [popover] rules can move it or
    // let it catch clicks meant for the page.
    for (const [prop, value] of Object.entries({
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      'max-width': 'none',
      'max-height': 'none',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      overflow: 'visible',
      'pointer-events': 'none',
      'z-index': '2147483647',
      display: 'block',
    })) {
      host.style.setProperty(prop, value, 'important');
    }
    const root = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];

    const box = h('div', { class: 'box', hidden: true }, ['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: `corner ${c}` })));
    const tag = h('div', { class: 'tag', hidden: true, role: 'dialog', 'aria-label': 'Field details' });
    const bar = h('div', { class: 'bar' });
    const toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    const ui = h('div', { class: 'ui' }, box, tag, toastEl, bar);
    root.append(ui);
    document.documentElement.append(host);

    const raise = () => {
      if (typeof host.showPopover !== 'function') return;
      try {
        if (host.matches(':popover-open')) host.hidePopover();
        host.showPopover();
      } catch {
        // Not connected yet, or the page removed it.
      }
    };
    raise();

    // ---- box -------------------------------------------------------------

    function showBox(rect, pinned) {
      if (!rect) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      box.classList.toggle('pinned', pinned);
      Object.assign(box.style, {
        transform: `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`,
        width: `${Math.max(2, Math.round(rect.width))}px`,
        height: `${Math.max(2, Math.round(rect.height))}px`,
      });
    }

    // ---- tag -------------------------------------------------------------

    function titleRow(m) {
      if (m.name) {
        const title = `Declared as ${m.nameSource}${m.nameOnDom ? ` · on the DOM as name="${m.name}"` : ' · not on the DOM'}`;
        return h(
          'div',
          { class: 'title' },
          h('span', { class: 'fname' }, m.name),
          h('span', { class: m.nameOnDom ? 'chip' : 'chip quiet', title }, m.nameOnDom ? 'name attr' : 'prop only'),
        );
      }
      if (m.isField) {
        return h('div', { class: 'title' }, h('span', { class: 'fname none' }, 'unnamed field'), h('span', { class: 'chip quiet' }, 'no name'));
      }
      return h('div', { class: 'title' }, h('span', { class: 'fname element' }, `<${m.element}>`), h('span', { class: 'chip quiet' }, 'element'));
    }

    function ownerRow(m) {
      const bits = [];
      if (m.component) bits.push('in ', h('b', null, m.component));
      if (m.element && (m.name || m.isField)) {
        if (bits.length) bits.push('  ·  ');
        bits.push(h('code', null, `<${m.element}>`));
      }
      if (m.form && m.form !== m.component) bits.push('  ·  form ', h('b', null, m.form));
      return bits.length ? h('div', { class: 'owner' }, bits) : null;
    }

    function pathRow(m) {
      const loc = m.location;
      if (loc === 'loading') return h('div', { class: 'path' }, 'locating source…');
      if (!loc) return h('div', { class: 'path warn' }, m.locationNote ?? 'No source location (production build?)');
      const [dir, file] = splitPath(loc.display);
      return h(
        'div',
        { class: 'path', title: loc.abs ?? loc.display },
        shortDir(dir),
        h('b', null, file),
        `:${loc.line}`,
        loc.stale
          ? h('span', { class: 'approx', title: 'The file was hot-updated after this element mounted. Reload the page for the exact line.' }, '  · edited, reload for exact line')
          : loc.exact
            ? null
            : h('span', { class: 'approx' }, '  (approx.)'),
      );
    }

    function metaRow(m) {
      const bits = [];
      if (m.label) bits.push(`“${m.label}”`);
      if (m.kind) bits.push(m.kind);
      return bits.length ? h('div', { class: 'meta' }, bits.join('  ·  ')) : null;
    }

    function pinnedParts(m) {
      const openLabel = m.canOpen ? `Open in ${m.editorLabel}` : 'Open in editor';
      const actions = h(
        'div',
        { class: 'actions' },
        h('button', { class: 'primary', dataset: { action: 'copy-name' } }, m.name ? 'Copy name' : 'Copy path', h('kbd', null, 'C')),
        h('button', { dataset: { action: 'open' }, disabled: !m.canOpen, title: m.canOpen ? null : m.openReason }, openLabel, h('kbd', null, 'O')),
        h('button', { class: 'ghost', dataset: { action: 'unpin' }, title: 'Unpin (P or Esc)' }, 'Unpin', h('kbd', null, 'P')),
      );
      const copies = h(
        'div',
        { class: 'copies' },
        'Copy',
        m.component ? h('button', { class: 'link', dataset: { action: 'copy-component' } }, 'component') : null,
        m.location && m.location !== 'loading' ? h('button', { class: 'link', dataset: { action: 'copy-path' } }, 'path:line') : null,
        h('button', { class: 'link', dataset: { action: 'copy-all' } }, 'all details'),
      );
      const rows = (m.stack ?? []).map((r, i) =>
        h(
          'button',
          { class: 'row', dataset: { action: 'open-stack', index: String(i) }, title: r.loc ? `Open ${r.loc.abs ?? r.loc.display}:${r.loc.line}` : 'No source location' },
          h('span', { class: 'n' }, `<${r.name}>`),
          h('span', { class: 'w' }, h('span', null, r.loc === 'loading' ? '…' : r.loc ? `${fileOf(r.loc.display)}:${r.loc.line}` : '—')),
        ),
      );
      const stack = rows.length > 1 ? h('div', { class: 'stack' }, h('div', { class: 'stack-h' }, 'Component stack · used at'), rows) : null;
      return [actions, copies, stack];
    }

    function hintRow(m) {
      const open = `open in ${m.editorLabel}`;
      const copy = m.name ? 'copy name' : 'copy path';
      const [first, second, key] = m.clickAction === 'open' ? [open, copy, 'Shift'] : [copy, open, 'Ctrl'];
      return h('div', { class: 'hint' }, `Click ${first}  ·  `, h('kbd', null, key), `+click ${second}  ·  `, h('kbd', null, 'P'), ' pin');
    }

    let lastAnchor = null;

    function showTag(m, anchor) {
      if (!m) {
        tag.hidden = true;
        return;
      }
      lastAnchor = anchor;
      tag.replaceChildren(
        h('div', { class: 'tag-body' }, titleRow(m), ownerRow(m), pathRow(m), metaRow(m)),
        ...(m.pinned ? pinnedParts(m) : [m.hint ? hintRow(m) : null].filter(Boolean)),
      );
      tag.classList.toggle('pinned', Boolean(m.pinned));
      tag.hidden = false;
      placeTag(anchor);
    }

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

    /** Below the field, else above, else beside it — never over the status bar. */
    function placeTag(anchor) {
      if (!anchor || tag.hidden) return;
      const gap = 10;
      const pad = 8;
      const vw = document.documentElement.clientWidth || innerWidth;
      const vh = innerHeight;
      tag.style.maxHeight = `${vh - pad * 2}px`;
      const { width, height } = tag.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      const hitsBar = (l, t) => b.width > 0 && l < b.right && l + width > b.left && t < b.bottom && t + height > b.top;
      const fits = (l, t) => t >= pad && t + height <= vh - pad && !hitsBar(l, t);

      let left = clamp(anchor.left, pad, vw - width - pad);
      let top = anchor.bottom + gap;
      if (!fits(left, top)) {
        const above = anchor.top - gap - height;
        const side = clamp(anchor.top, pad, vh - height - pad);
        if (fits(left, above)) top = above;
        else if (anchor.right + gap + width <= vw - pad && fits(anchor.right + gap, side)) [left, top] = [anchor.right + gap, side];
        else if (anchor.left - gap - width >= pad && fits(anchor.left - gap - width, side)) [left, top] = [anchor.left - gap - width, side];
        else top = clamp(top, pad, vh - height - pad);
      }
      tag.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    // ---- bar -------------------------------------------------------------

    function setBar(b) {
      const folder = b.warning
        ? h('span', { class: 'folder warn', title: b.warning }, b.warning)
        : h('span', { class: 'folder', title: b.folderTitle ?? '' }, b.folder);
      bar.replaceChildren(
        h('span', { class: 'brand' }, h('span', { class: 'mark', 'aria-hidden': 'true' }), 'Form Inspector'),
        h(
          'span',
          { class: 'seg', role: 'group', 'aria-label': 'What to inspect' },
          h('button', { dataset: { action: 'mode', mode: 'fields' }, 'aria-pressed': String(b.mode === 'fields') }, 'Fields'),
          h('button', { dataset: { action: 'mode', mode: 'all' }, 'aria-pressed': String(b.mode === 'all') }, 'All'),
        ),
        folder,
        h('button', { class: 'close', dataset: { action: 'stop' }, title: 'Stop inspecting (Esc)', 'aria-label': 'Stop inspecting' }, '✕'),
      );
    }

    // ---- toast -----------------------------------------------------------

    let toastTimer = 0;
    function toast(text, bad = false) {
      toastEl.textContent = text;
      toastEl.classList.toggle('bad', bad);
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1600);
    }

    // ---- events ----------------------------------------------------------

    const owns = (e) => e.composedPath().includes(host);

    function actionOf(e) {
      for (const n of e.composedPath()) {
        if (n === host) break;
        if (n instanceof HTMLElement && n.dataset?.action) {
          return n.hasAttribute('disabled') ? null : { action: n.dataset.action, ...n.dataset };
        }
      }
      return null;
    }

    return {
      host,
      root,
      owns,
      actionOf,
      showBox,
      showTag,
      moveTag: (rect) => {
        lastAnchor = rect;
        placeTag(rect);
      },
      setBar,
      toast,
      raise,
      destroy: () => {
        clearTimeout(toastTimer);
        host.remove();
      },
    };
  }

  lib.overlay = { v: V, create };
})();
