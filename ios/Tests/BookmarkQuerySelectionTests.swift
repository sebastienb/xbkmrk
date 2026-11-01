import XCTest
@testable import XBkmrk

final class BookmarkQuerySelectionTests: XCTestCase {
    private var filtered: BookmarkQuery {
        var query = BookmarkQuery()
        query.reading = .archive
        query.text = "space"
        query.mode = .hybrid
        query.tag = "science"
        query.source = .web
        query.content = .article
        query.author = "alex"
        query.savedDate = .make(.today)
        return query
    }

    func testClearingOneSelectionKeepsEveryOtherRequestFilter() {
        let keys: [BookmarkFilter: Set<String>] = [
            .category: ["tag"], .source: ["source"], .content: ["content"],
            .author: ["author"], .savedDate: ["saved_from", "saved_before"]
        ]
        for filter in BookmarkFilter.allCases {
            var query = filtered
            let before = Dictionary(uniqueKeysWithValues: query.items.map { ($0.name, $0.value) })
            query.clear(filter)
            let after = Dictionary(uniqueKeysWithValues: query.items.map { ($0.name, $0.value) })
            XCTAssertEqual(after, before.filter { !keys[filter]!.contains($0.key) })
            XCTAssertFalse(query.activeFilters.contains { $0.kind == filter })
        }
    }

    func testClearFiltersKeepsCollectionAndSearchButShowAllRemovesBoth() {
        var query = filtered
        query.clearFilters()
        XCTAssertEqual(query.reading, .archive)
        XCTAssertEqual(query.text, "space")
        XCTAssertEqual(query.mode, .hybrid)
        XCTAssertTrue(query.activeFilters.isEmpty)
        XCTAssertFalse(query.isShowingAll)
        query.showAll()
        XCTAssertTrue(query.isShowingAll)
        XCTAssertEqual(query.items, [URLQueryItem(name: "limit", value: "30")])
        XCTAssertEqual(query.mode, .hybrid)
    }

    func testSummaryIncludesAllAppliedFiltersWithActualDateRange() {
        var query = filtered
        let day = Date(timeIntervalSince1970: 1_793_016_000)
        query.savedDate = .make(.custom, start: day, end: day)
        XCTAssertEqual(query.activeFilters.map(\.kind), BookmarkFilter.allCases)
        XCTAssertEqual(query.activeFilters.first?.value, "#science")
        XCTAssertEqual(query.activeFilters.last?.value, query.savedDate.summary)
        query.reading = .saves
        XCTAssertEqual(query.activeFilters.count, 5)
        query.showAll()
        XCTAssertTrue(query.activeFilters.isEmpty)
    }
}
