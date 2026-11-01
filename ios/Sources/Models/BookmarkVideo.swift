import Foundation

enum BookmarkVideo: Hashable, Identifiable, Sendable {
    case server(path: String, animated: Bool)
    case youtube(id: String)

    var id: String {
        switch self {
        case .server(let path, _): "server:\(path)"
        case .youtube(let id): "youtube:\(id)"
        }
    }

    /// Accept only a relative archive path. Encoded separators and traversal are
    /// rejected before a private session can be attached to a media request.
    static func isSafeMediaPath(_ path: String) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"),
              !path.contains(where: { "%\\:?#".contains($0) || $0.isNewline || $0.asciiValue == 0 }) else { return false }
        return path.split(separator: "/", omittingEmptySubsequences: false)
            .allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    static func youtubeID(from string: String) -> String? {
        guard let url = Bookmark.webURL(string), let host = url.host?.lowercased() else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        let candidate: String?
        if ["youtu.be", "www.youtu.be"].contains(host), parts.count == 1 {
            candidate = parts.first
        } else if ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
                   "youtube-nocookie.com", "www.youtube-nocookie.com"].contains(host) {
            if parts == ["watch"] {
                candidate = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                    .first(where: { $0.name == "v" })?.value
            } else if parts.count == 2, ["embed", "shorts", "live"].contains(parts[0]) {
                candidate = parts[1]
            } else { candidate = nil }
        } else { candidate = nil }
        guard let candidate, candidate.utf8.count == 11,
              candidate.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0)
                  || (48...57).contains($0) || $0 == 45 || $0 == 95 }) else { return nil }
        return candidate
    }
}

extension Bookmark {
    var videos: [BookmarkVideo] {
        var result: [BookmarkVideo] = []
        for item in media where item.type == "video" || item.type == "animated_gif" {
            if let path = item.localPath, BookmarkVideo.isSafeMediaPath(path) {
                let video = BookmarkVideo.server(path: path, animated: item.type == "animated_gif")
                if !result.contains(video) { result.append(video) }
            }
        }
        let links = [link?.url].compactMap { $0 } + (urls ?? []).map(\.expandedUrl)
        for url in links {
            if let id = BookmarkVideo.youtubeID(from: url) {
                let video = BookmarkVideo.youtube(id: id)
                if !result.contains(video) { result.append(video) }
            }
        }
        return result
    }
}
