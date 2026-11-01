import SwiftUI

struct LibraryView: View {
    let client: ArchiveClient
    @Environment(AppSession.self) private var session
    @State private var model = LibraryModel()
    @State private var sync = ArchiveSyncModel()
    @State private var query = BookmarkQuery()
    @State private var options: FilterOptions?
    @State private var filtersError: String?
    @State private var filtersRetry = 0
    @State private var selection: LibraryDestination? = .collection(.saves)
    @State private var path = NavigationPath()
    @State private var retry = 0
    private struct LoadID: Equatable {
        let query: BookmarkQuery
        let revision: Int
        let retry: Int
    }

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            detail
        }
        .task(id: LoadID(query: query, revision: session.changeRevision, retry: retry)) {
            await model.reload(query: query, client: client, session: session, debounce: !query.text.isEmpty)
        }
        .task(id: filtersRetry) { await loadFilters() }
        .task(id: sync.requestID) {
            guard sync.requestID > 0 else { return }
            if await sync.fetchLatest(client: client, session: session) {
                session.changeRevision += 1
                filtersRetry += 1
            }
        }
        .onChange(of: selection) {
            path = NavigationPath()
            switch selection {
            case .collection(let collection): query.reading = collection
            case .category(let tag): query.tag = tag
            case .settings, nil: break
            }
        }
        .onChange(of: query) {
            path = NavigationPath()
            if selection == .settings {
                selection = .collection(query.reading)
            } else if case .category(let selectedTag) = selection, selectedTag != query.tag {
                selection = .category(query.tag)
            }
        }
    }

    private var sidebar: some View {
        LibrarySidebar(selection: $selection, query: $query, options: options,
                       error: filtersError, server: session.connectedURL?.host() ?? "Your server",
                       retry: { filtersRetry += 1 })
            .navigationTitle("Library")
    }

    private var detail: some View {
        NavigationStack(path: $path) {
            Group {
                if selection == .settings {
                    SettingsView(client: client, sync: sync)
                } else if selection != nil {
                    feed
                } else {
                    ContentUnavailableView("Choose a collection", systemImage: "sidebar.left",
                                           description: Text("Select a collection or category in the sidebar."))
                }
            }
            .navigationDestination(for: Bookmark.self) { bookmark in
                BookmarkDetailView(bookmark: bookmark, client: client)
            }
        }
    }

    private var feed: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    libraryHeader.id("libraryTop")
                    if let error = model.error {
                        errorView(error)
                    }
                    if model.isLoading && model.bookmarks.isEmpty {
                        ProgressView("Loading your bookmarks…")
                            .frame(maxWidth: .infinity).padding(.vertical, 70)
                    } else if model.bookmarks.isEmpty && model.error == nil {
                        ContentUnavailableView {
                            Label(query.text.isEmpty ? "Nothing here yet" : "No matches", systemImage: query.text.isEmpty ? "bookmark" : "magnifyingglass")
                        } description: {
                            Text(query.text.isEmpty ? "Try a different collection or filter. Bookmarks saved to your server will appear here." : "Try different words or switch the search mode in Filters.")
                        }
                    } else {
                        ForEach(model.bookmarks) { bookmark in
                            BookmarkCard(bookmark: bookmark, client: client,
                                         isUpdating: model.updatingIDs.contains(bookmark.id)) {
                                Task { await model.toggleRead(bookmark, client: client, session: session) }
                            }
                            .contextMenu {
                                if let url = bookmark.originalURL {
                                    ShareLink(item: url, subject: Text(bookmark.title)) {
                                        Label("Share original link", systemImage: "square.and.arrow.up")
                                    }
                                    Link(destination: url) { Label("Open original", systemImage: "safari") }
                                }
                            }
                            .padding(.horizontal, 14)
                            .padding(.bottom, 16)
                        }
                        if let error = model.pageError {
                            Text(error).font(.callout).foregroundStyle(.secondary).padding(18)
                        }
                        if model.nextCursor != nil {
                            Button {
                                Task { await model.loadMore(client: client, session: session) }
                            } label: {
                                HStack {
                                    if model.isLoadingMore { ProgressView() }
                                    Text(model.pageError == nil ? "Load more bookmarks" : "Retry loading more")
                                }
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                            }
                            .buttonStyle(.glass)
                            .disabled(model.isLoadingMore)
                            .padding(18)
                        }
                    }
                }
                .padding(.bottom, 24)
                .frame(maxWidth: 620).frame(maxWidth: .infinity)
            }
            .onChange(of: query) { scroll.scrollTo("libraryTop", anchor: .top) }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("xbkmrk")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query.text, prompt: "Search your bookmarks")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                FetchLatestButton(sync: sync)
            }
        }
        .refreshable {
            await model.reload(query: query, client: client, session: session, debounce: false)
            await loadFilters()
        }
        .alert("Couldn’t update bookmark", isPresented: Binding(
            get: { model.actionError != nil },
            set: { if !$0 { model.actionError = nil } }
        )) {
            Button("OK", role: .cancel) { model.actionError = nil }
        } message: { Text(model.actionError ?? "") }
    }

    private func loadFilters() async {
        filtersError = nil
        do {
            let loaded = try await client.filters()
            try Task.checkCancellation()
            options = loaded
        } catch {
            if !Task.isCancelled { filtersError = session.handle(error) }
        }
    }

    private var filterSummary: String {
        query.activeFilters.map(\.value).joined(separator: " · ")
    }

    private var libraryHeader: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(query.text.isEmpty ? collectionTitle : "Search results")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if !model.isLoading {
                    Text("\(model.total) \(query.text.isEmpty ? (model.total == 1 ? "bookmark" : "bookmarks") : "found")")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if query.hasFilters {
                HStack(alignment: .top) {
                    Text(filterSummary)
                        .font(.caption).foregroundStyle(.tint)
                    Spacer()
                    Button("Clear filters") { query.clearFilters() }
                        .font(.caption).fixedSize()
                        .frame(minHeight: 44)
                }
            }
            if !query.text.isEmpty, let mode = model.effectiveMode {
                Text(mode == query.mode.rawValue ? "\(mode.capitalized) search · up to 100 results" : "Using keyword search — semantic search is unavailable on the server.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if sync.message != nil || sync.error != nil {
                ArchiveSyncStatusView(sync: sync)
            }
        }
        .padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 12)
    }

    private var collectionTitle: String {
        switch query.reading {
        case .saves: "Saved for later"
        case .archive: "Your archive"
        case .all: "All bookmarks"
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Couldn’t load bookmarks", systemImage: "wifi.exclamationmark").font(.headline)
            Text(message).font(.callout).foregroundStyle(.secondary)
            Button("Try again") { retry += 1 }.buttonStyle(.glass)
        }
        .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: .rect(cornerRadius: 24))
    }
}
