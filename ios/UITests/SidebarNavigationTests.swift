import XCTest
import UIKit

/// Opt-in UI regression test using only UITestSupport/server.py fixtures.
@MainActor
final class SidebarNavigationTests: XCTestCase {
    func testSidebarShowsSelectionsAndClearsThemIndividuallyOrTogether() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["XBKMRK_UI_FIXTURE"] == "1",
                          "Run against the local fixture with XBKMRK_UI_FIXTURE=1.")
        continueAfterFailure = false
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        if isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        let app = XCUIApplication()
        app.launch()
        connectToFixtureIfNeeded(app)
        let bookmark = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "A different perspective on our planet")).firstMatch
        assertVisible(bookmark)
        revealSidebar(in: app, isPad: isPad)
        scrollSidebar(to: app.buttons["category-inspiration"], in: app, up: true)
        app.buttons["category-inspiration"].tap()
        assertVisible(bookmark)
        revealSidebar(in: app, isPad: isPad)
        scrollSidebar(to: app.staticTexts["activeFilter-category"], in: app, up: false)
        XCTAssertEqual(app.staticTexts["activeFilter-category"].label, "#inspiration")
        XCTAssertTrue((app.buttons["category-inspiration"].value as? String)?.hasPrefix("Selected category") == true)

        // Moving the navigation highlight must not hide the still-active category.
        app.buttons["collection-all"].tap()
        assertVisible(bookmark)
        revealSidebar(in: app, isPad: isPad)
        XCTAssertTrue((app.buttons["category-inspiration"].value as? String)?.hasPrefix("Selected category") == true)
        XCTAssertEqual(app.buttons["collection-all"].value as? String, "Selected collection")
        scrollSidebar(to: app.buttons["sourceFilter"], in: app, up: true)
        app.buttons["sourceFilter"].tap()
        app.buttons["Web"].tap()
        scrollSidebar(to: app.staticTexts["activeFilter-source"], in: app, up: false)
        XCTAssertEqual(app.staticTexts["activeFilter-source"].label, "Web")
        assertVisible(app.staticTexts["activeFilter-category"])
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Visible category and source selections"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        app.buttons["clearSidebarFilter-category"].tap()
        XCTAssertFalse(app.staticTexts["activeFilter-category"].exists)
        assertVisible(app.staticTexts["activeFilter-source"])
        app.buttons["clearSidebarFilters"].tap()
        assertVisible(app.staticTexts["noActiveFilters"])
        XCTAssertFalse(app.staticTexts["activeFilter-source"].exists)

        scrollSidebar(to: app.buttons["savedDatePreset"], in: app, up: true)
        app.buttons["savedDatePreset"].tap()
        app.buttons["Saved today"].tap()
        scrollSidebar(to: app.staticTexts["activeFilter-savedDate"], in: app, up: false)
        XCTAssertEqual(app.staticTexts["activeFilter-savedDate"].label, "Saved today")
        app.buttons["showAllBookmarks"].tap()
        assertVisible(bookmark)
        revealSidebar(in: app, isPad: isPad)
        scrollSidebar(to: app.staticTexts["noActiveFilters"], in: app, up: false)
        XCTAssertFalse(app.staticTexts["activeFilter-savedDate"].exists)
        XCTAssertEqual(app.buttons["collection-all"].value as? String, "Selected collection")
    }

    func testSavingSetupAndManualFetch() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["XBKMRK_UI_FIXTURE"] == "1",
                          "Run against the local fixture with XBKMRK_UI_FIXTURE=1.")
        continueAfterFailure = false
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        if isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        let app = XCUIApplication()
        app.launch()
        connectToFixtureIfNeeded(app)
        // Require fixture content before triggering a server operation.
        let bookmark = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "A different perspective on our planet")).firstMatch
        assertVisible(bookmark)
        app.buttons["fetchLatestPosts"].tap()
        assertVisible(app.staticTexts["Latest posts checked."])
        assertVisible(app.staticTexts["7 bookmarks"])
        revealSidebar(in: app, isPad: isPad)
        scrollSidebar(to: app.buttons["openSettings"], in: app, up: true)
        app.buttons["openSettings"].tap()
        assertVisible(app.buttons["bookmarkletSetup"])
        app.buttons["bookmarkletSetup"].tap()
        assertVisible(app.buttons["copyBookmarklet"])
        app.buttons["copyBookmarklet"].tap()
        XCTAssertEqual(app.buttons["copyBookmarklet"].label, "Copied")
        let bookmarklet = XCTAttachment(screenshot: app.screenshot())
        bookmarklet.name = "Bookmarklet setup"
        bookmarklet.lifetime = .keepAlways
        add(bookmarklet)
        app.buttons["BackButton"].firstMatch.tap()
        app.buttons["shortcutSetup"].tap()
        assertVisible(app.buttons["copyShortcutPrompt"])
        app.buttons["copyShortcutPrompt"].tap()
        XCTAssertEqual(app.buttons["copyShortcutPrompt"].label, "Copied")
        assertVisible(app.buttons["copySaveURL"])
        app.buttons["copySaveURL"].tap()
        XCTAssertEqual(app.buttons["copySaveURL"].label, "Copied")
        let shortcut = XCTAttachment(screenshot: app.screenshot())
        shortcut.name = "Shortcut setup"
        shortcut.lifetime = .keepAlways
        add(shortcut)
    }

    func testNativeSidebarCollectionsCategoriesAndSettings() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["XBKMRK_UI_FIXTURE"] == "1",
                          "Run against the local fixture with XBKMRK_UI_FIXTURE=1.")
        continueAfterFailure = false
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        if isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        let app = XCUIApplication()
        app.launch()
        connectToFixtureIfNeeded(app)
        let bookmark = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "A different perspective on our planet")).firstMatch
        assertVisible(bookmark)

        revealSidebar(in: app, isPad: isPad)
        assertVisible(app.buttons["collection-saves"])
        app.buttons["collection-archive"].tap()
        assertVisible(app.staticTexts["Your archive"])
        revealSidebar(in: app, isPad: isPad)
        app.buttons["collection-saves"].tap()
        assertVisible(bookmark)

        bookmark.tap()
        assertVisible(app.buttons["shareBookmark"])
        if isPad {
            app.buttons["BackButton"].firstMatch.tap()
        } else {
            swipeBack(in: app)
        }
        assertVisible(bookmark)
        revealSidebar(in: app, isPad: isPad)
        if app.buttons["expandCategories"].exists { app.buttons["expandCategories"].tap() }
        scrollSidebar(to: app.buttons["category-space"], in: app, up: true)
        app.buttons["category-space"].tap()
        assertVisible(bookmark)
        assertVisible(app.staticTexts["#space"])
        revealSidebar(in: app, isPad: isPad)
        app.buttons["allCategories"].tap()
        assertVisible(bookmark)

        if isPad {
            scrollSidebar(to: app.buttons["savedDatePreset"], in: app, up: true)
            app.buttons["savedDatePreset"].tap()
            app.buttons["Saved today"].tap()
            assertVisible(app.staticTexts["Nothing here yet"])
            app.buttons["savedDatePreset"].tap()
            app.buttons["Date range…"].tap()
            assertVisible(app.descendants(matching: .any)["savedDateFrom"].firstMatch)
            assertVisible(app.descendants(matching: .any)["savedDateThrough"].firstMatch)
            app.buttons["applySavedDates"].tap()
            assertVisible(app.staticTexts["Nothing here yet"])
            app.buttons["savedDatePreset"].tap()
            app.buttons["All dates"].tap()
            assertVisible(bookmark)
        }

        revealSidebar(in: app, isPad: isPad)
        scrollSidebar(to: app.buttons["openSettings"], in: app, up: true)
        app.buttons["openSettings"].tap()
        assertVisible(app.buttons["serverSettings"])
        app.buttons["serverSettings"].tap()
        assertVisible(app.staticTexts["Connected server"])
        app.buttons["BackButton"].firstMatch.tap()
        assertVisible(app.buttons["serverSettings"])
        revealSidebar(in: app, isPad: isPad)
        scrollSidebar(to: app.buttons["collection-all"], in: app, up: false)
        app.buttons["collection-all"].tap()
        assertVisible(bookmark)
        if isPad {
            assertVisible(app.buttons["collection-saves"])
        } else {
            revealSidebar(in: app, isPad: false)
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = isPad ? "Standard iPad sidebar and feed" : "Standard iPhone sidebar"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func connectToFixtureIfNeeded(_ app: XCUIApplication) {
        let address = app.textFields["serverAddress"]
        guard address.waitForExistence(timeout: 3) else { return }
        address.tap()
        let existing = address.value as? String ?? ""
        address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
        address.typeText("http://127.0.0.1:18769")
        let password = app.secureTextFields["sitePassword"]
        password.tap()
        password.typeText("fixture-password\n")
    }

    private func revealSidebar(in app: XCUIApplication, isPad: Bool) {
        if !isPad { swipeBack(in: app) }
    }

    private func scrollSidebar(to element: XCUIElement, in app: XCUIApplication, up: Bool) {
        for _ in 0..<6 {
            if element.exists && element.isHittable { return }
            if up { app.collectionViews.firstMatch.swipeUp() }
            else { app.collectionViews.firstMatch.swipeDown() }
        }
        assertVisible(element)
    }

    private func swipeBack(in app: XCUIApplication) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.45))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.45))
        start.press(forDuration: 0.1, thenDragTo: end)
    }

    private func assertVisible(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let visible = NSPredicate(format: "exists == true AND hittable == true")
        let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: visible, object: element)], timeout: 15)
        XCTAssertEqual(result, .completed, "Expected visible element: \(element)", file: file, line: line)
    }
}
