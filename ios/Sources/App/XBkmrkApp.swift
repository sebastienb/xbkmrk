import SwiftUI

@main
struct XBkmrkApp: App {
    @State private var session = AppSession()
    @State private var appearance = AppAppearance()

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isRestoring {
                    ProgressView("Opening your library…")
                } else if let client = session.client {
                    LibraryView(client: client)
                        .id(session.connectedURL)
                } else {
                    ConnectionView()
                }
            }
            .tint(.accentColor)
            .environment(session)
            .environment(appearance)
            .preferredColorScheme(appearance.theme.colorScheme)
            .task { await session.restore() }
        }
    }
}
