import AVFoundation
import SwiftUI
import WebKit
import XCTest
@testable import XBkmrk

/// Opt-in integration checks against UITestSupport/server.py and a generated
/// 120-second stream.mp4; they never use the user's server or credentials.
@MainActor
final class VideoStreamingIntegrationTests: XCTestCase {
    private func client() throws -> ArchiveClient {
        guard ProcessInfo.processInfo.environment["XBKMRK_VIDEO_FIXTURE"] == "1" else {
            throw XCTSkip("Set XBKMRK_VIDEO_FIXTURE=1 and run the local video fixture server.")
        }
        return ArchiveClient(baseURL: URL(string: "http://127.0.0.1:18769")!,
                             cookie: SessionCookie(value: "fixture-session", expires: nil))
    }

    func testPlayerStartsBeforeFullFileArrivesSeeksAndCancels() async throws {
        let client = try client()
        let loader = VideoStreamLoader(request: try await client.videoRequest(path: "stream.mp4"))
        let item = AVPlayerItem(asset: loader.asset)
        item.preferredForwardBufferDuration = 5
        let player = AVPlayer(playerItem: item)
        defer { player.pause(); player.replaceCurrentItem(with: nil); loader.stop() }
        player.isMuted = true
        player.play()
        try await waitUntil { item.status == .failed || player.currentTime().seconds > 1 }
        XCTAssertEqual(item.status, .readyToPlay, loader.failure ?? String(describing: item.error))
        // AVFoundation can vend an empty cache-inspection object even when no
        // offline media exists. The supported offline-playability flag is the
        // relevant assertion, not the existence of that inspection object.
        XCTAssertFalse(loader.asset.assetCache?.isPlayableOffline ?? false)
        let initial = try await requests()
        XCTAssertTrue(initial.contains { $0.start == 0 })
        XCTAssertLessThan(initial.reduce(0) { $0 + ($1.sent ?? 0) }, initial.first?.total ?? 0,
                          "Playback must start before the complete file arrives.")
        let sought = await player.seek(to: CMTime(seconds: 90, preferredTimescale: 600),
                                       toleranceBefore: .zero, toleranceAfter: .zero)
        XCTAssertTrue(sought)
        try await waitUntil { player.currentTime().seconds >= 90 }
        player.pause()
        player.replaceCurrentItem(with: nil)
        loader.stop()
        try await waitUntil { (try? await self.requests().allSatisfy { $0.finished == true }) == true }
        let stopped = try await requests()
        XCTAssertTrue(stopped.contains { ($0.start ?? 0) > 1_000_000 }, "Seeking should request a later byte range.")
        let count = stopped.reduce(0) { $0 + ($1.sent ?? 0) }
        try await Task.sleep(for: .milliseconds(500))
        let later = try await requests()
        XCTAssertEqual(later.reduce(0) { $0 + ($1.sent ?? 0) }, count, "Closing must stop network transfers.")
    }

    func testRedirectIsRefusedWithoutForwardingSession() async throws {
        let client = try client()
        let loader = VideoStreamLoader(request: try await client.videoRequest(path: "redirect.mp4"))
        let item = AVPlayerItem(asset: loader.asset)
        let player = AVPlayer(playerItem: item)
        defer { player.replaceCurrentItem(with: nil); loader.stop() }
        player.play()
        try await waitUntil { item.status == .failed }
        XCTAssertTrue(loader.failure?.contains("redirects") == true)
        let records = try await requests()
        XCTAssertFalse(records.contains { $0.redirectFollowed == true })
    }

    func testYouTubeEmbedPlaysInAnEphemeralWebView() async throws {
        _ = try client()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = try XCTUnwrap(scene.windows.first(where: \.isKeyWindow))
        let root = try XCTUnwrap(window.rootViewController)
        let host = UIHostingController(rootView: YouTubePlayerView(videoID: "M7lc1UVf-VE"))
        host.modalPresentationStyle = .fullScreen
        root.present(host, animated: false)
        defer { host.dismiss(animated: false) }
        func webView(in view: UIView) -> WKWebView? {
            if let web = view as? WKWebView { return web }
            return view.subviews.lazy.compactMap { webView(in: $0) }.first
        }
        try await waitUntil { webView(in: host.view) != nil }
        let web = try XCTUnwrap(webView(in: host.view))
        XCTAssertFalse(web.configuration.websiteDataStore.isPersistent)
        try await waitUntil {
            let state = try? await web.evaluateJavaScript("typeof player !== 'undefined' && typeof player.getPlayerState === 'function' ? player.getPlayerState() : -99")
            return (state as? Int) == 1
        }
        let cookies = await web.configuration.websiteDataStore.httpCookieStore.allCookies()
        XCTAssertFalse(cookies.contains { $0.name == "xbm_session" })
    }

