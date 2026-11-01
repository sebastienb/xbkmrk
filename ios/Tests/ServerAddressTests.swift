import XCTest
@testable import XBkmrk

final class ServerAddressTests: XCTestCase {
    func testNormalizesAddressAndPreservesProxyPath() throws {
        let url = try ServerAddress.parse("  HTTPS://Bookmarks.Example.com:3443/archive/  ")
        XCTAssertEqual(url.absoluteString, "https://bookmarks.example.com:3443/archive")
        XCTAssertEqual(url.appending(path: "api/bookmarks").path, "/archive/api/bookmarks")
    }

    func testDefaultsToHTTPS() throws {
        XCTAssertEqual(try ServerAddress.parse("bookmarks.example.com").scheme, "https")
    }

    func testAllowsExplicitLANHTTP() throws {
        XCTAssertEqual(try ServerAddress.parse("http://192.168.1.10:3020").port, 3020)
    }

    func testRejectsCredentialsUnsupportedSchemesAndQueries() {
        for input in ["", "https://", "file:///etc/passwd", "ftp://example.com", "https://user:secret@example.com", "https://example.com?token=secret", "https://example.com/#login", "not a host"] {
            XCTAssertThrowsError(try ServerAddress.parse(input), input)
        }
    }

    func testSearchAndCursorCanBeEncodedWithoutChangingQuery() throws {
        var query = BookmarkQuery()
        query.text = "swift & glass + accessibility"
        query.tag = "ios/swift"
        query.reading = .all
        query.mode = .hybrid
        var url = URLComponents(string: "https://example.com/api/bookmarks")!
        url.queryItems = query.items + [URLQueryItem(name: "cursor", value: "a+b/c==")]
        let decoded = try XCTUnwrap(URLComponents(url: XCTUnwrap(url.url), resolvingAgainstBaseURL: false))
        XCTAssertEqual(decoded.queryItems?.first(where: { $0.name == "q" })?.value, query.text)
        XCTAssertEqual(decoded.queryItems?.first(where: { $0.name == "cursor" })?.value, "a+b/c==")
        XCTAssertFalse(query.items.contains(where: { $0.name == "unread" }))
    }
}
