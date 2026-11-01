# Reproduce the documentation screenshots

The committed captures use six invented articles, demo authors, example.com URLs, and original SVG landscapes. No production database, account, API token, browser profile, or real archive is used.

1. Create an empty disposable PostgreSQL database and apply the normal migrations in `db/migrations/`. Use pgvector for a full application instance. Do not point the demo scripts at an existing archive.
2. Install the web app dependencies. Provide Playwright from a separate temporary tooling environment, using `PLAYWRIGHT_MODULE` if necessary. `CHROME_PATH` may name a local Chromium/Chrome executable.
3. Run `node docs/demo/prepare.mjs` to regenerate the original icon and landscape PNGs. To seed the empty localhost database, additionally set `XBKMRK_DEMO_DATABASE=1` and `SCREENSHOT_DATABASE_URL` to that disposable database. The script refuses nonlocal or nonempty databases.
4. Build and run the unchanged web app on `127.0.0.1:18770`, with `DATABASE_URL` pointing to that database, `MEDIA_DIR` pointing to the absolute `docs/demo/media` directory, and `SYNC_ON_ACCESS_HOURS=0`. Do not start the poller or configure external services.
5. Run `node docs/demo/capture-web.mjs`. It sets the disposable site's password to the documented demo-only value on first login. It uses a fresh browser session, limits page requests to the local server, and captures the library, article, digest and appearance settings.
6. Build the iOS app in a fresh simulator, connect it to the same loopback server with the demo-only password, and capture the library, article and sidebar. Do not use an existing signed-in production app.
7. Inspect every image, especially settings pages, for tokens and private data before committing. Stop the disposable services after capture. Never upload generated database files, configured extension ZIPs or browser/session state.

The capture environment used native PostgreSQL for the nonsemantic screens. Its temporary fixture schema represented the unused embedding column as an array and omitted the vector index because pgvector was unavailable on that host. Production migration files and application code were unchanged; semantic search is outside these captures.

See [asset provenance](../ASSET_PROVENANCE.md) for the original artwork sources and licensing notes.
