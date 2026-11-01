import Foundation

struct Bookmark: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var text: String
    let savedAt: String
    var readAt: String?
    var notes: String?
    var tags: [String]
    let source: String
    let username: String?
    let authorName: String?
    let urls: [BookmarkURL]?
    let media: [MediaItem]
    let link: LinkInfo?
    var content: String?
    var textTruncated: Bool?

    var title: String {
        if let title = link?.title, !title.isEmpty { return title }
        return text.split(separator: "\n").first.map(String.init) ?? "Untitled bookmark"
    }

    var attribution: String {
        authorName ?? username.map { "@\($0)" } ?? link?.siteName ?? originalURL?.host() ?? sourceLabel
    }

    var bodyText: String {
        let firstLine = text.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init)
        guard firstLine == title else { return text }
        return String(text.dropFirst(title.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var sourceLabel: String {
        switch source {
        case "x": "X"
        case "youtube": "YouTube"
        default: "Web"
        }
    }

    var symbol: String {
        switch link?.kind {
        case "github": "chevron.left.forwardslash.chevron.right"
        case "video": "play.rectangle"
        default: source == "x" ? "text.bubble" : "doc.text"
        }
    }

    /// Share public source URLs, never the private server's authenticated reader URL.
    var originalURL: URL? {
        if source == "x" { return URL(string: "https://x.com/i/status/\(id)") }
        if let savedXPostURL { return savedXPostURL }
        if let url = Self.webURL(link?.url) { return url }
        return urls?.compactMap { Self.webURL($0.expandedUrl) }.first
    }

    var thumbnailPath: String? {
        let photo = media.first(where: { $0.type == "photo" && !($0.localPath?.isEmpty ?? true) })?.localPath
        let cover = link?.ogImagePath.flatMap { $0.isEmpty ? nil : $0 }
        return source == "x" ? (photo ?? cover) : (cover ?? photo)
    }

    var previewDescription: String? {
        if let description = link?.description?.trimmingCharacters(in: .whitespacesAndNewlines),
           !description.isEmpty, description != title {
            return description
        }
        return bodyText.isEmpty ? nil : bodyText
    }

    var savedDate: Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: savedAt) ?? ISO8601DateFormatter().date(from: savedAt)
    }

    static func webURL(_ string: String?) -> URL? {
        guard let string, let url = URL(string: string),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }
}

struct BookmarkURL: Codable, Hashable, Sendable {
    let expandedUrl: String
    let displayUrl: String?
    let url: String?
}

struct MediaItem: Codable, Hashable, Sendable {
    let mediaKey: String
    let type: String?
    let localPath: String?
    let altText: String?
}

struct LinkInfo: Codable, Hashable, Sendable {
    let url: String
    let kind: String
    let title: String?
    let siteName: String?
    let description: String?
    let ogImagePath: String?
    let hasContent: Bool
}

struct BookmarkPage: Decodable, Sendable {
    let savedDateFilterApplied: Bool?
    let bookmarks: [Bookmark]
    let nextCursor: String?
    let total: Int
    let mode: String?
}

struct FilterOptions: Decodable, Sendable {
    struct Tag: Decodable, Identifiable, Sendable {
        let tag: String
        let count: Int
        var id: String { tag }
    }
    struct Author: Decodable, Identifiable, Sendable {
        let username: String
        let name: String?
        let count: Int
        var id: String { username }
        var title: String { name.flatMap { $0.isEmpty ? nil : $0 } ?? "@\(username)" }
    }
    let tags: [Tag]
    let authors: [Author]

    private enum CodingKeys: CodingKey { case tags, authors }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tags = try container.decode([Tag].self, forKey: .tags)
        authors = try container.decodeIfPresent([Author].self, forKey: .authors) ?? []
    }
}

enum ReadingFilter: String, CaseIterable, Identifiable, Sendable {
    case saves = "Saves", archive = "Archive", all = "All"
    var id: Self { self }
    var symbol: String {
        switch self {
        case .saves: "bookmark"
        case .archive: "archivebox"
        case .all: "square.stack"
        }
    }
    var unread: String? {
        switch self {
        case .saves: "true"
        case .archive: "false"
        case .all: nil
        }
    }
}

enum SearchMode: String, CaseIterable, Identifiable, Sendable {
    case keyword, hybrid, semantic
    var id: Self { self }
    var title: String { rawValue.capitalized }
}

enum ContentFilter: String, CaseIterable, Identifiable, Sendable {
    case all = "", article, video, photo, github, link, text
    var id: Self { self }
    var title: String {
        switch self {
        case .all: "All types"
        case .article: "Articles"
        case .video: "Videos"
        case .photo: "Photos"
        case .github: "GitHub"
        case .link: "Links"
        case .text: "Text only"
        }
    }
}

enum SourceFilter: String, CaseIterable, Identifiable, Sendable {
    case all = "", bookmarks, likes, web, youtube
    var id: Self { self }
    var title: String {
        switch self {
        case .all: "All sources"
        case .bookmarks: "X bookmarks"
        case .likes: "X likes"
        case .web: "Web"
        case .youtube: "YouTube"
        }
    }
}

struct BookmarkQuery: Equatable, Sendable {
    var text = ""
    var reading: ReadingFilter = .saves
    var source: SourceFilter = .all
    var tag = ""
    var content: ContentFilter = .all
    var author = ""
    var mode: SearchMode = .keyword
    var savedDate = SavedDateFilter()

    var hasFilters: Bool { source != .all || !tag.isEmpty || content != .all || !author.isEmpty || savedDate.preset != .all }

    mutating func clearFilters() {
        source = .all
        tag = ""
        content = .all
        author = ""
        savedDate = SavedDateFilter()
    }

    var items: [URLQueryItem] {
        var items = [URLQueryItem(name: "limit", value: text.isEmpty ? "30" : "100")]
        items.append(contentsOf: savedDate.items)
        if let unread = reading.unread { items.append(URLQueryItem(name: "unread", value: unread)) }
        if source != .all { items.append(URLQueryItem(name: "source", value: source.rawValue)) }
        if !tag.isEmpty { items.append(URLQueryItem(name: "tag", value: tag)) }
        if content != .all { items.append(URLQueryItem(name: "content", value: content.rawValue)) }
        if !author.isEmpty { items.append(URLQueryItem(name: "author", value: author)) }
        if !text.isEmpty {
            items.append(URLQueryItem(name: "q", value: text))
            items.append(URLQueryItem(name: "mode", value: mode.rawValue))
        }
        return items
    }
}
