// Same flow as the bookmarklet: build a /api/save URL and open it in a small
// popup (top-level navigation, so no CORS involved). The server responds with
// a self-closing "Saved ✓" page.
// config.js carries the address + token baked in by the Settings-page download;
// values saved in the options page override it.
importScripts("config.js");

chrome.action.onClicked.addListener(async (tab) => {
  const stored = await chrome.storage.sync.get({ origin: "", token: "" });
  const origin = stored.origin || BAKED.origin;
  const token = stored.token || BAKED.token;
  if (!origin || !token) {
    chrome.runtime.openOptionsPage();
    return;
  }

  let sel = "";
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection ? window.getSelection() : "").slice(0, 1500),
    });
    sel = res?.result ?? "";
  } catch {
    // chrome:// pages and the like refuse injection — save without a quote
  }

  const u = new URL("/api/save", origin);
  u.searchParams.set("token", token);
  u.searchParams.set("url", tab.url ?? "");
  u.searchParams.set("title", (tab.title ?? "").slice(0, 300));
  if (sel) u.searchParams.set("sel", sel);

  chrome.windows.create({ url: u.href, type: "popup", width: 420, height: 260 });
});
