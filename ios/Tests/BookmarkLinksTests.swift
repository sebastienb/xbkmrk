import XCTest
@testable import XBkmrk

final class BookmarkLinksTests: XCTestCase {
    func testArticleLinkIsAvailableEvenWithoutSavedContent() throws {
        let bookmark = try decode(["link": link(), "urls": [["expanded_url": "https://example.org/article"]]])
        XCTAssertEqual(bookmark.linkedPages.map(\.url.absoluteString), ["https://example.org/article"])
        XCTAssertEqual(bookmark.linkedPages.first?.title, "An article worth reading")
        XCTAssertEqual(bookmark.originalURL?.absoluteString, "https://x.com/i/status/123")
        XCTAssertEqual(bookmark.readerURL?.absoluteString, "https://example.org/article")
    }

    func testAllLinksAreKeptExceptDuplicatesUnsafeURLsAndThePostItself() throws {
        let bookmark = try decode(["text": "Read https://t.co/abc and https://example.net/other", "urls": [
            ["expanded_url": "https://example.org/article", "url": "https://t.co/abc"],
            ["expanded_url": "https://example.org/article"],
            ["expanded_url": "https://twitter.com/author/status/123"],
            ["expanded_url": "https://x.com/another/status/456"],
            ["expanded_url": "javascript:alert(1)"],
            ["expanded_url": "https://user:password@example.com"]
        ]])
        XCTAssertEqual(bookmark.linkedPages.map(\.url.absoluteString), [
            "https://example.org/article", "https://x.com/another/status/456", "https://example.net/other"
        ])
    }

    func testWebSavedXPostKeepsThePostForSharingAndTheArticleForReading() throws {
        let bookmark = try decode(["source": "web", "link": link(), "urls": [
            ["expanded_url": "https://x.com/author/status/789"], ["expanded_url": "https://example.org/article"]
        ]])
        XCTAssertEqual(bookmark.originalURL?.absoluteString, "https://x.com/author/status/789")
        XCTAssertEqual(bookmark.linkedPages.count, 1)
        XCTAssertEqual(bookmark.readerURL?.absoluteString, "https://example.org/article")
    }

    func testLongPostLinkificationPreservesEveryCharacterAndUnicode() {
        let text = "🧑🏽‍🚀 A long post <not HTML> & [not Markdown]\n\n" + String(repeating: "Complete paragraph.\n", count: 100)
            + "Read https://t.co/abc — END OF FULL POST"
        let attributed = LinkedPostText.attributed(text, urls: [BookmarkURL(expandedUrl: "https://example.org/article", displayUrl: nil, url: "https://t.co/abc")])
        XCTAssertEqual(String(attributed.characters), text)
        XCTAssertEqual(attributed.runs.compactMap(\.link).map(\.absoluteString), ["https://example.org/article"])
    }

    func testPlainTextReadersAndTruncationAreExplicit() throws {
        for kind in ["x_article", "x_post", "video"] {
            let bookmark = try decode(["link": link(kind: kind), "text_truncated": true])
            XCTAssertEqual(bookmark.readerFormat, .plainText)
            XCTAssertEqual(bookmark.textTruncated, true)
        }
        XCTAssertEqual(try decode(["link": link(kind: "github")]).readerFormat, .markdown)
        XCTAssertEqual(try decode(["link": link()]).readerFormat, .html)
        XCTAssertNil(try decode([:]).textTruncated)
    }

    private func link(kind: String = "article") -> [String: Any] {
        ["url": "https://example.org/article", "kind": kind, "title": "An article worth reading", "has_content": false]
    }

    private func decode(_ changes: [String: Any]) throws -> Bookmark {
        var json: [String: Any] = ["id": "123", "text": "A saved post", "saved_at": "2026-10-30T12:00:00Z",
                                   "tags": [], "source": "x", "media": []]
        json.merge(changes) { _, value in value }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(Bookmark.self, from: JSONSerialization.data(withJSONObject: json))
    }
}
