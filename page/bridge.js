// Runs in the extension's isolated world. The inspector itself runs in the
// page's world (it has to read React's fibers), where chrome.* does not exist,
// so it announces on/off with DOM events and this relays them to the badge.
(() => {
  if (globalThis.__reactFormInspectorBridge) return;
  globalThis.__reactFormInspectorBridge = true;

  const send = (message) => {
    try {
      chrome.runtime.sendMessage({ type: 'rfi:state', ...message }).catch(() => {});
    } catch {
      // Extension was reloaded; this old bridge has nobody to talk to.
    }
  };

  document.addEventListener('react-form-inspector:on', () => send({ active: true }));
  document.addEventListener('react-form-inspector:off', () => send({ active: false }));
  // Leaving or reloading: clear the badge but keep the tab marked, so the
  // background can switch the inspector back on after a reload.
  addEventListener('pagehide', () => send({ active: false, unload: true }));
})();
