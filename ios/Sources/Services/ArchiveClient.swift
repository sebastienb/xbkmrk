import Foundation

struct SessionCookie: Codable, Sendable {
    let value: String
    let expires: Date?
}

struct AuthenticationStatus: Decodable, Sendable {
    let setup: Bool
    let authed: Bool
}

/// Refuse redirects so an entered server cannot forward a password or session to another host.
private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor ArchiveClient: ArchiveSyncClient {
    let baseURL: URL
    nonisolated let mediaCacheID = UUID()
    private var cookie: SessionCookie?
    private let session: URLSession
    private let decoder: JSONDecoder

    init(baseURL: URL, cookie: SessionCookie? = nil, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.cookie = cookie
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        // Reuse thumbnails while scrolling without writing private images to disk.
        configuration.urlCache = URLCache(memoryCapacity: 32 * 1024 * 1024, diskCapacity: 0)
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 45
        self.session = session ?? URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    func authenticationStatus() async throws -> AuthenticationStatus {
        try await get("api/auth/login")
    }

    func signIn(password: String) async throws -> SessionCookie {
        let body = try JSONEncoder().encode(["password": password])
        let (_, response) = try await request("api/auth/login", method: "POST", body: body)
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, pair in
            if let key = pair.key as? String, let value = pair.value as? String { result[key] = value }
        }
        guard let value = HTTPCookie.cookies(withResponseHeaderFields: headers, for: baseURL)
            .first(where: { $0.name == "xbm_session" }), !value.value.isEmpty else {
            throw ArchiveError.message("The server did not return a login session. Check the server URL and reverse proxy configuration.")
        }
        let saved = SessionCookie(value: value.value, expires: value.expiresDate)
        cookie = saved
        return saved
    }

    func bookmarks(query: BookmarkQuery, cursor: String? = nil) async throws -> BookmarkPage {
        var items = query.items
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        let page: BookmarkPage = try await get("api/bookmarks", query: items)
        if query.savedDate.preset != .all && page.savedDateFilterApplied != true {
            throw ArchiveError.message("Update your xbkmrk server to use saved-date filters. Your server does not support them yet.")
        }
        return page
    }

    func bookmark(id: String) async throws -> Bookmark {
        try await get("api/bookmarks/\(id)")
    }

    func filters() async throws -> FilterOptions { try await get("api/filters") }

    func saveInstructions() async throws -> SaveInstructions {
        struct SaveToken: Decodable, Sendable { let token: String }
        let response: SaveToken = try await get("api/save-token")
        return try SaveInstructions(server: baseURL, token: response.token)
    }

    func status() async throws -> ArchiveStatus { try await get("api/status") }

    func requestSync() async throws {
        struct SyncResponse: Decodable { let requested: Bool }
        let (data, _) = try await request("api/sync", method: "POST")
        guard (try? decoder.decode(SyncResponse.self, from: data))?.requested == true else {
            throw ArchiveError.message("The server did not accept the fetch request. Try again.")
        }
    }

    func setRead(_ read: Bool, id: String) async throws {
        _ = try await request("api/bookmarks/\(id)", method: "PATCH", body: JSONEncoder().encode(["read": read]))
    }

    func image(path: String) async throws -> Data {
        let components = path.split(separator: "/")
        guard !path.contains("://"), !components.contains(".."), !path.hasPrefix("/") else {
            throw ArchiveError.message("Invalid image path.")
        }
        return try await request("api/media/\(path)").0
    }

    /// Constructs a request only. Video bytes go straight to the player through
    /// a separate, uncached streaming session, never through data(for:).
    func videoRequest(path: String) throws -> URLRequest {
        guard BookmarkVideo.isSafeMediaPath(path) else {
            throw ArchiveError.message("Invalid video path.")
        }
        guard let cookie else { throw ArchiveError.unauthenticated }
        var request = URLRequest(url: baseURL.appending(path: "api/media/\(path)"),
                                 cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("xbm_session=\(cookie.value)", forHTTPHeaderField: "Cookie")
        request.setValue("video/mp4", forHTTPHeaderField: "Accept")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        return request
    }

    private func get<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let (data, _) = try await request(path, query: query)
        do { return try decoder.decode(T.self, from: data) }
        catch { throw ArchiveError.message("The server returned an unexpected response. Check that this is an xbkmrk server and that it is up to date.") }
    }

    private func request(_ path: String, query: [URLQueryItem] = [], method: String = "GET", body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw ArchiveError.message("Could not form a server request.") }
        var request = URLRequest(url: url, cachePolicy: path.hasPrefix("api/media/") ? .useProtocolCachePolicy : .reloadIgnoringLocalCacheData)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let cookie { request.setValue("xbm_session=\(cookie.value)", forHTTPHeaderField: "Cookie") }
        let (data, rawResponse) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let response = rawResponse as? HTTPURLResponse else {
            throw ArchiveError.message("The server returned an invalid response.")
        }
        if response.statusCode == 401, path != "api/auth/login" { throw ArchiveError.unauthenticated }
        guard (200..<300).contains(response.statusCode) else {
            if (300..<400).contains(response.statusCode) {
                throw ArchiveError.message("This address redirects elsewhere. Enter the final HTTPS address shown in your browser.")
            }
            struct ServerError: Decodable { let error: String }
            let message = (try? decoder.decode(ServerError.self, from: data))?.error
            throw ArchiveError.message(message ?? "The server returned an error (\(response.statusCode)). Try again shortly.")
        }
        return (data, response)
    }
}
