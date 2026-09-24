// Reads React's internal fiber tree from a DOM node and answers three questions
// about a hovered element: what is the field called, where was it declared,
// and which component does it belong to. Runs in the page's own JS world.
(() => {
  const V = '0.1.0';
  const lib = (window.__REACT_FORM_INSPECTOR_LIB__ ??= {});
  if (lib.fiber?.v === V) return;

  // Fiber tags (react-reconciler/src/ReactWorkTags.js).
  const HOST_ROOT = 3;
  const HOST_PORTAL = 4;
  const HOST_TEXT = 6;
  const HOST_TAGS = new Set([5, 26, 27]); // HostComponent, HostHoistable, HostSingleton
  const COMPOSITE_TAGS = new Set([0, 1, 2, 11, 14, 15]); // function, class, indeterminate, forwardRef, memo

  const isFiber = (o) => o !== null && typeof o === 'object' && typeof o.tag === 'number';
  const isHost = (f) => isFiber(f) && HOST_TAGS.has(f.tag);
  const isComposite = (f) => isFiber(f) && COMPOSITE_TAGS.has(f.tag);

  // ---------------------------------------------------------------------------
  // DOM → fiber
  // ---------------------------------------------------------------------------

  let fiberKey = null;
  let propsKey = null;

  function ownKey(node, prefix) {
    for (const key of Object.keys(node)) if (key.startsWith(prefix)) return key;
    return null;
  }

  /** React stores the fiber on the DOM node under a key with a random suffix. */
  function fiberOf(node) {
    if (!node || node.nodeType !== 1) return null;
    if (fiberKey && node[fiberKey]) return node[fiberKey];
    const key = ownKey(node, '__reactFiber$') ?? ownKey(node, '__reactInternalInstance$');
    if (!key) return null;
    fiberKey = key;
    return node[key];
  }

  /** The nearest element (itself or an ancestor, crossing shadow roots) that React rendered. */
  function closestFiber(el) {
    for (let n = el; n; n = n.parentNode ?? n.host ?? null) {
      const fiber = fiberOf(n);
      if (fiber) return { fiber, node: n };
    }
    return null;
  }

  /**
   * A DOM node points at whichever half of React's current/alternate pair
   * created it. Walk up to the root: if that root is not the one on screen,
   * the other half is the current fiber (fresh props, live children).
   */
  function toCurrent(f) {
    if (!f?.alternate) return f;
    let top = f;
    while (top.return) top = top.return;
    return top.tag === HOST_ROOT && top.stateNode?.current !== top ? f.alternate : f;
  }

  /** Props of a fiber. For host elements the DOM keeps a copy that is always current. */
  function propsOf(f) {
    if (isHost(f) && f.stateNode) {
      const node = f.stateNode;
      const key = propsKey && propsKey in node ? propsKey : ownKey(node, '__reactProps$');
      if (key) {
        propsKey = key;
        return node[key];
      }
    }
    return f.memoizedProps;
  }

  // ---------------------------------------------------------------------------
  // Names
  // ---------------------------------------------------------------------------

  function typeName(t) {
    if (!t) return null;
    if (typeof t === 'string') return t;
    if (typeof t === 'function') return t.displayName || t.name || null;
    if (typeof t === 'object') {
      if (typeof t.displayName === 'string') return t.displayName;
      if (t.render) return typeName(t.render); // forwardRef
      if (t.type) return typeName(t.type); // memo
    }
    return null;
  }

  function nameOf(f) {
    if (!f) return null;
    if (!isFiber(f)) return typeof f.name === 'string' ? f.name : null; // Server Component info
    if (isHost(f)) return typeof f.type === 'string' ? f.type : null;
    return typeName(f.elementType) || typeName(f.type) || 'Anonymous';
  }

  // ---------------------------------------------------------------------------
  // Where a fiber's element was created
  //
  // React ≤18 recorded it directly (_debugSource). React 19 instead keeps the
  // Error created inside jsxDEV (_debugStack). Its stack reads, top to bottom:
  //   jsxDEV (react)  →  where the JSX was written  →  …  →  the component
  //   function that was rendering  →  react_stack_bottom_frame (react-dom)
  // ---------------------------------------------------------------------------

  const FRAME_RE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
  const RUNTIME_FN = /(?:^|\.)(?:jsxDEV|jsxs?|jsxDEVImpl|createElement|cloneElement)$/;
  const LIBRARY_RE = /\/node_modules\/|\/@id\/|^(?:chrome|moz)-extension:|^node:/;
  const stackCache = new WeakMap();

  const isLibrary = (url) => !url || LIBRARY_RE.test(String(url).replace(/\\/g, '/'));
  const fileKey = (url) => String(url).split(/[?#]/)[0];

  function readStack(error) {
    const prepare = Error.prepareStackTrace;
    const custom = typeof prepare === 'function';
    try {
      if (custom) Error.prepareStackTrace = undefined;
      return String(error.stack ?? '');
    } catch {
      return '';
    } finally {
      if (custom) Error.prepareStackTrace = prepare;
    }
  }

  function framesOf(error) {
    if (!error || typeof error !== 'object') return null;
    if (stackCache.has(error)) return stackCache.get(error);
    const text = readStack(error);
    let result = null;
    // React falls back to one shared stack after 10k elements per second.
    if (text && !text.includes('UnknownOwner')) {
      const frames = [];
      let complete = false;
      for (const line of text.split('\n')) {
        if (line.includes('react_stack_bottom_frame') || line.includes('react-stack-bottom-frame')) {
          complete = true;
          break;
        }
        const m = FRAME_RE.exec(line);
        if (m) frames.push({ fn: m[1] ?? '', url: m[2], line: Number(m[3]), column: Number(m[4]) });
      }
      frames.shift(); // the jsxDEV / createElement frame that created the Error
      while (frames.length && RUNTIME_FN.test(frames[0].fn) && isLibrary(frames[0].url)) frames.shift();
      if (frames.length) result = { frames, complete };
    }
    stackCache.set(error, result);
    return result;
  }

  /**
   * @returns {null | {
   *   kind: 'stack' | 'source', url: string, line: number, column: number,
   *   library: boolean, ownerUrl: string | null
   * }} `ownerUrl` is the file of the component that was rendering (stack only).
   */
  function siteOf(f) {
    if (!isFiber(f)) return null;
    const src = f._debugSource;
    if (src?.fileName) {
      return {
        kind: 'source',
        url: src.fileName,
        line: src.lineNumber ?? 1,
        column: src.columnNumber ?? 1,
        library: isLibrary(src.fileName),
        ownerUrl: null,
      };
    }
    const stack = framesOf(f._debugStack);
    if (!stack) return null;
    const first = stack.frames[0];
    const last = stack.complete ? stack.frames.at(-1) : null;
    return {
      kind: 'stack',
      url: first.url,
      line: first.line,
      column: first.column,
      library: isLibrary(first.url),
      ownerUrl: last ? last.url : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Field units: the things a person actually types into or toggles
  // ---------------------------------------------------------------------------

  const UNIT_SELECTOR = [
    'input:not([type=hidden])',
    'select',
    'textarea',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    ...['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'radiogroup', 'switch', 'slider', 'spinbutton'].map(
      (r) => `[role=${r}]`,
    ),
    // Date pickers and custom selects are often a plain button that opens a popup.
    ...['dialog', 'listbox', 'grid', 'tree'].map((p) => `button[aria-haspopup=${p}]`),
    'button[id]',
  ].join(',');

  const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'image']);

  function isUnit(el) {
    if (!el || el.nodeType !== 1 || !el.matches(UNIT_SELECTOR)) return false;
    if (el.tagName === 'INPUT' && SKIP_TYPES.has(el.type)) return false;
    if (el.tagName === 'BUTTON' && !el.hasAttribute('role')) {
      // A plain button is a field only if it opens a picker or a <label> points at it.
      if (el.hasAttribute('aria-pressed')) return false;
      if (!/^(dialog|listbox|grid|tree)$/.test(el.getAttribute('aria-haspopup') ?? '') && !el.labels?.length) return false;
    }
    // Radix and friends render an aria-hidden twin input for native form posts.
    // Only the element's own flag counts: a modal marks the whole page behind it.
    if (el.getAttribute('aria-hidden') === 'true' || el.closest('[hidden], [inert]')) return false;
    return el.getClientRects().length > 0;
  }

  /** Radios of one group, and a combobox wrapping its own input, count once. */
  function unitKey(el, root) {
    const group = el.matches('[role=radio], input[type=radio]') && el.closest('[role=radiogroup]');
    if (group && root.contains(group)) return group;
    if (el.matches('input[type=radio]') && el.name) return `radio:${el.name}`;
    let top = el;
    for (let p = el.parentElement; p && root.contains(p); p = p.parentElement) {
      if (p.matches(UNIT_SELECTOR) && isUnit(p)) top = p;
    }
    return top;
  }

  function countUnits(nodes, limit = 2) {
    const keys = new Set();
    for (const root of nodes) {
      if (!root || root.nodeType !== 1) continue;
      const candidates = root.matches(UNIT_SELECTOR) ? [root, ...root.querySelectorAll(UNIT_SELECTOR)] : root.querySelectorAll(UNIT_SELECTOR);
      for (const el of candidates) {
        if (!isUnit(el)) continue;
        keys.add(unitKey(el, root));
        if (keys.size >= limit) return keys.size;
      }
    }
    return keys.size;
  }

  function firstUnit(nodes) {
    for (const root of nodes) {
      if (isUnit(root)) return root;
      for (const el of root.querySelectorAll?.(UNIT_SELECTOR) ?? []) if (isUnit(el)) return el;
    }
    return null;
  }

  /** Top-level DOM nodes a fiber renders (a component can render several, or none). */
  function hostNodes(f, limit = 24) {
    if (isHost(f)) return f.stateNode ? [f.stateNode] : [];
    const collect = (start) => {
      const out = [];
      const walk = (c) => {
        for (; c && out.length < limit; c = c.sibling) {
          if (isHost(c)) {
            if (c.stateNode?.isConnected) out.push(c.stateNode);
          } else if (c.tag !== HOST_TEXT && c.tag !== HOST_PORTAL) {
            walk(c.child);
          }
        }
      };
      walk(start.child);
      return out;
    };
    const nodes = collect(f);
    // The node may point at the stale half of the current/alternate pair.
    return nodes.length || !f.alternate ? nodes : collect(f.alternate);
  }

  // ---------------------------------------------------------------------------
  // The upward walk
  // ---------------------------------------------------------------------------

  function nameValue(v) {
    if (typeof v === 'string') {
      const s = v.trim();
      return s && s.length <= 160 ? s : null;
    }
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (Array.isArray(v) && v.length > 0 && v.length <= 12 && v.every((p) => typeof p === 'string' || typeof p === 'number')) {
      return v.join('.');
    }
    return null;
  }

  // Props a wrapper forwards to the element that finally renders the field.
  // Functions are matched by identity whatever key they travel under.
  const FN_KEYS = ['onChange', 'onBlur', 'onFocus', 'onInput', 'onValueChange', 'onCheckedChange', 'onPressedChange', 'onSelect', 'ref'];
  const VALUE_KEYS = ['value', 'defaultValue', 'checked', 'defaultChecked', 'placeholder', 'id', 'aria-label', 'aria-labelledby', 'aria-describedby'];

  /**
   * Walks up the parent chain from the hovered element's fiber, but never out of
   * the "field scope": stop at the <form>, at a portal/root, or at the first DOM
   * ancestor that contains two or more fields (everything above belongs to the
   * form, not to this field).
   */
  function scan(start, all, findName) {
    const fnKeys = all ? [...FN_KEYS, 'onClick'] : FN_KEYS;
    const fnSeen = new Set();
    const valueSeen = new Set();
    let nearest = null;
    let nameFiber = null;
    let passFiber = null;

    for (let f = start, steps = 0; f && steps < 80; f = f.return, steps++) {
      if (f.tag === HOST_ROOT || f.tag === HOST_PORTAL) break;
      if (f !== start && isHost(f)) {
        if (f.type === 'form') break;
        if (countUnits([f.stateNode]) >= 2) break;
      }
      const props = propsOf(f);
      if (!props || typeof props !== 'object') continue;

      const name = findName ? nameValue(props.name) : null;
      if (name !== null) {
        if (!nearest) {
          // Only a component that renders exactly one field names a field.
          // Skips things like <Icon name="eye"> inside the field's button.
          const units = countUnits(hostNodes(f));
          if (units === 1) {
            nearest = { name, fiber: f };
            nameFiber = f;
          } else if (units >= 2) {
            break;
          }
        } else if (name === nearest.name) {
          nameFiber = f;
        }
      }

      const fns = [];
      const values = [];
      let passes = false;
      for (const key of fnKeys) {
        const v = props[key];
        if (typeof v !== 'function') continue;
        if (fnSeen.has(v)) passes = true;
        fns.push(v);
      }
      for (const key of VALUE_KEYS) {
        const v = props[key];
        if (!((typeof v === 'string' && v !== '') || typeof v === 'number' || typeof v === 'boolean')) continue;
        const tagged = `${key}\u0000${v}`;
        if (valueSeen.has(tagged)) passes = true;
        values.push(tagged);
      }
      if (passes) passFiber = f;
      for (const v of fns) fnSeen.add(v);
      for (const v of values) valueSeen.add(v);
    }
    return { nearest, nameFiber, passFiber };
  }

  function isAncestor(a, b) {
    for (let p = b?.return; p; p = p.return) if (p === a || p === a.alternate) return true;
    return false;
  }

  /** First fiber, following the chain of owners, that was created in the app's own code. */
  function firstUserCreated(f) {
    for (let x = f, i = 0; isFiber(x) && i < 40; x = x._debugOwner, i++) {
      const site = siteOf(x);
      if (site && !site.library) return x;
    }
    return null;
  }

  /**
   * <Button> renders nothing but its <button>: point at where <Button> is used,
   * not at the <button> inside Button.tsx. Climbs while the owner's only DOM
   * node is this same node and the owner itself is used in the app's code.
   */
  function throughThinWrappers(decl) {
    let d = decl;
    for (let i = 0; i < 8; i++) {
      const owner = d._debugOwner;
      if (!isComposite(owner) || siteOf(owner)?.library !== false) break;
      const mine = hostNodes(d);
      const theirs = hostNodes(owner);
      if (mine.length !== 1 || theirs.length !== 1 || mine[0] !== theirs[0]) break;
      d = owner;
    }
    return d;
  }

  /** The fiber whose JSX declares the field: <Controller name="password" …>, <Input {...register('email')} />. */
  function declarationOf(start, scanned) {
    const { nameFiber, passFiber } = scanned;
    let decl = nameFiber && passFiber ? (isAncestor(nameFiber, passFiber) ? nameFiber : passFiber) : nameFiber || passFiber;
    if (!decl) {
      const created = firstUserCreated(start);
      return created ? throughThinWrappers(created) : start;
    }
    if (siteOf(decl)?.library) decl = firstUserCreated(decl) ?? decl;
    return decl;
  }

  // Render-prop hosts, for React ≤18 where there is no stack to tell them apart.
  const RENDER_PROP_HOSTS = new Set(['Controller', 'Field', 'FastField', 'FieldArray', 'ConnectedField', 'FormField']);

  /**
   * The component whose code contains the declaration. Usually the owner, but
   * with render props (<Field>{(p) => <Input …/>}</Field>) the owner is Field
   * while the code sits in LoginPane.tsx — so walk up the owners until one is
   * defined in the same file the JSX was written in.
   */
  function belongsTo(decl) {
    const site = siteOf(decl);
    let fallback = null;
    for (let x = decl, i = 0; isFiber(x) && i < 40; i++) {
      const owner = x._debugOwner;
      if (!owner) break;
      if (!isFiber(owner)) return owner;
      const s = siteOf(x);
      if (s?.ownerUrl) {
        if (site?.kind === 'stack' && fileKey(s.ownerUrl) === fileKey(site.url)) return owner;
        if (!fallback && !isLibrary(s.ownerUrl)) fallback = owner;
      } else if (s?.kind === 'source') {
        if (!RENDER_PROP_HOSTS.has(nameOf(owner))) return owner;
      } else if (!fallback) {
        fallback = owner;
      }
      x = owner;
    }
    if (fallback) return fallback;
    if (isFiber(decl._debugOwner)) return decl._debugOwner;
    // Production build: no owners, take the nearest component above.
    for (let p = decl.return; p; p = p.return) if (isComposite(p)) return p;
    return null;
  }

  /** Owners from the field up, each with the place it was used. Library components are skipped. */
  function ownerStack(decl, max = 7) {
    const rows = [{ fiber: decl, name: nameOf(decl), host: isHost(decl), site: siteOf(decl) }];
    for (let x = decl, i = 0; isFiber(x) && i < 60 && rows.length < max; i++) {
      const owner = x._debugOwner;
      if (!isFiber(owner)) break;
      const s = siteOf(x);
      const library = s?.ownerUrl ? isLibrary(s.ownerUrl) : (siteOf(owner)?.library ?? false);
      if (!library) rows.push({ fiber: owner, name: nameOf(owner), host: false, site: siteOf(owner) });
      x = owner;
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Describing the field element
  // ---------------------------------------------------------------------------

  const clean = (s) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 80) : null;
  };

  function labelText(label) {
    let text = '';
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) text += c.textContent;
        else if (c.nodeType === 1 && !c.matches('button, a, [role=button], input, select, textarea')) walk(c);
      }
    };
    walk(label);
    return clean(text);
  }

  function labelOf(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.labels?.length) {
      const t = labelText(el.labels[0]);
      if (t) return t;
    }
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      const t = clean(ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
      if (t) return t;
    }
    return clean(el.getAttribute('aria-label'));
  }

  function kindOf(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if (tag === 'input') return `input[${el.type}]`;
    if (role && tag !== role) return role;
    if (el.isContentEditable && el.getAttribute('contenteditable') !== null) return 'contenteditable';
    return tag;
  }

  function nameSourceOf(fiber) {
    if (isHost(fiber)) return 'name attribute';
    return `<${nameOf(fiber)} name>`;
  }

  // ---------------------------------------------------------------------------
  // Page-level facts
  // ---------------------------------------------------------------------------

  function findAnyFiber() {
    const roots = [document.getElementById('root'), document.getElementById('app'), document.getElementById('__next'), document.body];
    for (const r of roots) {
      if (!r) continue;
      const f = fiberOf(r) ?? (r.firstElementChild && fiberOf(r.firstElementChild));
      if (f) return f;
    }
    let i = 0;
    for (const el of document.body?.getElementsByTagName('*') ?? []) {
      const f = fiberOf(el);
      if (f) return f;
      if (++i > 3000) break;
    }
    return null;
  }

  /** Is React on the page, is it a development build, and does it record where JSX was written? */
  function detectReact() {
    const f = findAnyFiber();
    if (!f) return { react: false, dev: false, sources: false };
    const dev = '_debugOwner' in f;
    let sources = false;
    let sample = null;
    for (let p = f, i = 0; p && i < 200; p = p.return, i++) {
      const site = siteOf(p);
      if (site) {
        sources = true;
        if (!site.library) {
          sample = p;
          break;
        }
      }
    }
    // Look downward too: the root's first children are the app's own components.
    if (!sample && dev) {
      const queue = [f];
      for (let n = 0; queue.length && n < 600; n++) {
        const x = queue.shift();
        const site = siteOf(x);
        if (site) {
          sources = true;
          if (!site.library && site.kind === 'stack') {
            sample = x;
            break;
          }
        }
        for (let c = x.child; c; c = c.sibling) queue.push(c);
      }
    }
    return { react: true, dev, sources, sample };
  }

  // ---------------------------------------------------------------------------
  // Putting it together
  // ---------------------------------------------------------------------------

  /**
   * @param {Element} target the element under the pointer
   * @param {{ mode: 'fields' | 'all' }} opts
   */
  function analyze(target, opts) {
    let el = target;
    if (el?.tagName === 'LABEL' && el.control) el = el.control;
    const found = closestFiber(el);
    if (!found) return null;
    const node = found.node;
    const start = toCurrent(found.fiber);
    const all = opts.mode === 'all';

    const unitEl = isUnit(el) ? el : isUnit(node) ? node : null;
    // In "All" mode a button inside a field is itself, not the field around it.
    const scanned = scan(start, all, !all || Boolean(unitEl));
    const isField = Boolean(unitEl || scanned.nearest);
    if (!all && !isField) return { isField: false, el: node };

    const decl = declarationOf(start, scanned);
    const component = belongsTo(decl);
    const formEl = node.closest('form');
    const formFiber = formEl ? fiberOf(formEl) : null;
    const formComponent = formFiber ? belongsTo(formFiber) : null;
    const fieldEl = unitEl ?? firstUnit(hostNodes(scanned.nearest?.fiber ?? decl)) ?? (isField ? node : null);

    let highlight = hostNodes(decl).filter((n) => n.getClientRects().length > 0);
    if (!highlight.length) highlight = [node];

    return {
      isField,
      el: node,
      decl,
      name: scanned.nearest?.name ?? null,
      nameSource: scanned.nearest ? nameSourceOf(scanned.nameFiber ?? scanned.nearest.fiber) : null,
      // Whether e2e tests can target it with [name="…"]
      nameOnDom: Boolean(scanned.nearest && fieldEl?.getAttribute?.('name') === scanned.nearest.name),
      element: nameOf(decl),
      elementIsHost: isHost(decl),
      component: component ? nameOf(component) : null,
      form: formComponent ? nameOf(formComponent) : null,
      site: siteOf(decl),
      stack: ownerStack(decl),
      label: fieldEl ? labelOf(fieldEl) : null,
      kind: fieldEl ? kindOf(fieldEl) : null,
      highlight,
    };
  }

  lib.fiber = { v: V, analyze, detectReact, siteOf, nameOf, fiberOf, isLibrary };
})();
