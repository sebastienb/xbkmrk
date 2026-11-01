import Foundation

struct BookmarkLink: Identifiable, Hashable {
    let url: URL
    let title: String
    var id: String { url.absoluteString }
    var host: String { url.host()?.replacingOccurrences(of: "www.", with: "") ?? url.absoluteString }
}

extension Bookmark {
    var savedXPostURL: URL? {
        guard source == "web", let first = urls?.first,
              let url = Self.webURL(first.expandedUrl), Self.xPostID(url) != nil else { return nil }
        return url
    }

    var linkedPages: [BookmarkLink] {
        let originalPostID = originalURL.flatMap(Self.xPostID)
        var seen = Set<String>()
        var pages: [BookmarkLink] = []
        func add(_ value: String?, title: String?) {
            guard let url = Self.webURL(value),
                  originalPostID == nil || Self.xPostID(url) != originalPostID,
                  seen.insert(url.absoluteString).inserted else { return }
            pages.append(BookmarkLink(url: url, title: title.flatMap { $0.isEmpty ? nil : $0 } ?? url.absoluteString))
        }
        add(link?.url, title: link?.title)
        for saved in urls ?? [] { add(saved.expandedUrl, title: nil) }
        // Older servers may keep a link only in the text. Keep those reachable too.
        for url in Self.detectedURLs(in: text) {
            let expanded = urls?.first(where: { $0.url == url.absoluteString })?.expandedUrl
            add(expanded ?? url.absoluteString, title: nil)
        }
        return pages
    }

    var readerURL: URL? { Self.webURL(link?.url) ?? originalURL }

    var readerFormat: ReaderContentFormat {
        switch link?.kind {
        case "github": .markdown
        case "x_article", "x_post", "video": .plainText
        default: .html
        }
    }

    static func xPostID(_ url: URL) -> String? {
        guard ["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].contains(url.host()?.lowercased() ?? "") else { return nil }
        let path = url.pathComponents
        guard path.count >= 4, ["status", "statuses"].contains(path[2]),
              !path[3].isEmpty, path[3].allSatisfy(\.isNumber) else { return nil }
        return path[3]
    }

    static func detectedURLs(in text: String) -> [URL] {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return [] }
        return detector.matches(in: text, range: NSRange(text.startIndex..., in: text))
            .compactMap { Self.webURL($0.url?.absoluteString) }
    }
}

enum ReaderContentFormat { case html, markdown, plainText }

/// Detect links without interpreting user-authored post text as Markdown or HTML.
enum LinkedPostText {
    static func attributed(_ text: String, urls: [BookmarkURL] = []) -> AttributedString {
        var result = AttributedString(text)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return result }
        for match in detector.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let range = Range(match.range, in: text),
                  let start = AttributedString.Index(range.lowerBound, within: result),
                  let end = AttributedString.Index(range.upperBound, within: result),
                  let detected = Bookmark.webURL(match.url?.absoluteString) else { continue }
            let expanded = urls.first(where: { $0.url == detected.absoluteString })
                .flatMap { Bookmark.webURL($0.expandedUrl) }
            result[start..<end].link = expanded ?? detected
        }
        return result
    }
}
