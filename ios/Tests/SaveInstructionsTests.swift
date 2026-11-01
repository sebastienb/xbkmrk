import Foundation
import JavaScriptCore
import XCTest
@testable import XBkmrk

final class SaveInstructionsTests: XCTestCase {
    func testBookmarkletSavesThePageTitleAndSelectionWithSafeEncoding() throws {
        let token = "test'\"&?=#secret"
        let instructions = try SaveInstructions(server: XCTUnwrap(URL(string: "https://archive.example:3443/team'one")), token: token)
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("""
        var captured;
        var location = { href: 'https://example.org/article?a=1&b=two#part' };
        var document = { title: 'A title & a quote' };
        var window = { getSelection: () => 'Selected text & more', open: (url) => { captured = url; } };
        """)
        context.evaluateScript(String(instructions.bookmarklet.dropFirst("javascript:".count)))
        XCTAssertNil(context.exception)
        let captured = try XCTUnwrap(context.objectForKeyedSubscript("captured")?.toString())
        let parts = try XCTUnwrap(URLComponents(string: captured))
        let query = Dictionary(uniqueKeysWithValues: (parts.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(parts.host, "archive.example")
        XCTAssertEqual(parts.port, 3443)
        XCTAssertEqual(parts.path, "/team'one/api/save")
        XCTAssertEqual(query, ["token": token, "url": "https://example.org/article?a=1&b=two#part",
                               "title": "A title & a quote", "sel": "Selected text & more"])
    }

    func testBookmarkletBoundsCapturedTextAndHandlesMissingSelection() throws {
        let instructions = try SaveInstructions(server: XCTUnwrap(URL(string: "https://archive.example")), token: "fixture-save-token")
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("""
        var captured;
        var location = { href: 'https://example.org/' };
        var document = { title: 'x'.repeat(500) };
        var window = { getSelection: () => 'y'.repeat(2000), open: (url) => { captured = url; } };
        """)
        let script = String(instructions.bookmarklet.dropFirst("javascript:".count))
        context.evaluateScript(script)
        let captured = try XCTUnwrap(context.objectForKeyedSubscript("captured")?.toString())
        let fields = try XCTUnwrap(URLComponents(string: captured)?.queryItems)
        XCTAssertEqual(fields.first { $0.name == "title" }?.value?.count, 300)
        XCTAssertEqual(fields.first { $0.name == "sel" }?.value?.count, 1500)
        context.evaluateScript("delete window.getSelection;")
        context.evaluateScript(script)
        XCTAssertFalse(context.objectForKeyedSubscript("captured").toString().contains("&sel="))
    }

    func testShortcutPromptUsesTheCurrentServerAndSameTokenAsBookmarklet() throws {
        let instructions = try SaveInstructions(server: XCTUnwrap(URL(string: "https://another.example:3443/archive/")), token: "fixture-save-token")
        XCTAssertEqual(instructions.saveURL.absoluteString, "https://another.example:3443/archive/api/save?token=fixture-save-token")
        XCTAssertTrue(instructions.shortcutPrompt.contains(instructions.saveURL.absoluteString))
        XCTAssertTrue(instructions.shortcutPrompt.contains("Method: POST"))
        XCTAssertTrue(instructions.shortcutPrompt.contains("Shortcut Input"))
        XCTAssertFalse(instructions.shortcutPrompt.contains("xbm_session"))
        XCTAssertThrowsError(try SaveInstructions(server: instructions.saveURL, token: "  "))
    }
}
