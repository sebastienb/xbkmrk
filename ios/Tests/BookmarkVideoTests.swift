import Foundation
import XCTest
@testable import XBkmrk

final class BookmarkVideoTests: XCTestCase {
    func testYouTubeWatchShortLiveAndEmbeddedLinks() {
        for url in ["https://www.youtube.com/watch?v=M7lc1UVf-VE&t=90",
                    "https://youtu.be/M7lc1UVf-VE?si=sharing",
                    "https://m.youtube.com/shorts/M7lc1UVf-VE",
                    "https://youtube.com/live/M7lc1UVf-VE",
                    "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE"] {
            XCTAssertEqual(BookmarkVideo.youtubeID(from: url), "M7lc1UVf-VE")
        }
    }

    func testYouTubeRejectsLookalikeHostsCredentialsAndInjectedIDs() {
        for url in ["https://youtube.com.evil.example/watch?v=M7lc1UVf-VE",
                    "https://youtube.com@evil.example/watch?v=M7lc1UVf-VE",
                    "https://user:secret@youtube.com/watch?v=M7lc1UVf-VE",
                    "file:///watch?v=M7lc1UVf-VE", "https://youtu.be/too-short",
                    "https://youtube.com/watch?v=abcdefghij%27", "https://youtube.com/playlist?list=M7lc1UVf-VE"] {
            XCTAssertNil(BookmarkVideo.youtubeID(from: url), url)
        }
    }

    func testMediaPathsRejectTraversalAndRemoteAddresses() {
        for path in ["", "/video.mp4", "../video.mp4", "folder/../video.mp4", "./video.mp4",
                     "https://elsewhere.example/video.mp4", "//elsewhere/video.mp4", "x\\video.mp4",
                     "%2e%2e/video.mp4", "folder%2fvideo.mp4", "video.mp4?x=1", "video.mp4#fragment",
                     "a//video.mp4", "video.mp4\n"] {
            XCTAssertFalse(BookmarkVideo.isSafeMediaPath(path), path)
        }
        XCTAssertTrue(BookmarkVideo.isSafeMediaPath("123/abc_def-01.mp4"))
    }

    func testSelectsAllArchivedClipsAndDeduplicatesYouTubeLinks() throws {
        let json = """
        {"id":"123","text":"Video post","saved_at":"2026-10-25T12:00:00Z","tags":[],"source":"x",
        "media":[{"media_key":"1","type":"photo","local_path":"photo.jpg"},
                 {"media_key":"2","type":"video","local_path":"123/clip.mp4"},
                 {"media_key":"3","type":"animated_gif","local_path":"123/gif.mp4"},
                 {"media_key":"4","type":"video","local_path":null},
                 {"media_key":"5","type":"video","local_path":"../private"}],
        "urls":[{"expanded_url":"https://youtu.be/M7lc1UVf-VE"},{"expanded_url":"https://youtube.com/watch?v=M7lc1UVf-VE"}]}
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let bookmark = try decoder.decode(Bookmark.self, from: Data(json.utf8))
        XCTAssertEqual(bookmark.videos, [.server(path: "123/clip.mp4", animated: false),
                                         .server(path: "123/gif.mp4", animated: true),
                                         .youtube(id: "M7lc1UVf-VE")])
        XCTAssertEqual(bookmark.originalURL?.absoluteString, "https://x.com/i/status/123")
    }

    func testStreamRequestKeepsAuthenticationOnConfiguredServerAndPath() async throws {
        let client = ArchiveClient(baseURL: URL(string: "https://archive.example:3443/bookmarks")!,
                                   cookie: SessionCookie(value: "test-session", expires: nil))
        let request = try await client.videoRequest(path: "123/clip.mp4")
        XCTAssertEqual(request.url?.absoluteString, "https://archive.example:3443/bookmarks/api/media/123/clip.mp4")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "xbm_session=test-session")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept-Encoding"), "identity")
        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
    }

    func testStreamRequestRequiresAuthentication() async throws {
        let client = ArchiveClient(baseURL: URL(string: "https://archive.example")!)
        do {
            _ = try await client.videoRequest(path: "clip.mp4")
            XCTFail("Expected authentication error")
        } catch ArchiveError.unauthenticated { }
    }

    func testStreamRequestRejectsEncodedTraversalBeforeSendingCookie() async throws {
        let client = ArchiveClient(baseURL: URL(string: "https://archive.example")!,
                                   cookie: SessionCookie(value: "test-session", expires: nil))
        do {
            _ = try await client.videoRequest(path: "%2e%2e/private")
            XCTFail("Expected invalid path")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Invalid video path.")
        }
    }

    func testByteRangeSupportsInitialProbeAndSeeking() throws {
        let probe = try XCTUnwrap(VideoStreamLoader.contentRange("bytes 0-1/50000000"))
        XCTAssertEqual(probe.start, 0)
        XCTAssertEqual(probe.end, 1)
        XCTAssertEqual(probe.total, 50_000_000)
        let seek = try XCTUnwrap(VideoStreamLoader.contentRange("bytes 25000000-49999999/50000000"))
        XCTAssertEqual(seek.start, 25_000_000)
        XCTAssertEqual(seek.total, 50_000_000)
    }

    func testMalformedOrUnsatisfiedByteRangesAreRejected() {
        for header in [nil, "bytes */50", "bytes 0-50/50", "bytes -1-3/10", "bytes 5-3/10",
                       "bytes 0-1/*", "items 0-1/10", "bytes 0-1/0", "bytes 0-1/10/11"] {
            XCTAssertNil(VideoStreamLoader.contentRange(header))
        }
    }
}
