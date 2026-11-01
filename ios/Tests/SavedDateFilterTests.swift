import Foundation
import XCTest
@testable import XBkmrk

final class SavedDateFilterTests: XCTestCase {
    private let zone = TimeZone(identifier: "America/New_York")!
    private func date(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }

    func testRelativePresetsUseMondayAndLocalMidnight() {
        let now = date("2026-10-26T15:00:00Z")
        let cases: [(SavedDateFilter.Preset, String, String)] = [
            (.today, "2026-10-26T04:00:00Z", "2026-10-27T04:00:00Z"),
            (.yesterday, "2026-10-25T04:00:00Z", "2026-10-26T04:00:00Z"),
            (.thisWeek, "2026-10-26T04:00:00Z", "2026-11-02T05:00:00Z"),
            (.lastWeek, "2026-10-19T04:00:00Z", "2026-10-26T04:00:00Z")
        ]
        for (preset, from, before) in cases {
            let filter = SavedDateFilter.make(preset, now: now, timeZone: zone)
            XCTAssertEqual(filter.from, date(from))
            XCTAssertEqual(filter.before, date(before))
        }
    }

    func testCustomRangeIncludesEntireDSTDays() {
        for (day, hours) in [("2026-03-08T12:00:00Z", 23.0), ("2026-11-01T12:00:00Z", 25.0)] {
            let filter = SavedDateFilter.make(.custom, start: date(day), end: date(day), timeZone: zone)
            XCTAssertEqual(filter.before!.timeIntervalSince(filter.from!), hours * 3600)
        }
    }

    func testSundayAndYearBoundaryBelongToPreviousMonday() {
        let filter = SavedDateFilter.make(.thisWeek, now: date("2027-01-03T15:00:00Z"), timeZone: zone)
        XCTAssertEqual(filter.from, date("2026-12-28T05:00:00Z"))
        XCTAssertEqual(filter.before, date("2027-01-04T05:00:00Z"))
    }

    func testDatesCombineWithSearchAndOtherFiltersAndClearTogether() {
        var query = BookmarkQuery()
        query.text = "space"
        query.tag = "science"
        query.savedDate = .make(.today, now: date("2026-10-26T15:00:00Z"), timeZone: zone)
        let items = Dictionary(uniqueKeysWithValues: query.items.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(items["saved_from"], "2026-10-26T04:00:00Z")
        XCTAssertEqual(items["saved_before"], "2026-10-27T04:00:00Z")
        XCTAssertEqual(items["q"], "space")
        XCTAssertEqual(items["tag"], "science")
        XCTAssertTrue(query.hasFilters)
        query.clearFilters()
        XCTAssertFalse(query.hasFilters)
        XCTAssertEqual(query.text, "space")
        XCTAssertFalse(query.items.contains { $0.name == "saved_from" || $0.name == "saved_before" })
    }
}
