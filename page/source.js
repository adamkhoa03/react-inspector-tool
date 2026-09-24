// Turns "where the JSX call ran" (a URL + line/column in the code the browser
// executed) into "where it is written" (a file on disk + line/column), and
// builds the link that opens it in an editor.
(() => {
  const V = '0.1.0';
  const lib = (window.__REACT_FORM_INSPECTOR_LIB__ ??= {});
  if (lib.source?.v === V) return;

  // ---------------------------------------------------------------------------
  // Paths
  // ---------------------------------------------------------------------------

  const slashes = (p) => String(p).replace(/\\/g, '/');
  const isAbsolute = (p) => /^([a-zA-Z]:\/|\/)/.test(slashes(p));
  const isWindows = (p) => /^[a-zA-Z]:\//.test(p);

  function splitPath(p) {
    const s = slashes(p);
    const lead = s.startsWith('/') ? '/' : '';
    return { lead, parts: s.split('/').filter(Boolean) };
  }

  /** join("C:/app", "../pkg/x.ts") → "C:/pkg/x.ts" */
  function joinPath(root, rel) {
    const { lead, parts } = splitPath(root);
    const keep = /^[a-zA-Z]:$/.test(parts[0] ?? '') ? 1 : 0; // never pop the drive letter
    for (const seg of slashes(rel).split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (parts.length > keep) parts.pop();
      } else parts.push(seg);
    }
    return lead + parts.join('/');
  }

  /** relativePath("C:/a/web", "C:/a/pkg/x.ts") → "../pkg/x.ts" */
  function relativePath(from, to) {
    const a = splitPath(from).parts;
    const b = splitPath(to).parts;
    const eq = (x, y) => (isWindows(from) ? x.toLowerCase() === y.toLowerCase() : x === y);
    let i = 0;
    while (i < a.length && i < b.length && eq(a[i], b[i])) i++;
    if (i === 0) return null; // different drives
    return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/') || '.';
  }

  function isInside(root, p) {
    const r = slashes(root).replace(/\/+$/, '');
    const x = slashes(p);
    const norm = isWindows(r) ? (s) => s.toLowerCase() : (s) => s;
    return norm(x).startsWith(norm(r) + '/');
  }

  /** Where Vite serves from, e.g. "/" or "/app/", read off its client script. */
  function viteBase() {
    const src = document.querySelector('script[type=module][src*="@vite/client"]')?.getAttribute('src');
    if (!src) return '/';
    try {
      return new URL(src, location.href).pathname.replace(/@vite\/client$/, '') || '/';
    } catch {
      return '/';
    }
  }

  /** A script URL → a path. Relative to the dev server's root unless the URL says otherwise. */
  function pathFromUrl(url) {
    const raw = String(url);
    if (/^webpack(-internal)?:/.test(raw)) {
      const p = raw
        .replace(/^webpack(-internal)?:\/*/, '')
        .replace(/^\([^)]*\)\//, '')
        .replace(/^[^/]*?\/(?=\.\/)/, '')
        .replace(/^\.\//, '')
        .split('?')[0];
      return isAbsolute(p) ? { abs: p } : { rel: p };
    }
    let u;
    try {
      u = new URL(raw, location.href);
    } catch {
      return null;
    }
    const path = decodeURIComponent(u.pathname);
    if (u.protocol === 'file:') return { abs: path.replace(/^\/([a-zA-Z]:)/, '$1') };
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const fs = path.indexOf('/@fs/');
    if (fs >= 0) {
      const rest = path.slice(fs + 5);
      return { abs: /^[a-zA-Z]:/.test(rest) ? rest : '/' + rest };
    }
    const base = viteBase();
    return { rel: path.startsWith(base) ? path.slice(base.length) : path.replace(/^\//, '') };
  }

  // ---------------------------------------------------------------------------
  // Source maps (base64 VLQ, https://tc39.es/ecma426/)
  // ---------------------------------------------------------------------------

  const B64 = new Int8Array(128).fill(-1);
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((c, i) => {
    B64[c.charCodeAt(0)] = i;
  });

  /** → lines[generatedLine] = [[generatedColumn, sourceIndex, originalLine, originalColumn], …] */
  function decodeMappings(mappings) {
    const lines = [];
    let line = [];
    let genCol = 0;
    let src = 0;
    let oLine = 0;
    let oCol = 0;
    let value = 0;
    let shift = 0;
    const seg = [];
    const flush = () => {
      if (seg.length === 0) return;
      genCol += seg[0];
      if (seg.length >= 4) {
        src += seg[1];
        oLine += seg[2];
        oCol += seg[3];
        line.push([genCol, src, oLine, oCol]);
      }
      seg.length = 0;
    };
    for (let i = 0; i < mappings.length; i++) {
      const c = mappings.charCodeAt(i);
      if (c === 44 /* , */ || c === 59 /* ; */) {
        flush();
        if (c === 59) {
          lines.push(line);
          line = [];
          genCol = 0;
        }
        continue;
      }
      const digit = c < 128 ? B64[c] : -1;
      if (digit < 0) continue;
      value += (digit & 31) * 2 ** shift;
      if (digit & 32) {
        shift += 5;
      } else {
        seg.push(value & 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
        value = 0;
        shift = 0;
      }
    }
    flush();
    lines.push(line);
    return lines;
  }

  /** Both positions 0-based. */
  function originalPosition(map, line, column) {
    if (!map || typeof map.mappings !== 'string') return null;
    map.__decoded ??= decodeMappings(map.mappings);
    const segs = map.__decoded[line];
    if (!segs?.length) return null;
    let lo = 0;
    let hi = segs.length - 1;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid][0] <= column) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const [, s, l, c] = segs[best];
    const source = map.sources?.[s];
    return { source: source == null ? null : (map.sourceRoot ? map.sourceRoot.replace(/\/?$/, '/') : '') + source, line: l, column: c };
  }

  function decodeDataUrl(url) {
    const comma = url.indexOf(',');
    const meta = url.slice(0, comma);
    const data = url.slice(comma + 1);
    if (!/;base64$/i.test(meta)) return decodeURIComponent(data);
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function mapFor(code, scriptUrl) {
    const refs = [...code.matchAll(/[#@] sourceMappingURL=(\S+)\s*$/gm)];
    const ref = refs.at(-1)?.[1];
    if (!ref) return null;
    try {
      if (ref.startsWith('data:')) return JSON.parse(decodeDataUrl(ref));
      const res = await fetch(new URL(ref, scriptUrl), { credentials: 'same-origin' });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  const JSX_FILE_RE = /\b_jsxFileName\s*=\s*("(?:[^"\\\n]|\\.)*")/;
  const FILE_NAME_RE = /\bfileName:\s*("(?:[^"\\\n]|\\.)*")/;

  const modules = new Map();

  /** The code the browser ran for `url`, reduced to what we need from it. Cached per URL. */
  function loadModule(url) {
    if (!modules.has(url)) {
      const job = (async () => {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return { fileName: null, map: null };
        const code = await res.text();
        // Dev JSX transforms (Oxc, Babel, esbuild, SWC) write the absolute file
        // path into the module so they can pass it to jsxDEV.
        const m = JSX_FILE_RE.exec(code) ?? FILE_NAME_RE.exec(code);
        let fileName = null;
        try {
          fileName = m ? JSON.parse(m[1]) : null;
        } catch {
          fileName = null;
        }
        return { fileName, map: await mapFor(code, url) };
      })().catch(() => ({ fileName: null, map: null }));
      modules.set(url, job);
    }
    return modules.get(url);
  }

  // ---------------------------------------------------------------------------
  // Hot updates
  //
  // React records where an element was created once, at mount. After Vite hot-
  // swaps a file (fetching it again as ?t=<time>), old elements still point at
  // the old code while the server only serves the new one, so their line can be
  // off. Track the newest ?t= per file to say so.
  // ---------------------------------------------------------------------------

  const latestT = new Map();
  let watching = false;

  function noteResource(name) {
    try {
      const u = new URL(name);
      const t = Number(u.searchParams.get('t'));
      const key = u.origin + u.pathname;
      if (t && t > (latestT.get(key) ?? 0)) latestT.set(key, t);
    } catch {
      // not a URL
    }
  }

  function watchHotUpdates() {
    if (watching) return;
    watching = true;
    for (const e of performance.getEntriesByType('resource')) noteResource(e.name);
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => noteResource(e.name))).observe({ type: 'resource', buffered: true });
    } catch {
      // PerformanceObserver unavailable: staleness just goes undetected.
    }
  }

  function isStale(url) {
    try {
      const u = new URL(url);
      const latest = latestT.get(u.origin + u.pathname);
      return latest !== undefined && latest > Number(u.searchParams.get('t') || 0);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Resolving a creation site
  // ---------------------------------------------------------------------------

  let detectedRoot = null;
  const resolved = new Map();

  /**
   * @param {{kind: string, url: string, line: number, column: number}} site from fiber.siteOf
   * @returns {Promise<{abs: string|null, rel: string|null, line: number, column: number, exact: boolean}|null>}
   */
  function resolveSite(site) {
    if (!site) return Promise.resolve(null);
    watchHotUpdates();
    const key = `${site.url}:${site.line}:${site.column}`;
    if (!resolved.has(key)) resolved.set(key, doResolve(site));
    return resolved.get(key);
  }

  async function doResolve(site) {
    if (site.kind === 'source') {
      const p = slashes(site.url);
      return { abs: isAbsolute(p) ? p : null, rel: isAbsolute(p) ? null : p, line: site.line, column: site.column, exact: true, url: null };
    }
    const fromUrl = pathFromUrl(site.url) ?? {};
    let line = site.line;
    let column = site.column;
    let exact = false;
    let fromMap = null;
    let fileName = null;

    if (/^https?:/.test(site.url)) {
      const mod = await loadModule(site.url);
      fileName = mod.fileName;
      // Stack frames count from 1, source maps from 0.
      const pos = originalPosition(mod.map, line - 1, column - 1);
      if (pos) {
        line = pos.line + 1;
        column = pos.column + 1;
        exact = true;
        if (pos.source) {
          fromMap = /^(webpack|file):/.test(pos.source) ? pathFromUrl(pos.source) : pathFromUrl(new URL(pos.source, site.url).href);
        }
      }
    }

    let abs = fromUrl.abs ?? null;
    let rel = fromUrl.rel ?? null;
    // A map pointing at a different file (bundles) wins over the script URL.
    if (fromMap && (fromMap.abs || fromMap.rel) && !sameFile(fromMap, fromUrl)) {
      abs = fromMap.abs ?? null;
      rel = fromMap.rel ?? null;
      fileName = null;
    }
    if (fileName && isAbsolute(fileName)) {
      abs = slashes(fileName);
      if (rel && abs.toLowerCase().endsWith('/' + rel.toLowerCase())) {
        detectedRoot ??= abs.slice(0, abs.length - rel.length - 1);
      }
    }
    return { abs, rel, line, column, exact, url: site.url };
  }

  function sameFile(a, b) {
    const f = (x) => (x.abs ?? x.rel ?? '').toLowerCase().replace(/^\/+/, '');
    return f(a) === f(b) || f(a).endsWith('/' + f(b)) || f(b).endsWith('/' + f(a));
  }

  /**
   * Applies the project folder chosen for this site. With one, every path is
   * rebuilt inside that folder; without one, the dev server's own paths are used.
   * @param {{abs: string|null, rel: string|null, line: number, column: number, exact: boolean}} loc
   * @param {{source: {root: string} | null}} cfg
   */
  function place(loc, cfg) {
    if (!loc) return null;
    const root = cfg.source?.root ? slashes(cfg.source.root).replace(/\/+$/, '') : null;
    let { abs, rel } = loc;
    let inRoot = rel; // path relative to the project root, when known
    if (!inRoot && abs && detectedRoot) inRoot = isInside(detectedRoot, abs) ? abs.slice(detectedRoot.length + 1) : relativePath(detectedRoot, abs);
    if (!inRoot && abs && root && isInside(root, abs)) inRoot = abs.slice(root.length + 1);
    if (root && inRoot) abs = joinPath(root, inRoot);
    const display = inRoot && !inRoot.startsWith('../') ? inRoot : abs ?? rel ?? '';
    const stale = loc.url ? isStale(loc.url) : false;
    return { abs, rel: inRoot, display, line: loc.line, column: loc.column, exact: loc.exact, stale };
  }

  function encodePath(p) {
    return encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  /**
   * @returns {{kind: 'link' | 'fetch', url: string} | {kind: 'missing', reason: string}}
   */
  function editorTarget(placed, cfg) {
    if (!placed) return { kind: 'missing', reason: 'No source location for this element.' };
    const where = `${placed.abs ?? placed.rel}:${placed.line}:${placed.column}`;
    if (cfg.editor === 'dev-server') {
      return { kind: 'fetch', url: `${location.origin}/__open-in-editor?file=${encodeURIComponent(where)}` };
    }
    if (!placed.abs) {
      return { kind: 'missing', reason: 'Only a relative path is known. Paste the project folder in the extension popup.' };
    }
    const template = cfg.template || 'vscode://file{urlPath}:{line}:{column}';
    const abs = placed.abs;
    const url = template
      .replaceAll('{path}', encodePath(abs))
      .replaceAll('{urlPath}', encodePath(abs.startsWith('/') ? abs : '/' + abs))
      .replaceAll('{relPath}', encodePath(placed.rel ?? ''))
      .replaceAll('{line}', String(placed.line))
      .replaceAll('{column}', String(placed.column));
    return { kind: 'link', url };
  }

  lib.source = {
    v: V,
    resolveSite,
    place,
    editorTarget,
    getDetectedRoot: () => detectedRoot,
    // exposed for tests
    decodeMappings,
    originalPosition,
    pathFromUrl,
    joinPath,
    relativePath,
  };
})();
