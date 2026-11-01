# Save-to-archive browser extension

Companion to the bookmarklet for browsers where bookmarklets don't work —
notably Arc, which has no bookmarks bar and won't execute `javascript:` URLs
from sidebar pins. Same flow as the bookmarklet: one click opens a small popup
that hits `/api/save` and closes itself.

## Install (Arc / Chrome / Edge / Brave)

1. In the archive's **Settings** page, hit **Download extension** — the zip
   comes pre-configured with your archive's address and save token.
2. Extract it somewhere permanent (Chrome loads the files from disk, so don't
   delete the folder afterwards).
3. Open `arc://extensions` (or `chrome://extensions`), enable **Developer
   mode**, click **Load unpacked**, and pick the extracted folder.

Then on any page, click the toolbar icon (or press **Alt+S**) to save it.
Select text first to capture a quote, exactly like the bookmarklet.

Loading this folder straight from the repo also works — it just ships an empty
`config.js`, so the options page opens on first click: paste the bookmarklet
code from Settings there and the address + token are extracted automatically.

Loaded-unpacked extensions don't auto-update: after replacing the folder's
contents, hit the reload arrow on the extensions page.
