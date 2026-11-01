# xbkmrk for iPhone and iPad

A native SwiftUI companion for an existing xbkmrk server. Built with Xcode 27,
Swift 6 strict concurrency, and the iOS 27 SDK; supports iOS 26 and later.
System navigation bars, sheets, search, menus, and glass button styles adopt the
current Liquid Glass appearance and accessibility settings.

## Use the app

1. Enter your server's web URL and the password you already use on the website.
   For example, `https://bookmarks.example.com`; new installs start with an empty address.
2. Open the sidebar to browse **Saves**, **Archive**, or **All bookmarks**.
   Categories show your server's tags and library-wide counts. Both iPhone and
   iPad use the standard SwiftUI `NavigationSplitView`, with a sidebar
   `List(selection:)` and value-based `NavigationLink` rows. Selection styling,
   column adaptation, sidebar controls, and back gestures are provided by the
   system. On iPhone, use **Library** or the normal back gesture to return from
   the feed to the sidebar; from a bookmark, Back returns to the feed first.
   On iPad, the sidebar and selected content appear together when space allows,
   with the system sidebar toggle and adaptive layout. Choose a collection or
   category to browse it. The sidebar's **Showing** section lists the current
   collection, search, and applied filters, with an individual clear button for
   each filter. Collection/category checkmarks stay visible when the navigation
   highlight moves. **Clear filters** keeps your collection and search;
   **Show all bookmarks** clears those too and includes archived bookmarks.
   Pull down to refresh, or use **Load
   more bookmarks** to fetch the next page. The visual feed puts each source
   above a wide preview image, title, description, and tags. Each bookmark sits
   in a rounded card with a distinct gap from the next one. Compact action icons
   sit in the card footer and retain 44-point minimum touch targets. Posts
   without images have a compact text layout.
3. Search from the native search field. Sidebar filters combine category, source,
   content type (articles, videos, photos, GitHub, links, or text), and author.
   Clearing filters keeps your search and collection. Choose keyword, semantic,
   or hybrid search in the sidebar. The server limits searches to 100 hits
   and falls back to keyword search if its embedding service is unavailable.
   **Saved date** offers Today, Yesterday, This week, Last week, and an inclusive
   custom From/Through range. Dates use the device's local time; weeks run
   Monday–Sunday. These filters combine with collections, tags, search, and
   pagination. **All dates** clears just the date filter; **Clear filters** also
   clears it. The server must include the saved-date API update; older servers
   show an update message instead of silently returning unfiltered results.
4. Open a bookmark to read its text, notes, and saved article. The toolbar's
   share button opens the standard iOS share sheet with the **original URL**;
   recipients do not need access to your archive. X bookmarks share the X post.
5. The feed action row reads, shares, opens the original in Safari, or archives
   a bookmark. The archive icon becomes a restore action for archived items.
   Each action has a VoiceOver label and a 44-point touch target.
