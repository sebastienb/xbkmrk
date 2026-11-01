import Foundation
import Observation

@MainActor @Observable
final class ArchiveSyncModel {
    private(set) var requestID = 0
    private(set) var isSyncing = false
    private(set) var status: ArchiveStatus?
    private(set) var message: String?
    private(set) var error: String?

    func start() {
        guard !isSyncing else { return }
        isSyncing = true
        error = nil
        message = "Requesting latest posts…"
        requestID += 1
    }

    func loadStatus(client: any ArchiveSyncClient, session: AppSession) async {
        guard !isSyncing else { return }
        do {
            let loaded = try await client.status()
            try Task.checkCancellation()
            if !isSyncing { status = loaded }
        } catch {
            if !Task.isCancelled { self.error = session.handle(error) }
        }
    }

    /// Returns true only when the server reports a completed sync, not just an accepted request.
    func fetchLatest(client: any ArchiveSyncClient, session: AppSession,
                     pollInterval: Duration = .seconds(3), maxPolls: Int = 40) async -> Bool {
        guard isSyncing else { return false }
        defer { isSyncing = false }
        var accepted = false
        do {
            let previous = try await client.status()
            status = previous
            try Task.checkCancellation()
            try await client.requestSync()
            accepted = true
            message = "Fetching latest posts…"
            // Compare server timestamps with each other; the phone's clock may differ.
            for _ in 0..<maxPolls {
                try await Task.sleep(for: pollInterval)
                let latest = try await client.status()
                try Task.checkCancellation()
                status = latest
                if let completed = latest.lastChecked,
                   previous.lastChecked.map({ completed > $0 }) ?? true {
                    message = "Latest posts checked."
                    return true
                }
            }
            message = "Fetch requested, but the server hasn’t reported completion yet. Pull to refresh later or check the server’s sync settings."
        } catch {
            if Task.isCancelled {
                message = accepted ? "Fetch requested. Pull to refresh to see new posts." : nil
            } else {
                self.error = session.handle(error)
                message = accepted ? "Fetch requested, but its status could not be checked." : nil
            }
        }
        return false
    }
}
