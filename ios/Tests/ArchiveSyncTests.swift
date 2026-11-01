import XCTest
@testable import XBkmrk

@MainActor
final class ArchiveSyncTests: XCTestCase {
    func testFetchWaitsForANewerServerTimestampAndPreventsDuplicateRequests() async {
        let model = ArchiveSyncModel()
        let client = SyncFixture(timestamps: ["2026-10-30T12:00:00.000Z", "2026-10-30T12:00:00Z", "2026-10-30T12:00:03.000Z"])
        model.start()
        model.start()
        XCTAssertEqual(model.requestID, 1)
        let completed = await model.fetchLatest(client: client, session: AppSession(), pollInterval: .zero, maxPolls: 2)
        XCTAssertTrue(completed)
        XCTAssertFalse(model.isSyncing)
        XCTAssertEqual(model.message, "Latest posts checked.")
        let requests = await client.requests
        XCTAssertEqual(requests, 1)
    }

    func testFirstSyncCompletesFromNullTimestamp() async {
        let model = ArchiveSyncModel()
        let client = SyncFixture(timestamps: [nil, "2026-10-30T12:00:03Z"])
        model.start()
        let completed = await model.fetchLatest(client: client, session: AppSession(), pollInterval: .zero, maxPolls: 1)
        XCTAssertTrue(completed)
    }

    func testUnchangedOrOlderStatusTimesOutWithoutClaimingSuccess() async {
        let model = ArchiveSyncModel()
        let client = SyncFixture(timestamps: ["2026-10-30T12:00:00Z", "2026-10-29T12:00:00Z", "invalid"])
        model.start()
        let completed = await model.fetchLatest(client: client, session: AppSession(), pollInterval: .zero, maxPolls: 2)
        XCTAssertFalse(completed)
        XCTAssertFalse(model.isSyncing)
        XCTAssertTrue(model.message?.contains("hasn’t reported completion") == true)
        model.start()
        XCTAssertEqual(model.requestID, 2)
    }

    func testRejectedRequestShowsAnErrorAndAllowsRetry() async {
        let model = ArchiveSyncModel()
        let client = SyncFixture(timestamps: [nil], rejectRequest: true)
        model.start()
        let completed = await model.fetchLatest(client: client, session: AppSession(), pollInterval: .zero)
        XCTAssertFalse(completed)
        XCTAssertFalse(model.isSyncing)
        XCTAssertEqual(model.error, "Sync unavailable.")
        XCTAssertNil(model.message)
        model.start()
        XCTAssertNil(model.error)
        XCTAssertTrue(model.isSyncing)
    }

    func testCancellationStopsPollingWithoutReportingFailure() async {
        let model = ArchiveSyncModel()
        let client = SyncFixture(timestamps: [nil])
        model.start()
        let task = Task { await model.fetchLatest(client: client, session: AppSession(), pollInterval: .seconds(10)) }
        while await client.requests == 0 { await Task.yield() }
        task.cancel()
        let completed = await task.value
        XCTAssertFalse(completed)
        XCTAssertFalse(model.isSyncing)
        XCTAssertNil(model.error)
        XCTAssertTrue(model.message?.contains("Fetch requested") == true)
    }
}

private actor SyncFixture: ArchiveSyncClient {
    private var timestamps: [String?]
    private let rejectRequest: Bool
    private(set) var requests = 0

    init(timestamps: [String?], rejectRequest: Bool = false) {
        self.timestamps = timestamps
        self.rejectRequest = rejectRequest
    }

    func status() -> ArchiveStatus {
        let timestamp = timestamps.first ?? nil
        if timestamps.count > 1 { timestamps.removeFirst() }
        return ArchiveStatus(lastRunAt: timestamp)
    }

    func requestSync() throws {
        requests += 1
        if rejectRequest { throw ArchiveError.message("Sync unavailable.") }
    }
}
