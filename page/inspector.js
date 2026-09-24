// The inspector itself: listens to the pointer, asks fiber.js what is under it,
// resolves the source line with source.js and draws it with overlay.js.
// Exposes window.__REACT_FORM_INSPECTOR__ (used by the extension, and handy in
// the DevTools console: __REACT_FORM_INSPECTOR__.inspect($0)).
(() => {
  const V = '0.1.0';
  const previous = window.__REACT_FORM_INSPECTOR__;
  if (previous?.version === V) return;
  previous?.stop?.(); // an older copy, left behind by an extension update

  const lib = window.__REACT_FORM_INSPECTOR_LIB__;
  const { fiber, source, overlay } = lib;

  const DEFAULT_CONFIG = {
    source: null,
    editor: 'vscode',
    editorLabel: 'VS Code',
    template: 'vscode://file{urlPath}:{line}:{column}',
    clickAction: 'copy',
    mode: 'fields',
  };

  const state = {
    active: false,
    cfg: { ...DEFAULT_CONFIG },
    ui: null,
    page: null, // detectReact() result
    hoverTarget: null,
    current: null, // { info, placed, stack } for the hovered or pinned element
    pinned: false,
    frame: 0,
    scrollFrame: 0,
    point: null,
    lastModal: null,
    token: 0,
  };

  // ---------------------------------------------------------------------------
  // Model: analysis + resolved locations
  // ---------------------------------------------------------------------------

  function unionRect(nodes) {
    let r = null;
    for (const n of nodes) {
      if (!n.isConnected) continue;
      const b = n.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      r = r
        ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) }
        : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    }
    return r && { ...r, width: r.right - r.left, height: r.bottom - r.top };
  }

  /** Everything the tag shows, from an analysis plus whatever has resolved so far. */
  function model(entry) {
    const { info } = entry;
    const target = entry.placed ? source.editorTarget(entry.placed, state.cfg) : null;
    return {
      pinned: state.pinned,
      hint: !state.pinned,
      clickAction: state.cfg.clickAction === 'open' ? 'open' : 'copy',
      isField: info.isField,
      name: info.name,
      nameSource: info.nameSource,
      nameOnDom: info.nameOnDom,
      element: info.element,
      component: info.component,
      form: info.form,
      label: info.label,
      kind: info.kind,
      location: entry.placed === undefined ? 'loading' : entry.placed,
      locationNote: entry.note,
      editorLabel: state.cfg.editorLabel,
      canOpen: target?.kind === 'link' || target?.kind === 'fetch',
      openReason: target?.kind === 'missing' ? target.reason : null,
      stack: entry.stack,
    };
  }

  function noteFor(info) {
    if (!state.page?.dev) return 'Production build: React keeps no source locations.';
    if (!info.site) return 'React did not record where this element was created.';
    return null;
  }

  function analyzeElement(el) {
    const info = fiber.analyze(el, { mode: state.cfg.mode });
    if (!info || !info.highlight) return info ? { info } : null;
    return { info, placed: info.site ? undefined : null, note: noteFor(info), stack: null };
  }

  async function resolveEntry(entry, token) {
    const loc = await source.resolveSite(entry.info.site);
    if (token !== state.token) return;
    entry.placed = source.place(loc, state.cfg);
    refreshTag();
    renderBar();
  }

  async function resolveStack(entry, token) {
    entry.stack = entry.info.stack.map((r) => ({ name: r.name, loc: r.site ? 'loading' : null, site: r.site }));
    refreshTag();
    await Promise.all(
      entry.stack.map(async (row) => {
        if (!row.site) return;
        row.loc = source.place(await source.resolveSite(row.site), state.cfg);
      }),
    );
    if (token === state.token) refreshTag();
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  function rectOf(entry) {
    return entry ? unionRect(entry.info.highlight) : null;
  }

  function draw() {
    const entry = state.current;
    const rect = rectOf(entry);
    if (!entry || !rect) {
      state.ui.showBox(null);
      state.ui.showTag(null);
      return;
    }
    state.ui.showBox(rect, state.pinned);
    state.ui.showTag(model(entry), rect);
  }

  function refreshTag() {
    if (state.current) draw();
  }

  function reposition() {
    const entry = state.current;
    const rect = rectOf(entry);
    if (!rect) {
      // The pinned field was unmounted (dialog closed, route changed).
      if (state.pinned) return unpin();
      return draw();
    }
    state.ui.showBox(rect, state.pinned);
    state.ui.moveTag(rect);
  }

  function renderBar() {
    if (!state.ui) return;
    const page = state.page;
    let warning = null;
    if (!page?.react) warning = 'React not found on this page';
    else if (!page.dev) warning = 'Production build: names only';
    else if (!page.sources) warning = 'No source info (React 19.0?)';
    const root = source.getDetectedRoot();
    const folder = state.cfg.source ? state.cfg.source.name : root ? 'dev-server paths' : 'no project folder';
    const folderTitle = state.cfg.source ? state.cfg.source.root : root ? `Detected: ${root}` : 'Paste the project folder in the extension popup';
    state.ui.setBar({ mode: state.cfg.mode, folder, folderTitle, warning });
  }

  function setCurrent(entry) {
    state.token++;
    state.current = entry;
    draw();
    if (entry && entry.placed === undefined) resolveEntry(entry, state.token);
    if (entry && state.pinned) resolveStack(entry, state.token);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Without focusing anything: a focused textarea would trip the page's focus
   * trap (Radix pulls focus back into the dialog and selects the user's input,
   * which is then what gets copied). Fill the clipboard from a copy event instead.
   */
  function execCopy(text) {
    const onCopy = (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
    };
    const selection = getSelection();
    const saved = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    window.addEventListener('copy', onCopy, true);
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      window.removeEventListener('copy', onCopy, true);
      if (saved) {
        selection.removeAllRanges();
        selection.addRange(saved);
      }
    }
  }

  async function copy(text, what) {
    if (!text) return;
    let ok = false;
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = false;
      }
    }
    // Plain http on a LAN address has no navigator.clipboard at all.
    if (!ok) ok = execCopy(text);
    state.ui.toast(ok ? `Copied ${what}` : 'Could not reach the clipboard', !ok);
  }

  function locationText(placed) {
    return placed ? `${placed.rel && !placed.rel.startsWith('../') ? placed.rel : placed.abs ?? placed.display}:${placed.line}:${placed.column}` : null;
  }

  function detailsText(entry) {
    const { info, placed } = entry;
    const lines = [];
    lines.push(`Field: ${info.name ?? '(no name)'}`);
    if (info.label) lines.push(`Label: ${info.label}`);
    if (info.component) lines.push(`Component: ${info.component}`);
    if (info.element) lines.push(`Element: <${info.element}>`);
    if (info.form && info.form !== info.component) lines.push(`Form: ${info.form}`);
    const loc = locationText(placed);
    if (loc) lines.push(`Source: ${loc}`);
    return lines.join('\n');
  }

  function open(placed) {
    const target = source.editorTarget(placed, state.cfg);
    if (target.kind === 'missing') {
      state.ui.toast(target.reason, true);
      return;
    }
    if (target.kind === 'fetch') {
      fetch(target.url).then(
        (res) => state.ui.toast(res.ok ? `Opened ${fileName(placed)}` : `Dev server answered ${res.status}`, !res.ok),
        () => state.ui.toast('Dev server not reachable', true),
      );
      return;
    }
    // A custom-scheme link hands off to the OS; the page itself does not navigate.
    location.href = target.url;
    state.ui.toast(`Opening ${fileName(placed)} in ${state.cfg.editorLabel}`);
  }

  const fileName = (placed) => (placed?.display ?? '').split('/').pop();

  /** Runs once the location is known (it may still be resolving on a fast click). */
  async function whenPlaced(entry) {
    if (entry.placed === undefined) {
      entry.placed = source.place(await source.resolveSite(entry.info.site), state.cfg);
    }
    return entry.placed;
  }

  async function runAction(a) {
    const entry = state.current;
    switch (a.action) {
      case 'stop':
        return stop();
      case 'mode':
        state.cfg.mode = a.mode === 'all' ? 'all' : 'fields';
        unpin();
        return renderBar();
    }
    if (a.action === 'unpin') return unpin();
    if (!entry) return;
    switch (a.action) {
      case 'copy-name':
        return copyFieldName(entry);
      case 'copy-component':
        return copy(entry.info.component, `“${entry.info.component}”`);
      case 'copy-path':
        return copy(locationText(await whenPlaced(entry)), 'path');
      case 'copy-all':
        await whenPlaced(entry);
        return copy(detailsText(entry), 'details');
      case 'open':
        // Opening a custom scheme needs the click's user activation: don't await.
        return entry.placed === undefined ? state.ui.toast('Still locating the source…') : open(entry.placed);
      case 'open-stack': {
        const row = entry.stack?.[Number(a.index)];
        if (row?.loc && row.loc !== 'loading') open(row.loc);
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer & keyboard
  // ---------------------------------------------------------------------------

  function targetOf(e) {
    const t = e.composedPath()[0];
    return t instanceof Element ? t : t?.parentElement ?? null;
  }

  /** What is under the pointer. Also works over disabled controls, which get no mouse events. */
  function elementAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === state.ui.host) return null;
    // Descend into open shadow roots (web components on the page).
    let deepest = el;
    while (deepest.shadowRoot && deepest.shadowRoot !== state.ui.root) {
      const inner = deepest.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === deepest) break;
      deepest = inner;
    }
    return deepest;
  }

  function hover(target) {
    if (state.pinned || target === state.hoverTarget) return;
    state.hoverTarget = target;
    const entry = target ? analyzeElement(target) : null;
    setCurrent(entry?.info?.highlight ? entry : null);
  }

  function checkModal() {
    // A modal <dialog> opened after us sits above us in the top layer: re-raise.
    const modal = document.querySelector('dialog:modal');
    if (modal !== state.lastModal) {
      state.lastModal = modal;
      if (modal) state.ui.raise();
    }
  }

  function onMove(e) {
    state.point = { x: e.clientX, y: e.clientY };
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      checkModal();
      const target = elementAt(state.point.x, state.point.y);
      if (target) hover(target);
    });
  }

  function pin(entry) {
    state.pinned = true;
    state.hoverTarget = null;
    setCurrent(entry);
  }

  function unpin() {
    state.pinned = false;
    state.hoverTarget = null;
    setCurrent(null);
    // Pick up whatever is under the pointer now, without waiting for it to move.
    const target = state.point && elementAt(state.point.x, state.point.y);
    if (target) hover(target);
  }

  /**
   * A click acts on the field right away: copy its name, or open it in the
   * editor (which one is the popup's "On click" setting; Ctrl/⌘ and Shift pick
   * the other). Pinning is on the keyboard (P), so a click never has to.
   * Handled on press, not click: disabled controls never get a click.
   */
  function onPress(e) {
    if (e.button !== 0) return;
    if (state.pinned) unpin();
    const target = elementAt(e.clientX, e.clientY) ?? targetOf(e);
    let entry = target ? analyzeElement(target) : null;
    if (!entry?.info?.highlight) return;
    // Same field as the one under the pointer: keep its already-resolved location.
    if (state.current && state.current.info.decl === entry.info.decl) entry = state.current;
    else setCurrent(entry);
    const action = e.ctrlKey || e.metaKey ? 'open' : e.shiftKey ? 'copy' : state.cfg.clickAction === 'open' ? 'open' : 'copy';
    if (action === 'open') {
      if (entry.placed !== undefined) open(entry.placed);
      // First sight of this element: resolve, then open.
      else whenPlaced(entry).then((placed) => open(placed));
      return;
    }
    copyFieldName(entry);
  }

  /** The name; for a field without one, where it is declared. */
  async function copyFieldName(entry) {
    if (entry.info.name) return copy(entry.info.name, `“${entry.info.name}”`);
    const where = locationText(await whenPlaced(entry));
    if (where) return copy(where, 'path (no field name)');
    state.ui.toast('Nothing to copy: no name and no source line', true);
  }

  /** P: freeze the tag on the hovered field so its buttons can be clicked. */
  function togglePin() {
    if (state.pinned) return unpin();
    if (state.current) pin(state.current);
  }

  /**
   * Every pointer event stops here, before the page's own handlers (React's
   * root listener, a dialog's click-outside, a select opening on press).
   * Our own buttons are handled here too, on click.
   */
  function block(e) {
    e.stopImmediatePropagation();
    const ours = state.ui.owns(e);
    // Cancelling the press keeps focus and text selection where they were;
    // cancelling click stops links and submit buttons.
    if (e.type !== 'pointerup' && e.type !== 'mouseup') e.preventDefault();
    if (ours) {
      if (e.type === 'click') {
        const a = state.ui.actionOf(e);
        if (a) runAction(a);
      }
      return;
    }
    if (e.type === 'pointerdown') onPress(e);
  }

  /** The panel scrolls even while a modal's scroll lock cancels wheel events outside it. */
  function shieldScroll(e) {
    if (state.ui.owns(e)) e.stopImmediatePropagation();
  }

  function cancel(e) {
    e.preventDefault();
  }

  function onPageShow(e) {
    // Back/forward cache: the page (and we) came back, but the badge was cleared.
    if (e.persisted && state.active) document.dispatchEvent(new Event('react-form-inspector:on'));
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // e.code, not e.key: the same physical key under any layout or Vietnamese IME.
    if (e.code === 'KeyP' && (state.current || state.pinned)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      togglePin();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (state.pinned) {
        unpin();
      } else {
        stop();
        // Don't let the matching keyup reach a dialog that closes on keyup.
        window.addEventListener('keyup', (up) => up.key === 'Escape' && up.stopImmediatePropagation(), { capture: true, once: true });
      }
      return;
    }
    if (!state.pinned) return;
    const action = e.code === 'KeyC' ? 'copy-name' : e.code === 'KeyO' ? 'open' : null;
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    runAction({ action });
  }

  function onKeyUp(e) {
    if (e.key === 'Escape') e.stopImmediatePropagation();
  }

  function onScroll() {
    if (state.scrollFrame || !state.current) return;
    state.scrollFrame = requestAnimationFrame(() => {
      state.scrollFrame = 0;
      reposition();
    });
  }

  const BLOCKED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick'];
  const listen = [
    ['pointermove', onMove, { capture: true, passive: true }],
    ['keydown', onKey, { capture: true }],
    ['keyup', onKeyUp, { capture: true }],
    ['scroll', onScroll, { capture: true, passive: true }],
    ['resize', onScroll, { passive: true }],
    ['wheel', shieldScroll, { capture: true, passive: true }],
    ['touchmove', shieldScroll, { capture: true, passive: true }],
    ['selectstart', cancel, { capture: true }],
    ['dragstart', cancel, { capture: true }],
    ['pageshow', onPageShow],
    ...BLOCKED.map((type) => [type, block, { capture: true }]),
  ];

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function configure(cfg) {
    if (cfg && typeof cfg === 'object') state.cfg = { ...DEFAULT_CONFIG, ...state.cfg, ...cfg };
    if (state.active) {
      renderBar();
      if (state.current) {
        const entry = state.current;
        entry.placed = entry.info.site ? undefined : null;
        setCurrent(entry);
      }
    }
    return state.active;
  }

  function start(cfg) {
    configure(cfg);
    if (state.active) return true;
    state.active = true;
    state.page = fiber.detectReact();
    state.ui = overlay.create();
    for (const [type, fn, opts] of listen) window.addEventListener(type, fn, opts);
    renderBar();
    // Learn the project root early so the popup and the bar can show it.
    if (state.page.sample) {
      source.resolveSite(fiber.siteOf(state.page.sample)).then(() => renderBar());
    }
    document.dispatchEvent(new Event('react-form-inspector:on'));
    return true;
  }

  function stop() {
    if (!state.active) return false;
    state.active = false;
    for (const [type, fn, opts] of listen) window.removeEventListener(type, fn, opts);
    cancelAnimationFrame(state.frame);
    cancelAnimationFrame(state.scrollFrame);
    state.frame = 0;
    state.scrollFrame = 0;
    state.ui.destroy();
    state.ui = null;
    state.current = null;
    state.pinned = false;
    state.hoverTarget = null;
    document.dispatchEvent(new Event('react-form-inspector:off'));
    return false;
  }

  /** For the popup: is React here, which build, what root did the dev server report. */
  async function probe(cfg) {
    if (cfg) configure(cfg);
    const page = fiber.detectReact();
    if (page.sample && !source.getDetectedRoot()) {
      await Promise.race([source.resolveSite(fiber.siteOf(page.sample)), new Promise((r) => setTimeout(r, 1500))]);
    }
    return { active: state.active, react: page.react, dev: page.dev, sources: page.sources, detectedRoot: source.getDetectedRoot() };
  }

  /** Console helper: __REACT_FORM_INSPECTOR__.inspect($0) */
  async function inspect(el, mode = 'all') {
    const info = fiber.analyze(el, { mode });
    if (!info || !info.highlight) return info ? { isField: false } : null;
    const placed = source.place(await source.resolveSite(info.site), state.cfg);
    const stack = await Promise.all(
      info.stack.map(async (r) => ({ name: r.name, at: locationText(source.place(await source.resolveSite(r.site), state.cfg)) })),
    );
    return {
      isField: info.isField,
      name: info.name,
      nameSource: info.nameSource,
      nameOnDom: info.nameOnDom,
      component: info.component,
      element: info.element,
      form: info.form,
      label: info.label,
      kind: info.kind,
      location: placed,
      editor: placed ? source.editorTarget(placed, state.cfg) : null,
      stack,
    };
  }

  window.__REACT_FORM_INSPECTOR__ = {
    version: V,
    start,
    stop,
    toggle: (cfg) => (state.active ? stop() : start(cfg)),
    configure,
    isActive: () => state.active,
    probe,
    inspect,
  };
})();
