import SwiftUI

struct SettingsView: View {
    let client: ArchiveClient
    let sync: ArchiveSyncModel
    @Environment(AppSession.self) private var session
    @Environment(AppAppearance.self) private var appearance

    var body: some View {
        @Bindable var appearance = appearance
        Form {
            Section("Server settings") {
                NavigationLink {
                    ServerSettingsView()
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Connection")
                            Text(session.connectedURL?.host() ?? "Your server")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } icon: { Image(systemName: "server.rack") }
                }
                .accessibilityIdentifier("serverSettings")
                FetchLatestButton(sync: sync)
                if let lastChecked = sync.status?.lastChecked {
                    LabeledContent("Last checked") {
                        Text(lastChecked, style: .relative)
                            .foregroundStyle(.secondary)
                    }
                }
                if sync.message != nil || sync.error != nil {
                    ArchiveSyncStatusView(sync: sync)
                }
            }
            Section("Saving bookmarks") {
                NavigationLink {
                    SaveSetupView(kind: .bookmarklet, client: client)
                } label: { Label("Browser bookmarklet", systemImage: "bookmark") }
                .accessibilityIdentifier("bookmarkletSetup")
                NavigationLink {
                    SaveSetupView(kind: .shortcut, client: client)
                } label: { Label("iOS Shortcut", systemImage: "square.and.arrow.down") }
                .accessibilityIdentifier("shortcutSetup")
            }
            Section {
                Picker("Color scheme", selection: $appearance.theme) {
                    ForEach(AppTheme.allCases) { theme in Text(theme.title).tag(theme) }
                }
                NavigationLink {
                    FeedAppearanceView()
                } label: { Label("Feed", systemImage: "rectangle.stack") }
                .accessibilityIdentifier("feedAppearance")
                NavigationLink {
                    BookmarkAppearanceView()
                } label: { Label("Bookmark page", systemImage: "doc.text") }
                .accessibilityIdentifier("bookmarkAppearance")
                NavigationLink {
                    SidebarAppearanceView()
                } label: { Label("Sidebar", systemImage: "sidebar.left") }
                .accessibilityIdentifier("sidebarAppearance")
            } header: {
                Text("Appearance")
            } footer: {
                Text("Changes apply immediately and are saved on this device.")
            }
            Section {
                Button("Reset appearance to defaults") { appearance.reset() }
            }
            Section("About") {
                LabeledContent("xbkmrk", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                Text("Your bookmarks stay on your server. Sharing sends the original public link.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .task { await sync.loadStatus(client: client, session: session) }
    }
}

struct ServerSettingsView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        Form {
            Section("Connected server") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Address").font(.subheadline).foregroundStyle(.secondary)
                    Text(session.connectedURL?.absoluteString ?? "")
                        .textSelection(.enabled)
                }
                if let url = session.connectedURL {
                    Link(destination: url) { Label("Open server in Safari", systemImage: "safari") }
                    Link(destination: url.appending(path: "settings")) {
                        Label("Manage server settings", systemImage: "gearshape")
                    }
                }
            }
            Section {
                Button("Disconnect / change server", role: .destructive) { session.disconnect() }
            } footer: {
                Text("Disconnect removes the saved session and returns to sign-in, where you can enter another server. Appearance settings stay on this device.")
            }
        }
        .navigationTitle("Server settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct FeedAppearanceView: View {
    @Environment(AppAppearance.self) private var appearance

    var body: some View {
        @Bindable var appearance = appearance
        Form {
            Section("Preview images") {
                Picker("Image size", selection: $appearance.feedImageSize) {
                    ForEach(FeedImageSize.allCases) { size in Text(size.title).tag(size) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("feedImageSize")
            }
            Section {
                Toggle("Descriptions", isOn: $appearance.feedShowsDescriptions)
                    .accessibilityIdentifier("feedDescriptions")
                Toggle("Tags", isOn: $appearance.feedShowsTags)
                    .accessibilityIdentifier("feedTags")
            } header: {
                Text("Card content")
            } footer: {
                Text("Titles, sources, and actions always remain visible. Hidden content is still available on the bookmark page.")
            }
        }
        .navigationTitle("Feed appearance")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct BookmarkAppearanceView: View {
    @Environment(AppAppearance.self) private var appearance

    var body: some View {
        @Bindable var appearance = appearance
        Form {
            Section("Bookmark text") {
                Picker("Font", selection: $appearance.detailTextFont) {
                    ForEach(BookmarkTextFont.allCases) { font in Text(font.title).tag(font) }
                }
                Text("A quieter place for the things worth coming back to.")
                    .font(.system(.body, design: appearance.detailTextFont.design)).padding(.vertical, 6)
                    .accessibilityLabel("Font preview")
            }
            Section {
                Toggle("Preview image", isOn: $appearance.detailShowsImages)
                    .accessibilityIdentifier("detailImages")
                Toggle("Tags", isOn: $appearance.detailShowsTags)
                    .accessibilityIdentifier("detailTags")
                Toggle("Notes", isOn: $appearance.detailShowsNotes)
                    .accessibilityIdentifier("detailNotes")
            } header: {
                Text("Page content")
            } footer: {
                Text("Controls the page shown when you open a bookmark. Hiding notes or tags does not remove them from your server.")
            }
        }
        .navigationTitle("Bookmark page")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct SidebarAppearanceView: View {
    @Environment(AppAppearance.self) private var appearance

    var body: some View {
        @Bindable var appearance = appearance
        Form {
            Section {
                Toggle("Category counts", isOn: $appearance.sidebarShowsCounts)
                    .accessibilityIdentifier("sidebarCounts")
                Picker("Order", selection: $appearance.sidebarCategoryOrder) {
                    ForEach(CategoryOrder.allCases) { order in Text(order.title).tag(order) }
                }
                Picker("Categories shown", selection: $appearance.sidebarCategoryLimit) {
                    ForEach(CategoryLimit.allCases) { limit in Text(limit.title).tag(limit) }
                }
            } header: {
                Text("Categories")
            } footer: {
                Text("You can always expand the full list in the sidebar. The selected category stays visible.")
            }
        }
        .navigationTitle("Sidebar appearance")
        .navigationBarTitleDisplayMode(.inline)
    }
}
