import Foundation
import XCTest
@testable import XBkmrk

final class ArchiveClientTests: XCTestCase {
    func testDecodesServerContractAndPublicShareURL() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let page = try decoder.decode(BookmarkPage.self, from: Data(StubProtocol.page.utf8))
        XCTAssertEqual(page.bookmarks.first?.originalURL?.absoluteString, "https://example.org/article")
        XCTAssertEqual(page.bookmarks.first?.link?.ogImagePath, "og/123.jpg")
        XCTAssertNotNil(page.bookmarks.first?.savedDate)
        XCTAssertEqual(page.nextCursor, "next+page==")
    }

    func testXBookmarkSharesPostInsteadOfLinkedArticle() throws {
        let json = StubProtocol.page.replacingOccurrences(of: "\"source\":\"web\"", with: "\"source\":\"x\"")
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let page = try decoder.decode(BookmarkPage.self, from: Data(json.utf8))
        XCTAssertEqual(page.bookmarks.first?.originalURL?.absoluteString, "https://x.com/i/status/123")
    }

    func testRejectsUnsafeSharedURLs() {
        XCTAssertNil(Bookmark.webURL("javascript:alert(1)"))
        XCTAssertNil(Bookmark.webURL("https://user:password@example.com"))
        XCTAssertNil(Bookmark.webURL("file:///private/data"))
    }

    func testLoginCookieAuthenticatesSubsequentRequests() async throws {
        let client = makeClient()
        let status = try await client.authenticationStatus()
        XCTAssertFalse(status.setup)
        let cookie = try await client.signIn(password: "fixture-password")
        XCTAssertEqual(cookie.value, "fixture-session")
        let page = try await client.bookmarks(query: BookmarkQuery())
        XCTAssertEqual(page.total, 2)
    }

    func testExpiredSessionIsRecognized() async throws {
        do {
            _ = try await makeClient().bookmarks(query: BookmarkQuery())
            XCTFail("Expected authentication failure")
        } catch ArchiveError.unauthenticated { }
    }

    func testOldServerCannotSilentlyIgnoreDateFilters() async throws {
        let client = makeClient()
        _ = try await client.signIn(password: "fixture-password")
        var query = BookmarkQuery()
        query.savedDate = .make(.today)
        do {
            _ = try await client.bookmarks(query: query)
            XCTFail("An old server must not return unfiltered bookmarks as date-filtered results.")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("Update your xbkmrk server"))
        }
    }

    func testWrongPasswordPreservesServerMessage() async throws {
        do {
            _ = try await makeClient().signIn(password: "wrong")
            XCTFail("Expected rejection")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Wrong password.")
        }
    }

    func testSavingAndSyncUseAuthenticatedExistingServerEndpoints() async throws {
        let client = makeClient()
        _ = try await client.signIn(password: "fixture-password")
        let instructions = try await client.saveInstructions()
        XCTAssertEqual(instructions.saveURL.absoluteString, "https://fixture.example/api/save?token=fixture-save-token")
        let status = try await client.status()
        XCTAssertNotNil(status.lastChecked)
        try await client.requestSync()
    }

    func testSaveTokenRequiresAuthentication() async throws {
        do {
            _ = try await makeClient().saveInstructions()
            XCTFail("Expected authentication failure")
        } catch ArchiveError.unauthenticated { }
    }

    func testSyncRejectsFailedOrUnacknowledgedRequests() async throws {
        for host in ["failure.example", "unacknowledged.example"] {
            let client = makeClient(host: host)
            _ = try await client.signIn(password: "fixture-password")
            do {
                try await client.requestSync()
                XCTFail("Expected sync rejection")
            } catch {
                XCTAssertTrue(error.localizedDescription.contains(host == "failure.example" ? "Sync unavailable" : "did not accept"))
            }
        }
    }

    func testRejectsMediaPathTraversal() async throws {
        do {
            _ = try await makeClient().image(path: "../secrets")
            XCTFail("Expected invalid path")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Invalid image path.")
        }
    }

    @MainActor
    func testArchivingRemovesOnlyTheSelectedCardFromSaves() async throws {
        let client = makeClient()
        _ = try await client.signIn(password: "fixture-password")
        let model = LibraryModel()
        let session = AppSession()
        await model.reload(query: BookmarkQuery(), client: client, session: session, debounce: false)
        let bookmark = try XCTUnwrap(model.bookmarks.first)
        await model.toggleRead(bookmark, client: client, session: session)
        XCTAssertTrue(model.bookmarks.isEmpty)
        XCTAssertEqual(model.total, 1)
        XCTAssertTrue(model.updatingIDs.isEmpty)
    }

    @MainActor
    func testAllCollectionUpdatesReadStatusWithoutRemovingCard() async throws {
        let client = makeClient()
        _ = try await client.signIn(password: "fixture-password")
        let model = LibraryModel()
        let session = AppSession()
        var query = BookmarkQuery()
        query.reading = .all
        await model.reload(query: query, client: client, session: session, debounce: false)
        await model.toggleRead(try XCTUnwrap(model.bookmarks.first), client: client, session: session)
        XCTAssertEqual(model.bookmarks.count, 1)
        XCTAssertEqual(model.total, 2)
        XCTAssertNotNil(model.bookmarks.first?.readAt)
        await model.toggleRead(try XCTUnwrap(model.bookmarks.first), client: client, session: session)
        XCTAssertNil(model.bookmarks.first?.readAt)
    }

    @MainActor
    func testFailedArchiveLeavesTheBookmarkVisible() async throws {
        let client = makeClient(host: "failure.example")
        _ = try await client.signIn(password: "fixture-password")
        let model = LibraryModel()
        let session = AppSession()
        await model.reload(query: BookmarkQuery(), client: client, session: session, debounce: false)
        await model.toggleRead(try XCTUnwrap(model.bookmarks.first), client: client, session: session)
        XCTAssertEqual(model.bookmarks.count, 1)
        XCTAssertNil(model.bookmarks.first?.readAt)
        XCTAssertEqual(model.actionError, "Could not update bookmark.")
        XCTAssertTrue(model.updatingIDs.isEmpty)
    }

    func testFeedUsesPostPhotoAndDescriptionFallback() throws {
        let json = StubProtocol.page
            .replacingOccurrences(of: "\"source\":\"web\"", with: "\"source\":\"x\"")
            .replacingOccurrences(of: "\"media\":[]", with: "\"media\":[{\"media_key\":\"a\",\"type\":\"photo\",\"local_path\":\"photos/a.jpg\",\"alt_text\":null}]")
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let bookmark = try XCTUnwrap(decoder.decode(BookmarkPage.self, from: Data(json.utf8)).bookmarks.first)
        XCTAssertEqual(bookmark.thumbnailPath, "photos/a.jpg")
        XCTAssertEqual(bookmark.previewDescription, "Read this later")
    }

    func testSidebarFiltersReachTheServerTogetherWithSearchAndPagination() async throws {
        let client = makeClient(host: "filtered.example")
        _ = try await client.signIn(password: "fixture-password")
        var query = BookmarkQuery()
        query.reading = .archive
        query.source = .bookmarks
        query.content = .article
        query.tag = "ios/swift & UI"
        query.author = "alex_chen"
        query.text = "glass + navigation"
        query.mode = .hybrid
        let page = try await client.bookmarks(query: query, cursor: "a+b/c==")
        XCTAssertEqual(page.total, 2)
    }

    func testClearingFiltersPreservesTheSearchAndCollection() {
        var query = BookmarkQuery()
        query.reading = .archive
        query.text = "design"
        query.mode = .semantic
        query.source = .web
        query.content = .photo
        query.author = "alex"
        query.tag = "inspiration"
        XCTAssertTrue(query.hasFilters)
        query.clearFilters()
        XCTAssertFalse(query.hasFilters)
        XCTAssertEqual(query.reading, .archive)
        XCTAssertEqual(query.text, "design")
        XCTAssertEqual(query.mode, .semantic)
        XCTAssertEqual(Set(query.items.map(\.name)), ["q", "mode", "unread", "limit"])
    }

    func testSidebarDecodesTagsCountsAndAuthorsWithMissingNames() async throws {
        let client = makeClient()
        _ = try await client.signIn(password: "fixture-password")
        let options = try await client.filters()
        XCTAssertEqual(options.tags.first?.tag, "swift")
        XCTAssertEqual(options.tags.first?.count, 12)
        XCTAssertEqual(options.authors.first?.username, "alex")
        XCTAssertEqual(options.authors.first?.title, "@alex")
        let legacy = try JSONDecoder().decode(FilterOptions.self, from: Data("{\"tags\":[]}".utf8))
        XCTAssertTrue(legacy.authors.isEmpty)
    }

    private func makeClient(host: String = "fixture.example") -> ArchiveClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return ArchiveClient(baseURL: URL(string: "https://\(host)")!, session: URLSession(configuration: configuration))
    }
}

