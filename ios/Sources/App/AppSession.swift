import Foundation
import Observation

@MainActor @Observable
final class AppSession {
    var serverAddress: String
    private(set) var client: ArchiveClient?
    private(set) var connectedURL: URL?
    var isConnecting = false
    var isRestoring = true
    var error: String?
    var changeRevision = 0
    let videoThumbnails = VideoThumbnailStore()

    init() {
        serverAddress = UserDefaults.standard.string(forKey: "serverAddress") ?? ""
    }

    func restore() async {
        defer { isRestoring = false }
        guard let saved = SessionVault.load() else { return }
        serverAddress = saved.server.absoluteString
        guard saved.cookie.expires.map({ $0 > Date() }) ?? true else {
            SessionVault.clear()
            return
        }
        // Let the library offer retry while offline; a server 401 returns to sign-in.
        connectedURL = saved.server
        client = ArchiveClient(baseURL: saved.server, cookie: saved.cookie)
    }

    func connect(password: String) async -> Bool {
        isConnecting = true
        error = nil
        defer { isConnecting = false }
        do {
            let url = try ServerAddress.parse(serverAddress)
            let candidate = ArchiveClient(baseURL: url)
            let status = try await candidate.authenticationStatus()
            guard !status.setup else {
                throw ArchiveError.message("This server needs its first-time setup. Open it in Safari to set the site password, then sign in here.")
            }
            let cookie = try await candidate.signIn(password: password)
            try SessionVault.save(SavedSession(server: url, cookie: cookie))
            serverAddress = url.absoluteString
            UserDefaults.standard.set(serverAddress, forKey: "serverAddress")
            connectedURL = url
            videoThumbnails.clear()
            client = candidate
            return true
        } catch {
            if !Task.isCancelled { self.error = Self.message(for: error) }
            return false
        }
    }

    func disconnect() {
        SessionVault.clear()
        videoThumbnails.clear()
        client = nil
        connectedURL = nil
        error = nil
    }

    func handle(_ error: Error) -> String {
        if case ArchiveError.unauthenticated = error {
            disconnect()
            self.error = error.localizedDescription
        }
        return Self.message(for: error)
    }

    static func message(for error: Error) -> String {
        if let error = error as? URLError {
            switch error.code {
            case .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .timedOut:
                return "Can’t reach your server. Check its address, your Wi-Fi or Tailscale connection, and that the server is running."
            case .serverCertificateUntrusted, .serverCertificateHasBadDate, .secureConnectionFailed:
                return "The server’s secure connection could not be verified. Check its HTTPS certificate and the address."
            default: break
            }
        }
        return error.localizedDescription
    }
}
