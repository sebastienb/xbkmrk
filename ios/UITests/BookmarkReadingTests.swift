import XCTest

@MainActor
final class BookmarkReadingTests: XCTestCase {
    func testLongPostLinksAndPlainTextArticleReader() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["XBKMRK_LINK_FIXTURE"] == "1",
                          "Run only with the local long-post fixture enabled.")
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Long post with an article link")).firstMatch
        for _ in 0..<14 {
            if card.exists && card.isHittable { break }
            let more = app.buttons["Load more bookmarks"]
            if more.exists && more.isHittable { more.tap() }
            else { app.scrollViews.firstMatch.swipeUp() }
        }
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        card.tap()
        let body = app.staticTexts["fullPostText"]
        XCTAssertTrue(body.waitForExistence(timeout: 10))
        XCTAssertTrue(body.label.contains("END OF FULL POST"))
        let articleLink = app.links["linkedPage-https://example.org/article"]
        let linkButton = app.buttons["linkedPage-https://example.org/article"]
        for _ in 0..<10 {
            if articleLink.isHittable || linkButton.isHittable { break }
            app.scrollViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(articleLink.isHittable || linkButton.isHittable)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Full post and its article link"
        shot.lifetime = .keepAlways
        add(shot)
        app.buttons["BackButton"].firstMatch.tap()
        let savedArticle = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Plain text X article")).firstMatch
        for _ in 0..<8 {
            if savedArticle.exists && savedArticle.isHittable { break }
            let more = app.buttons["Load more bookmarks"]
            if more.exists && more.isHittable { more.tap() }
            else { app.scrollViews.firstMatch.swipeUp() }
        }
        savedArticle.tap()
        let reader = app.buttons["readSavedContent"]
        for _ in 0..<8 {
            if reader.exists && reader.isHittable { break }
            app.scrollViews.firstMatch.swipeUp()
        }
        reader.tap()
        let content = app.staticTexts["savedReaderText"]
        XCTAssertTrue(content.waitForExistence(timeout: 10))
        XCTAssertTrue(content.label.contains("Literal <article> text & symbols"))
        XCTAssertTrue(content.label.contains("END OF SAVED ARTICLE"))
    }
}