    func testThumbnailUsesPartialStreamAndReusesOnlyThisSessionsImage() async throws {
        let client = try client()
        let session = AppSession()
        let before = try await requests().count
        let image = try await session.videoThumbnails.image(path: "stream.mp4", client: client)
        XCTAssertGreaterThan(image.size.width, 0)
        XCTAssertLessThanOrEqual(max(image.size.width, image.size.height), 800)
        try await waitUntil { (try? await self.requests().allSatisfy { $0.finished == true }) == true }
        let generated = Array(try await requests().dropFirst(before))
        XCTAssertFalse(generated.isEmpty)
        XCTAssertLessThan(generated.reduce(0) { $0 + ($1.sent ?? 0) }, 4 * 1024 * 1024)
        let count = try await requests().count
        let cached = try await session.videoThumbnails.image(path: "stream.mp4", client: client)
        XCTAssertTrue(cached === image)
        let afterCache = try await requests().count
        XCTAssertEqual(afterCache, count, "Scrolling back should not request the video again.")
        let unauthenticated = ArchiveClient(baseURL: URL(string: "http://127.0.0.1:18769")!)
        do {
            _ = try await session.videoThumbnails.image(path: "stream.mp4", client: unauthenticated)
            XCTFail("A different session must not reuse private previews.")
        } catch ArchiveError.unauthenticated { }

        // Capture the real SwiftUI feed component with its generated frame.
        let bookmark = try await client.bookmark(id: "5")
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = try XCTUnwrap(scene.windows.first(where: \.isKeyWindow))
        let root = try XCTUnwrap(window.rootViewController)
        let host = UIHostingController(rootView:
            NavigationStack {
                ScrollView {
                    BookmarkCard(bookmark: bookmark, client: client, isUpdating: false, onToggleRead: {})
                        .padding(14)
                }
                .background(Color(.systemGroupedBackground)).navigationTitle("xbkmrk")
                .navigationBarTitleDisplayMode(.inline)
            }
            .environment(session).environment(AppAppearance())
        )
        host.modalPresentationStyle = .fullScreen
        root.present(host, animated: false)
        defer { host.dismiss(animated: false) }
        try await Task.sleep(for: .milliseconds(500))
        let screenshot = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: screenshot)
        attachment.name = "X video card with generated thumbnail"
        attachment.lifetime = .keepAlways
        add(attachment)
        try screenshot.pngData()?.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("xbkmrk-thumbnail-card.png"))
        session.videoThumbnails.clear()
        _ = try await session.videoThumbnails.image(path: "stream.mp4", client: client)
        let afterClear = try await requests().count
        XCTAssertGreaterThan(afterClear, count, "Clearing a session must remove its preview cache.")
    }

    func testThumbnailCancellationStopsRangeTransfers() async throws {
        let client = try client()
        let store = VideoThumbnailStore()
        let before = try await requests().count
        let task = Task { try await store.image(path: "slow.mp4", client: client) }
        try await waitUntil { (try? await self.requests().count) ?? 0 > before }
        task.cancel()
        do { _ = try await task.value; XCTFail("Expected cancellation") }
        catch { }
        try await waitUntil { (try? await self.requests().allSatisfy { $0.finished == true }) == true }
    }

    func testPreviewDataBudgetStopsExcessiveTransfers() async throws {
        let client = try client()
        let loader = VideoStreamLoader(request: try await client.videoRequest(path: "stream.mp4"), byteLimit: 1)
        let item = AVPlayerItem(asset: loader.asset)
        let player = AVPlayer(playerItem: item)
        defer { player.replaceCurrentItem(with: nil); loader.stop() }
        player.play()
        try await waitUntil { item.status == .failed }
        XCTAssertTrue(loader.failure?.contains("preview data limit") == true)
    }

    private struct RequestRecord: Decodable {
        let start: Int?
        let total: Int?
        let sent: Int?
        let finished: Bool?
        let redirectFollowed: Bool?
    }

    private func requests() async throws -> [RequestRecord] {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:18769/test/video-requests")!)
        request.setValue("xbm_session=fixture-session", forHTTPHeaderField: "Cookie")
        let (data, _) = try await URLSession(configuration: .ephemeral).data(for: request)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode([RequestRecord].self, from: data)
    }

    private func waitUntil(_ predicate: () async throws -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(15)
        while try await !predicate() {
            if ContinuousClock.now >= deadline {
                XCTFail("Timed out waiting for streaming playback")
                throw CancellationError()
            }
            try await Task.sleep(for: .milliseconds(100))
        }
    }
}
