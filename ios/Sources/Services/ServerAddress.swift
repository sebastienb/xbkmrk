import Foundation

enum ServerAddress {
    static func parse(_ input: String) throws -> URL {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains(where: \.isWhitespace) else {
            throw ArchiveError.message("Enter the address of your xbkmrk server.")
        }
        let candidate = value.contains("://") ? value : "https://\(value)"
        guard var parts = URLComponents(string: candidate),
              let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.port.map({ (1...65535).contains($0) }) ?? true else {
            throw ArchiveError.message("Use a server address such as https://bookmarks.example.com or http://bookmarks.local:3020, without a query or login credentials.")
        }
        parts.scheme = scheme
        parts.host = host.lowercased()
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        guard let url = parts.url else { throw ArchiveError.message("This server address is invalid.") }
        return url
    }
}

enum ArchiveError: LocalizedError {
    case unauthenticated
    case message(String)

    var errorDescription: String? {
        switch self {
        case .unauthenticated: "Your session has expired. Sign in to your server again."
        case .message(let message): message
        }
    }
}
