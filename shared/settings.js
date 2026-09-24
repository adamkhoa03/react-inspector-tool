// Settings shared by the background worker, the popup and the options page.
// Everything lives in chrome.storage.local: project folders are paths on this
// machine, so syncing them to another computer would only produce wrong paths.

/**
 * @typedef {{
 *   roots: Record<string, string>,
 *   recentRoots: string[],
 *   editor: string,
 *   customTemplate: string,
 *   clickAction: 'copy' | 'open',
 *   mode: 'fields' | 'all',
 *   keepOnReload: boolean,
 * }} Settings
 *   `roots` maps a site origin (http://localhost:5173) to the project folder
 *   on this machine — the folder the dev server serves, the one holding `src/`.
 */

/** Placeholders: {path} C:/a/b.tsx or /home/a/b.tsx, {urlPath} always starts with "/", {relPath}, {line}, {column}. */
export const EDITORS = [
  { id: 'vscode', label: 'VS Code', template: 'vscode://file{urlPath}:{line}:{column}' },
  { id: 'vscode-insiders', label: 'VS Code Insiders', template: 'vscode-insiders://file{urlPath}:{line}:{column}' },
  { id: 'cursor', label: 'Cursor', template: 'cursor://file{urlPath}:{line}:{column}' },
  { id: 'windsurf', label: 'Windsurf', template: 'windsurf://file{urlPath}:{line}:{column}' },
  { id: 'zed', label: 'Zed', template: 'zed://file{urlPath}:{line}:{column}' },
  { id: 'webstorm', label: 'WebStorm', template: 'webstorm://open?file={path}&line={line}&column={column}' },
  { id: 'dev-server', label: 'Vite dev server (/__open-in-editor)', template: null },
  { id: 'custom', label: 'Custom URL template…', template: null },
];

/** @type {Settings} */
export const DEFAULTS = {
  roots: {},
  recentRoots: [],
  editor: 'vscode',
  customTemplate: '',
  clickAction: 'copy',
  mode: 'fields',
  keepOnReload: true,
};

/** @returns {Promise<Settings>} */
export async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

/** @param {Partial<Settings>} patch */
export function saveSettings(patch) {
  return chrome.storage.local.set(patch);
}

/** @param {string | undefined} url */
export function originOf(url) {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Why Chrome won't let the extension into a page, or null if it will. */
export function blockedReason(url) {
  if (!url) return 'This tab has no page to inspect.';
  if (/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url)) {
    return 'Chrome does not allow extensions on the Web Store.';
  }
  if (/^file:/.test(url)) return null; // works once "Allow access to file URLs" is on
  if (!/^https?:/.test(url)) return 'Chrome does not allow extensions on its own pages.';
  return null;
}

/** What the page script needs, resolved for one tab. Plain JSON. */
export function pageConfig(settings, url) {
  const origin = originOf(url);
  const root = origin ? settings.roots[origin] : null;
  const editor = EDITORS.find((e) => e.id === settings.editor) ?? EDITORS[0];
  return {
    source: root ? { name: nameFromPath(root), root } : null,
    editor: editor.id,
    editorLabel: editor.id === 'custom' || editor.id === 'dev-server' ? 'editor' : editor.label,
    template: editor.id === 'custom' ? settings.customTemplate.trim() : editor.template,
    clickAction: settings.clickAction === 'open' ? 'open' : 'copy',
    mode: settings.mode,
  };
}

/** Accepts what people paste: quotes, trailing slashes, `file:///` URLs. */
export function cleanPath(input) {
  let p = String(input ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (/^file:\/\//i.test(p)) {
    p = decodeURIComponent(p.replace(/^file:\/\/\/?/i, ''));
    if (!/^[a-zA-Z]:/.test(p)) p = '/' + p;
  }
  return p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
}

export function looksAbsolute(p) {
  return /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(p);
}

const GENERIC_NAMES = new Set(['web', 'app', 'client', 'frontend', 'src', 'ui', 'site', 'www']);

/** "C:\\work\\jira-app\\apps\\web" → "jira-app/web" */
export function nameFromPath(root) {
  const parts = String(root).split(/[\\/]+/).filter(Boolean);
  const last = parts.at(-1) ?? String(root);
  if (GENERIC_NAMES.has(last.toLowerCase()) && parts.length > 1) {
    const project = parts.length > 2 && parts.at(-2) === 'apps' ? parts.at(-3) : parts.at(-2);
    return `${project}/${last}`;
  }
  return last;
}

/** The patch that sets (or clears, with an empty path) the folder for `origin`. */
export function rootPatch(settings, origin, input) {
  const roots = { ...settings.roots };
  const root = cleanPath(input);
  if (!root) {
    delete roots[origin];
    return { roots };
  }
  roots[origin] = root;
  const same = (p) => p.replace(/\\/g, '/').toLowerCase() === root.replace(/\\/g, '/').toLowerCase();
  const recentRoots = [root, ...settings.recentRoots.filter((p) => !same(p))].slice(0, 8);
  return { roots, recentRoots };
}