6. Open **Settings** at the bottom of the sidebar. Settings is a navigation page
   with a server connection section and an appearance section for the feed,
   bookmark page, and sidebar. Choose a system/light/dark color scheme, adjust
   feed images and visible text, change the bookmark text font and visible
   sections, or customize category counts, ordering, and how many appear.
   Preferences apply immediately and persist on this device across launches and
   server changes. Resetting appearance does not disconnect your server.
   **Server settings** shows the connected address, links to the server's web
   settings, and lets you disconnect to sign in to a different server.
   **Saving bookmarks** has separate bookmarklet and iOS Shortcut setup pages.
   Copy the bookmarklet into a Safari bookmark's address, or copy the Shortcut
   prompt into **Describe a Shortcut** on supported iOS/iPadOS 27 devices.
   Manual Shortcut steps and a **Copy save URL** button are also provided.
   These tools use the connected server's `/api/save-token` and `/api/save`,
   matching the web app. Copied text includes the private save token, not the
   login cookie; the clipboard copy stays on this device and expires after
   15 minutes. [Apple's setup guide](https://support.apple.com/guide/shortcuts/apd84c576f8c/ios)
   describes the AI and manual creation options.
7. Tap **Play** on a video card or **Play video** on its bookmark page. X videos
   and animated GIFs stream from the server's existing media archive; YouTube
   uses its official embedded player. Multiple clips can be selected in the
   player. Playback begins only after a tap, supports seeking, and stops when
   closed or when the app goes into the background. Image visibility preferences
   do not hide the Play action. Some creators restrict embedding; use **Open
   original** for those YouTube videos.
8. Use **Fetch latest posts** in the feed toolbar or Settings to ask the server
   to sync its connected sources immediately. This calls the web app's existing
   `/api/sync` endpoint, watches `/api/status`, and refreshes the feed and
   categories after a newer completed sync. It prevents duplicate taps and
   explains failed or delayed requests. Pull-to-refresh still reloads the
   bookmarks already on the server without requesting another source sync.

Videos are streaming-only on iOS: no offline video copies, download jobs, or
automatic playback while scrolling. X cards show an actual still frame from
the video, also used on the bookmark page. Preview generation reads limited
byte ranges, stops as soon as a frame is ready, and retains only an image in a
bounded memory cache. Each attempt has a 3 MiB data budget and 10-second deadline;
leaving the card cancels an unfinished request. A preview failure leaves Play
available. Disconnecting clears the preview cache. X media goes through authenticated HTTP byte
ranges into AVPlayer using an ephemeral URLSession with its URL cache disabled.
Chunks are forwarded as they arrive, rather than collecting the whole file.
The player requests a small forward buffer and cancels transfers on dismissal.
YouTube runs in a nonpersistent WKWebView without the archive session cookie.
This does not change the server's existing ingest behavior: the server still keeps
its archived X media, and the phone streams that copy.

Private Tailscale addresses require Tailscale on the phone. LAN HTTP addresses
are supported; the app explains that HTTP is unencrypted. HTTPS uses normal
system certificate validation. First-time server password setup happens in the
web app, so connecting from the phone cannot accidentally set a site password.

The app stores the session cookie in device-only Keychain storage and the last
server URL in preferences. It never persists the password. API and image
requests use an ephemeral URLSession, and redirects are refused to keep login
credentials on the entered server. Disconnect deletes the local Keychain
session; the server currently has no per-session revocation API.

## Build and run

Open `XBkmrk.xcodeproj`, select the **XBkmrk** scheme, choose your Apple signing
team and connected iPhone, then Run. Enable Developer Mode on the phone if
needed. No third-party Swift packages are required.

`project.yml` is the project source of truth. After changing targets or adding
files, regenerate with [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
cd ios
xcodegen generate
xcodebuild -project XBkmrk.xcodeproj -scheme XBkmrk \
  -destination 'generic/platform=iOS' \
  -derivedDataPath .build-device -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=YOUR_TEAM_ID build
```

Install and launch on a paired, available phone:

```sh
xcrun devicectl list devices
xcrun devicectl device install app --device YOUR_DEVICE_ID \
  .build-device/Build/Products/Debug-iphoneos/XBkmrk.app
xcrun devicectl device process launch --device YOUR_DEVICE_ID net.3sparks.xbkmrk
```

## Validation

```sh
xcodebuild -project XBkmrk.xcodeproj -scheme XBkmrk \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' \
  -derivedDataPath .build test
```

Allow normal simulator signing. `CODE_SIGNING_ALLOWED=NO` removes the app
identity that simulator Keychain needs, so an unsigned build cannot complete
sign-in. Tests cover the server JSON contract, session authentication, expired
sessions, wrong passwords, address normalization and rejection, query encoding,
source sharing, and unsafe media paths.
Saving tests execute the generated bookmarklet with fixture page data and verify
URL encoding, title/selection limits, and the Shortcut recipe. Sync tests cover
authenticated endpoints, accepted versus completed requests, duplicate taps,
timestamp formats, cancellation, errors, and delayed completion.
Video tests also cover YouTube URL formats, untrusted URLs, authenticated media
requests, and valid/invalid HTTP byte ranges.

For UI checks without private data, run `python3 UITestSupport/server.py` and
connect the simulator to `http://127.0.0.1:18769` with password
`fixture-password`. This fixture includes pagination, search, tags, saved
articles, and archive updates. It is a separate local server; no sample content
is bundled into the production app or written to a production server.

For image-layout QA, optionally place `nasa.jpg` and `swiftui.jpg` in
`/tmp/xbkmrk-fixture-media` before starting the fixture server (override with
`XBKMRK_FIXTURE_MEDIA`). The test images used during development come from
[NASA](https://www.nasa.gov/wp-content/uploads/2018/07/174116main_2006_01777_highres.jpg)
and [Apple Developer](https://developer.apple.com/swiftui/images/hero-swiftui-s-dark_2x.jpg).
The server serves them through its authenticated media endpoint, just like the
real archive. They are not bundled with the app.

For streaming integration checks, generate a local test pattern (requires
FFmpeg) before starting the fixture server:

```sh
mkdir -p /tmp/xbkmrk-fixture-media
ffmpeg -f lavfi -i testsrc2=size=960x540:rate=24 \
  -f lavfi -i sine=frequency=440:sample_rate=44100 -t 120 \
  -c:v libx264 -preset ultrafast -b:v 3500k -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart /tmp/xbkmrk-fixture-media/stream.mp4
```

Restart the fixture server before each integration run to reset its request
audit. Enable the six opt-in integration tests with
`TEST_RUNNER_XBKMRK_VIDEO_FIXTURE=1` when running `xcodebuild test` (or pass
`testRunnerEnv: { XBKMRK_VIDEO_FIXTURE: "1" }` to XcodeBuildMCP `test_sim`).
They verify playback before a complete transfer, seeking, cancellation, redirect
rejection, preview extraction, cache isolation, and preview data limits. A rendered
X card screenshot is kept in the test results. The YouTube playback check uses
Google's public player demo in an ephemeral web view and requires internet access. Normal unit-test
runs skip these integration checks. No fixture media is bundled in the app.

The opt-in `XBkmrkUITests` navigation test uses the local fixture server.
Set `TEST_RUNNER_XBKMRK_UI_FIXTURE=1` (or
`testRunnerEnv: { XBKMRK_UI_FIXTURE: "1" }`) and run with
`-only-testing:XBkmrkUITests -parallel-testing-enabled NO`. It verifies native
collection/category selection, bookmark Back navigation, Settings and server
settings, and returning to the feed. On iPad it also checks that the sidebar
and feed are visible together in landscape. A screenshot is attached to the
result bundle. A fresh test simulator signs into the local fixture automatically;
production devices use the normal server sign-in. The saving/setup test checks
both copy flows and a manual sync that adds a fixture bookmark and refreshes
the visible count automatically.
For a fresh simulator, also include
`-only-testing:XBkmrkTests/UITestFixtureSessionTests` in that run. With the same
fixture flag it signs the app into the local server through the normal login
API before UI tests begin, avoiding keyboard setup failures. No fixture login
path is included in the app itself. Sidebar selection checks verify persistent
category/collection indicators, individual clearing, Clear filters, and Show all.

## Structure and limits

- `App`: root state and session ownership using Observation.
- `Services`: actor-isolated networking, URL validation, and Keychain storage.
- `Models`: server response types and query parameters.
- `Features`: focused SwiftUI screens, cancellable search, paged library,
  authenticated images, and an isolated reader with JavaScript disabled.

Saving tools and manual fetch use existing server endpoints without server changes;
saved-date filtering needs the API update described above. The app currently
requires connectivity; there is no offline library, inbound share extension,
bookmark creation, or offline video playback. Outbound sharing uses ShareLink.
GitHub saved content is displayed with inline Markdown formatting; ordinary
articles use the server's extracted HTML in a restricted WKWebView.
X posts, X articles, and transcripts preserve their literal text and paragraphs.
Bookmark details expose saved links separately, including links without saved
article content, and map short links to their expanded destinations. Sharing an
X bookmark keeps the original post URL; the saved article reader uses the
article URL. The optional server preview flag explains when X supplied only
truncated text. Existing servers remain compatible, but recovering previously
omitted links depends on the server’s ingestion and repair capabilities.

To check long-post reading, start the fixture server with
`XBKMRK_LINK_FIXTURE=1`, enable the same test-runner flag along with
`XBKMRK_UI_FIXTURE=1`, and run `BookmarkReadingTests` plus
`UITestFixtureSessionTests`. This checks the full text, reachable article link,
and literal angle brackets in saved X article content.
