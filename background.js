// Service worker. The page scripts are only injected when you ask for them
// (popup button or keyboard shortcut); that user action grants `activeTab`,
// so the extension never needs permission to read every site.

import { blockedReason, loadSettings, pageConfig } from './shared/settings.js';

const PAGE_FILES = ['page/fiber.js', 'page/source.js', 'page/overlay.js', 'page/inspector.js'];

async function inject(tabId) {
  // The bridge lives in the extension's isolated world so the page script can
  // report on/off (for the badge) without having chrome.* itself.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page/bridge.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: PAGE_FILES });
}

/** Calls window.__REACT_FORM_INSPECTOR__[method](arg) in the page and returns its result. */
async function callPage(tabId, method, arg = null) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (m, a) => {
      const api = window.__REACT_FORM_INSPECTOR__;
      return api && typeof api[m] === 'function' ? api[m](a) : null;
    },
    args: [method, arg],
  });
  return res?.result ?? null;
}

/** @param {'toggle' | 'start' | 'stop'} method */
async function run(tab, method) {
  const blocked = blockedReason(tab?.url);
  if (!tab?.id || blocked) return { ok: false, error: blocked ?? 'No tab.' };
  try {
    await inject(tab.id);
    const settings = await loadSettings();
    const active = Boolean(await callPage(tab.id, method, pageConfig(settings, tab.url)));
    await remember(tab.id, active);
    return { ok: true, active };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

async function status(tab) {
  const blocked = blockedReason(tab?.url);
  if (!tab?.id || blocked) return { ok: false, error: blocked ?? 'No tab.' };
  try {
    await inject(tab.id);
    const settings = await loadSettings();
    return { ok: true, ...(await callPage(tab.id, 'probe', pageConfig(settings, tab.url))) };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

function friendly(error) {
  const text = String(error?.message ?? error);
  if (/file:/.test(text) || /Cannot access contents of url "file/.test(text)) {
    return 'Turn on "Allow access to file URLs" for this extension in chrome://extensions.';
  }
  if (/Cannot access|must request permission/i.test(text)) {
    return 'Open the popup (or press the shortcut) on this tab first, then try again.';
  }
  return text;
}

// ---- which tabs are inspecting (session storage: the worker sleeps when idle) ----

async function onTabs() {
  const { onTabs = [] } = await chrome.storage.session.get('onTabs');
  return new Set(onTabs);
}

async function remember(tabId, active) {
  const tabs = await onTabs();
  if (active) tabs.add(tabId);
  else tabs.delete(tabId);
  await chrome.storage.session.set({ onTabs: [...tabs] });
  await badge(tabId, active);
}

async function badge(tabId, active) {
  try {
    if (active) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#FFD60A' });
      await chrome.action.setBadgeTextColor({ tabId, color: '#1C1D21' });
    }
    await chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
  } catch {
    // The tab is gone.
  }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-inspector') return;
  const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  await run(target, 'toggle');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'rfi:state':
      // From the bridge: the page turned itself on or off (✕, Esc, unload).
      if (sender.tab?.id !== undefined) {
        if (message.unload) badge(sender.tab.id, false);
        else remember(sender.tab.id, Boolean(message.active));
      }
      return false;
    case 'toggle':
    case 'start':
    case 'stop':
      run(message.tab, message.type).then(sendResponse);
      return true;
    case 'status':
      status(message.tab).then(sendResponse);
      return true;
    case 'configure':
      configureTab(message.tab).then(sendResponse);
      return true;
    default:
      return false;
  }
});

async function configureTab(tab) {
  try {
    const settings = await loadSettings();
    await callPage(tab.id, 'configure', pageConfig(settings, tab.url));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

// Reloading a page kills the inspector with it. activeTab survives a reload on
// the same site, so switch it back on once the new page has loaded.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  if (!(await onTabs()).has(tabId)) return;
  const { keepOnReload } = await loadSettings();
  if (!keepOnReload) {
    await remember(tabId, false);
    return;
  }
  const res = await run(tab, 'start');
  if (!res.ok) await remember(tabId, false);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  remember(tabId, false);
});

// Folder or editor changed in the options page: update the tabs inspecting now.
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== 'local') return;
  for (const tabId of await onTabs()) {
    try {
      await configureTab(await chrome.tabs.get(tabId));
    } catch {
      // Closed, or no longer ours to script.
    }
  }
});
