import XCTest
@testable import XBkmrk

/// Signs the test host into the local fixture through the normal login API.
/// This avoids relying on keyboard automation to prepare a fresh UI test device.
@MainActor
final class UITestFixtureSessionTests: XCTestCase {
    func testConnectToLocalFixture() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["XBKMRK_UI_FIXTURE"] == "1",
                          "Only prepares an explicitly requested local fixture run.")
        let session = AppSession()
        session.serverAddress = "http://127.0.0.1:18769"
        let connected = await session.connect(password: "fixture-password")
        XCTAssertTrue(connected, session.error ?? "Could not connect to the local fixture.")
    }
}
