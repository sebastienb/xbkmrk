const $ = (id) => document.getElementById(id);

// Pull origin + token out of the bookmarklet's save URL:
//   u='http://host:3000/api/save?token=abc123'
function parseBookmarklet(code) {
  const m = code.match(/(https?:\/\/[^'"]+?)\/api\/save\?token=([^'"&]+)/);
  return m ? { origin: m[1], token: m[2] } : null;
}

$("paste").addEventListener("input", () => {
  const parsed = parseBookmarklet($("paste").value);
  if (parsed) {
    $("origin").value = parsed.origin;
    $("token").value = parsed.token;
  }
});

$("save").addEventListener("click", async () => {
  const origin = $("origin").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim();
  const status = $("status");
  try {
    new URL(origin);
  } catch {
    status.textContent = "Enter a valid archive address.";
    return;
  }
  if (!token) {
    status.textContent = "Token is missing.";
    return;
  }
  await chrome.storage.sync.set({ origin, token });
  status.textContent = "Saved ✓";
  setTimeout(() => (status.textContent = ""), 1500);
});

// Show the effective config: options-page overrides win, else what the
// Settings-page download baked into config.js.
chrome.storage.sync.get({ origin: "", token: "" }).then(({ origin, token }) => {
  $("origin").value = origin || BAKED.origin;
  $("token").value = token || BAKED.token;
});
