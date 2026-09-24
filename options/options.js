import { cleanPath, EDITORS, loadSettings, looksAbsolute, originOf, rootPatch, saveSettings } from '../shared/settings.js';

const $ = (id) => document.getElementById(id);
let settings = await loadSettings();
let savedTimer = 0;

function flashSaved(text = 'Saved') {
  $('saved').textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = ''), 1400);
}

async function update(patch) {
  await saveSettings(patch);
  settings = await loadSettings();
  render();
  flashSaved();
}

// ---- project folders --------------------------------------------------------

function folderRow(origin, root) {
  const tr = document.createElement('tr');
  const site = document.createElement('td');
  site.textContent = origin;
  const folder = document.createElement('td');
  const input = Object.assign(document.createElement('input'), { type: 'text', value: root, spellcheck: false });
  input.setAttribute('aria-label', `Folder for ${origin}`);
  input.addEventListener('change', () => {
    const value = cleanPath(input.value);
    if (value && !looksAbsolute(value)) {
      input.setCustomValidity('Use a full path');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    update(rootPatch(settings, origin, value));
  });
  folder.append(input);
  const actions = document.createElement('td');
  const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Remove' });
  remove.addEventListener('click', () => update(rootPatch(settings, origin, '')));
  actions.append(remove);
  tr.append(site, folder, actions);
  return tr;
}

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('add-error').hidden = true;
  const raw = $('add-origin').value.trim();
  const origin = originOf(/^https?:\/\//.test(raw) ? raw : `http://${raw}`);
  const root = cleanPath($('add-root').value);
  const problem = !origin ? 'Enter the site address, like http://localhost:5173.' : !looksAbsolute(root) ? 'Enter the full folder path, like C:\\work\\my-app.' : null;
  if (problem) {
    $('add-error').textContent = problem;
    $('add-error').hidden = false;
    return;
  }
  $('add-origin').value = '';
  $('add-root').value = '';
  update(rootPatch(settings, origin, root));
});

// ---- editor -----------------------------------------------------------------

for (const e of EDITORS) $('editor').append(new Option(e.label, e.id));
$('editor').addEventListener('change', () => update({ editor: $('editor').value }));
$('template').addEventListener('change', () => update({ customTemplate: $('template').value.trim() }));
document.querySelectorAll('[data-template]').forEach((b) =>
  b.addEventListener('click', () => update({ editor: 'custom', customTemplate: b.dataset.template })),
);

// ---- behaviour --------------------------------------------------------------

document.querySelectorAll('input[name=click]').forEach((i) => i.addEventListener('change', () => update({ clickAction: i.value })));
document.querySelectorAll('input[name=mode]').forEach((i) => i.addEventListener('change', () => update({ mode: i.value })));
$('keep').addEventListener('change', () => update({ keepOnReload: $('keep').checked }));
$('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

const commands = await chrome.commands.getAll();
$('shortcut').textContent = commands.find((c) => c.name === 'toggle-inspector')?.shortcut || 'not set';

function render() {
  const entries = Object.entries(settings.roots);
  $('folder-rows').replaceChildren(...entries.map(([o, r]) => folderRow(o, r)));
  $('folders-empty').hidden = entries.length > 0;
  $('editor').value = settings.editor;
  $('custom').hidden = settings.editor !== 'custom';
  $('dev-server-note').hidden = settings.editor !== 'dev-server';
  $('template').value = settings.customTemplate;
  document.querySelectorAll('input[name=click]').forEach((i) => (i.checked = i.value === settings.clickAction));
  document.querySelectorAll('input[name=mode]').forEach((i) => (i.checked = i.value === settings.mode));
  $('keep').checked = settings.keepOnReload;
}

render();
