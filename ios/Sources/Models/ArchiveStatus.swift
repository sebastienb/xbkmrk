import Foundation

struct ArchiveStatus: Decodable, Sendable {
    let lastRunAt: String?

    var lastChecked: Date? {
        guard let lastRunAt else { return nil }
        return (try? Date(lastRunAt, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)))
            ?? (try? Date(lastRunAt, strategy: .iso8601))
    }
}

protocol ArchiveSyncClient: Sendable {
    func status() async throws -> ArchiveStatus
    func requestSync() async throws
}
