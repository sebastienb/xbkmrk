# Documentation assets

All screenshots in `docs/screenshots/` are actual captures of the web app or native iOS app connected to a disposable local archive. Every visible bookmark, article, author, tag, date, and count is synthetic. The demonstration URLs use `example.com`; no production archive was used.

The app and extension icons are original geometric artwork defined in `docs/artwork/app-icon.svg`. The landscape illustrations are original SVG shapes in `docs/demo/media/`. These assets and the demonstration prose were created for this repository and are provided under its MIT license. They replace the previous icons of undocumented origin and screenshots containing third-party media.

The PNG files are renders of those SVG sources. `docs/demo/prepare.mjs` regenerates the images and optionally seeds an explicitly selected empty local demo database. Browser and simulator screenshots are not composited or retouched.

Normal application dependencies retain their own licenses as recorded in their packages and lockfiles. The optional external media URLs in the iOS QA guide are not bundled assets and are not used in these screenshots.
