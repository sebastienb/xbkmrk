import XCTest
@testable import XBkmrk

final class AppAppearanceTests: XCTestCase {
    @MainActor
    func testAppearanceSurvivesARecreatedAppState() throws {
        let suite = "xbkmrk-appearance-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let appearance = AppAppearance(defaults: defaults)
        appearance.theme = .dark
        appearance.feedImageSize = .hidden
        appearance.feedShowsDescriptions = false
        appearance.feedShowsTags = false
        appearance.detailTextFont = .serif
        appearance.detailShowsImages = false
        appearance.detailShowsNotes = false
        appearance.detailShowsTags = false
        appearance.sidebarShowsCounts = false
        appearance.sidebarCategoryOrder = .alphabetical
        appearance.sidebarCategoryLimit = .all

        let restored = AppAppearance(defaults: defaults)
        XCTAssertEqual(restored.theme, .dark)
        XCTAssertEqual(restored.feedImageSize, .hidden)
        XCTAssertFalse(restored.feedShowsDescriptions)
        XCTAssertFalse(restored.feedShowsTags)
        XCTAssertEqual(restored.detailTextFont, .serif)
        XCTAssertFalse(restored.detailShowsImages)
        XCTAssertFalse(restored.detailShowsNotes)
        XCTAssertFalse(restored.detailShowsTags)
        XCTAssertFalse(restored.sidebarShowsCounts)
        XCTAssertEqual(restored.sidebarCategoryOrder, .alphabetical)
        XCTAssertEqual(restored.sidebarCategoryLimit, .all)
    }

    @MainActor
    func testResetRestoresAppearanceWithoutChangingServerPreferences() throws {
        let suite = "xbkmrk-appearance-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("https://example.org/archive", forKey: "serverAddress")
        let appearance = AppAppearance(defaults: defaults)
        appearance.theme = .light
        appearance.feedImageSize = .compact
        appearance.feedShowsTags = false
        appearance.detailShowsNotes = false
        appearance.sidebarShowsCounts = false
        appearance.reset()
        let restored = AppAppearance(defaults: defaults)
        XCTAssertEqual(restored.theme, .system)
        XCTAssertEqual(restored.feedImageSize, .large)
        XCTAssertTrue(restored.feedShowsTags)
        XCTAssertTrue(restored.detailShowsNotes)
        XCTAssertTrue(restored.sidebarShowsCounts)
        XCTAssertEqual(defaults.string(forKey: "serverAddress"), "https://example.org/archive")
    }

    @MainActor
    func testUnknownSavedOptionsFallBackWithoutOverridingExplicitFalse() throws {
        let suite = "xbkmrk-appearance-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("future-theme", forKey: "appearance.theme")
        defaults.set("future-size", forKey: "appearance.feedImageSize")
        defaults.set(-1, forKey: "appearance.sidebarCategoryLimit")
        defaults.set(false, forKey: "appearance.detailShowsImages")
        let appearance = AppAppearance(defaults: defaults)
        XCTAssertEqual(appearance.theme, .system)
        XCTAssertEqual(appearance.feedImageSize, .large)
        XCTAssertEqual(appearance.sidebarCategoryLimit, .four)
        XCTAssertFalse(appearance.detailShowsImages)
        XCTAssertTrue(appearance.feedShowsDescriptions)
    }

    func testSidebarOrdersCategoriesByCountOrName() {
        let tags = [FilterOptions.Tag(tag: "swift", count: 5),
                    FilterOptions.Tag(tag: "design", count: 5),
                    FilterOptions.Tag(tag: "architecture", count: 1)]
        XCTAssertEqual(CategoryOrder.mostUsed.sorted(tags).map(\.tag), ["design", "swift", "architecture"])
        XCTAssertEqual(CategoryOrder.alphabetical.sorted(tags).map(\.tag), ["architecture", "design", "swift"])
    }
}
