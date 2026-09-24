import { blockedReason, cleanPath, EDITORS, loadSettings, looksAbsolute, originOf, rootPatch, saveSettings } from '../shared/settings.js';

const $ = (id) => document.getElementById(id);
const els = {
  version: $('version'),
  origin: $('origin'),
  status: $('status'),
  toggle: $('toggle'),
  toggleLabel: $('toggle-label'),
  toggleError: $('toggle-error'),
  shortcut: $('shortcut'),
  folderForm: $('folder-form'),
  folderInput: $('folder-input'),
  folderError: $('folder-error'),
  folderClear: $('folder-clear'),
  recent: $('recent-roots'),
  detectedRow: $('detected-row'),
  detected: $('detected'),
  useDetected: $('use-detected'),
  opensRow: $('opens-row'),
  opens: $('opens'),
  editor: $('editor'),
  templateRow: $('template-row'),
  template: $('template'),
};

let settings = await loadSettings();
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const origin = originOf(tab?.url);
let active = false;
let detectedRoot = null;

els.version.textContent = `v${chrome.runtime.getManifest().version}`;
els.origin.textContent = origin ?? tab?.url?.split('?')[0] ?? 'No page';

// ---- shortcut ---------------------------------------------------------------

const commands = await chrome.commands.getAll();
const shortcut = commands.find((c) => c.name === 'toggle-inspector')?.shortcut ?? '';
els.shortcut.textContent = shortcut;

// ---- page status ------------------------------------------------------------

function setStatus(text, tone) {
  els.status.textContent = text;
  els.status.dataset.tone = tone ?? '';
}

function setActive(on) {
  active = on;
  els.toggleLabel.textContent = on ? 'Stop inspecting' : 'Start inspecting';
  els.toggle.classList.toggle('on', on);
}

async function refreshStatus() {
  const blocked = blockedReason(tab?.url);
  if (blocked) {
    setStatus(blocked, 'warn');
    return;
  }
  els.toggle.disabled = false;
  const res = await chrome.runtime.sendMessage({ type: 'status', tab });
  if (!res?.ok) {
    setStatus(res?.error ?? 'Could not reach this page.', 'warn');
    return;
  }
  setActive(Boolean(res.active));
  detectedRoot = res.detectedRoot ?? null;
  if (!res.react) setStatus('No React found on this page yet.', 'warn');
  else if (!res.dev) setStatus('React production build — names only, no source lines.', 'warn');
  else if (!res.sources) setStatus('React dev build, but no source info (React 19.0?).', 'warn');
  else setStatus('React development build · source lines available', 'ok');
  renderFolder();
}

els.toggle.addEventListener('click', async () => {
  els.toggleError.hidden = true;
  els.toggle.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'toggle', tab });
  els.toggle.disabled = false;
  if (!res?.ok) {
    els.toggleError.textContent = res?.error ?? 'Something went wrong.';
    els.toggleError.hidden = false;
    return;
  }
  setActive(res.active);
  // Out of the way so the page can be hovered.
  if (res.active) window.close();
});

// ---- project folder ---------------------------------------------------------

function renderFolder() {
  const root = origin ? settings.roots[origin] : null;
  if (document.activeElement !== els.folderInput) els.folderInput.value = root ?? '';
  els.folderInput.disabled = !origin;
  els.folderClear.hidden = !root;

  els.detectedRow.hidden = !detectedRoot;
  els.detected.textContent = detectedRoot ?? '';
  els.useDetected.hidden = !detectedRoot || Boolean(root);

  const opensFrom = root ?? detectedRoot;
  els.opensRow.hidden = !opensFrom;
  els.opens.textContent = opensFrom ?? '';

  els.recent.replaceChildren(...settings.recentRoots.map((p) => Object.assign(document.createElement('option'), { value: p })));
}

async function saveRoot(input) {
  els.folderError.hidden = true;
  const value = cleanPath(input);
  if (value && !looksAbsolute(value)) {
    els.folderError.textContent = 'Paste the full path, starting with a drive letter (C:\\…) or /.';
    els.folderError.hidden = false;
    return;
  }
  await update(rootPatch(settings, origin, value));
}

els.folderForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveRoot(els.folderInput.value);
});
els.folderClear.addEventListener('click', () => saveRoot(''));
els.useDetected.addEventListener('click', () => saveRoot(detectedRoot));

// ---- preferences ------------------------------------------------------------

for (const e of EDITORS) els.editor.append(new Option(e.label, e.id));

function renderPrefs() {
  els.editor.value = settings.editor;
  els.templateRow.hidden = settings.editor !== 'custom';
  els.template.value = settings.customTemplate;
  for (const input of document.querySelectorAll('input[name=click]')) input.checked = input.value === settings.clickAction;
  for (const input of document.querySelectorAll('input[name=mode]')) input.checked = input.value === settings.mode;
}

els.editor.addEventListener('change', () => update({ editor: els.editor.value }));
els.template.addEventListener('change', () => update({ customTemplate: els.template.value.trim() }));
document.querySelectorAll('input[name=click]').forEach((input) => input.addEventListener('change', () => update({ clickAction: input.value })));
document.querySelectorAll('input[name=mode]').forEach((input) => input.addEventListener('change', () => update({ mode: input.value })));

/** Save, redraw, and push the change into the page if it is inspecting. */
async function update(patch) {
  await saveSettings(patch);
  settings = await loadSettings();
  renderFolder();
  renderPrefs();
  if (active) chrome.runtime.sendMessage({ type: 'configure', tab });
}

// ---- links ------------------------------------------------------------------

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

renderPrefs();
renderFolder();
refreshStatus();