private final class StubProtocol: URLProtocol, @unchecked Sendable {
    static let page = """
    {"bookmarks":[{"id":"123","text":"A saved article","saved_at":"2026-10-24T12:00:00.000Z","read_at":null,"notes":null,"tags":["swift"],"source":"web","username":null,"author_name":null,"urls":[{"expanded_url":"https://example.org/article","display_url":"example.org"}],"media":[],"link":{"url":"https://example.org/article","kind":"article","title":"A saved article","site_name":"Example","description":"Read this later","og_image_path":"og/123.jpg","has_content":true}}],"nextCursor":"next+page==","total":2}
    """

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() { }

    override func startLoading() {
        var status = 200
        var headers = ["Content-Type": "application/json"]
        let body: String
        if request.httpMethod == "PATCH", request.url?.host == "failure.example" {
            status = 500
            body = "{\"error\":\"Could not update bookmark.\"}"
        } else if request.url?.path == "/api/auth/login", request.httpMethod == "POST" {
            let data: Data
            if let bytes = request.httpBody { data = bytes }
            else if let stream = request.httpBodyStream {
                stream.open()
                var bytes = [UInt8](repeating: 0, count: 1024)
                let count = stream.read(&bytes, maxLength: bytes.count)
                stream.close()
                data = Data(bytes.prefix(max(0, count)))
            } else { data = Data() }
            let payload = try? JSONDecoder().decode([String: String].self, from: data)
            if payload?["password"] == "fixture-password" {
                headers["Set-Cookie"] = "xbm_session=fixture-session; Path=/; HttpOnly; Max-Age=15552000; Secure; SameSite=Lax"
                body = "{\"ok\":true}"
            } else {
                status = 401
                body = "{\"error\":\"Wrong password.\"}"
            }
        } else if request.url?.path == "/api/auth/login" {
            body = "{\"setup\":false,\"authed\":false}"
        } else if request.value(forHTTPHeaderField: "Cookie") == "xbm_session=fixture-session" {
            if ["/api/save-token", "/api/status", "/api/sync"].contains(request.url?.path),
               request.cachePolicy != .reloadIgnoringLocalCacheData {
                status = 400
                body = "{\"error\":\"Expected a fresh response.\"}"
            } else if request.url?.path == "/api/save-token" {
                body = "{\"token\":\"fixture-save-token\"}"
            } else if request.url?.path == "/api/status" {
                body = "{\"last_run_at\":\"2026-10-30T12:00:00.000Z\"}"
            } else if request.url?.path == "/api/sync" {
                if request.httpMethod != "POST" || request.url?.host == "failure.example" {
                    status = 500
                    body = "{\"error\":\"Sync unavailable.\"}"
                } else {
                    body = request.url?.host == "unacknowledged.example" ? "{\"requested\":false}" : "{\"requested\":true}"
                }
            } else if request.url?.path == "/api/filters" {
                body = "{\"tags\":[{\"tag\":\"swift\",\"count\":12}],\"authors\":[{\"username\":\"alex\",\"name\":null,\"count\":4}]}"
            } else if request.url?.host == "filtered.example" {
                let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
                let actual = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
                let expected = ["unread": "false", "source": "bookmarks", "content": "article",
                                "tag": "ios/swift & UI", "author": "alex_chen", "q": "glass + navigation",
                                "mode": "hybrid", "cursor": "a+b/c==", "limit": "100"]
                if actual == expected { body = Self.page }
                else { status = 400; body = "{\"error\":\"Missing or incorrect sidebar filters.\"}" }
            } else { body = Self.page }
        } else {
            status = 401
            body = "{\"error\":\"authentication required\"}"
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}
