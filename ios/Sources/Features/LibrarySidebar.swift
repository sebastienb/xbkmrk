import SwiftUI

enum LibraryDestination: Hashable {
    case collection(ReadingFilter)
    case category(String)
    case settings
}

struct LibrarySidebar: View {
    @Binding var selection: LibraryDestination?
    @Binding var query: BookmarkQuery
    let options: FilterOptions?
    let error: String?
    let server: String
    let retry: () -> Void
    @Environment(AppAppearance.self) private var appearance
    @State private var showAllCategories = false

    var body: some View {
        List(selection: $selection) {
            LibrarySelectionSection(query: $query) {
                query.showAll()
                selection = .collection(.all)
            }

            Section("Collections") {
                ForEach(ReadingFilter.allCases) { collection in
                    NavigationLink(value: LibraryDestination.collection(collection)) {
                        SidebarSelectionLabel(title: collection == .all ? "All bookmarks" : collection.rawValue,
                                              symbol: collection.symbol, selected: query.reading == collection)
                    }
                    .accessibilityIdentifier("collection-\(collection.rawValue.lowercased())")
                    .tag(LibraryDestination.collection(collection))
                    .accessibilityValue(query.reading == collection ? "Selected collection" : "")
                }
            }

            Section {
                NavigationLink(value: LibraryDestination.category("")) {
                    SidebarSelectionLabel(title: "All categories", symbol: "square.grid.2x2", selected: query.tag.isEmpty)
                }
                .accessibilityIdentifier("allCategories")
                .tag(LibraryDestination.category(""))
                .accessibilityValue(query.tag.isEmpty ? "Selected category" : "")
                ForEach(visibleCategories) { category in
                    NavigationLink(value: LibraryDestination.category(category.tag)) {
                        SidebarSelectionLabel(title: category.tag, symbol: "number", selected: query.tag == category.tag)
                    }
                    .badge(appearance.sidebarShowsCounts ? category.count : 0)
                    .accessibilityIdentifier("category-\(category.tag)")
                    .tag(LibraryDestination.category(category.tag))
                    .accessibilityValue([
                        query.tag == category.tag ? "Selected category" : nil,
                        appearance.sidebarShowsCounts ? "\(category.count) bookmarks" : nil
                    ].compactMap { $0 }.joined(separator: ", "))
                }
                if let options, options.tags.count > appearance.sidebarCategoryLimit.count {
                    Button(showAllCategories ? "Show fewer categories" : "Show all \(options.tags.count) categories",
                           systemImage: showAllCategories ? "chevron.up" : "chevron.down") {
                        showAllCategories.toggle()
                    }
                    .font(.subheadline)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("expandCategories")
                }
                if let error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error).font(.caption).foregroundStyle(.secondary)
                        Button("Retry categories", action: retry)
                            .frame(minHeight: 44)
                    }
                } else if options == nil {
                    ProgressView("Loading categories…")
                } else if options?.tags.isEmpty == true {
                    Text("Tags from your server appear here.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            } header: {
                Text("Categories")
            } footer: {
                Text(appearance.sidebarShowsCounts ? "Your tags, with counts across the library." : "Tags from your server.")
            }

            SavedDateFilterView(filter: $query.savedDate)

            Section("Filters") {
                Picker(selection: $query.source) {
                    ForEach(SourceFilter.allCases) { source in Text(source.title).tag(source) }
                } label: { Label("Source", systemImage: "tray.2") }
                .accessibilityIdentifier("sourceFilter")

                Picker(selection: $query.content) {
                    ForEach(ContentFilter.allCases) { content in Text(content.title).tag(content) }
                } label: { Label("Content", systemImage: "doc.richtext") }
                .accessibilityIdentifier("contentFilter")

                Picker(selection: $query.author) {
                    Text("Anyone").tag("")
                    ForEach(options?.authors ?? []) { author in
                        Text(author.title == "@\(author.username)" ? author.title : "\(author.title) (@\(author.username))")
                            .tag(author.username)
                    }
                    if !query.author.isEmpty, !(options?.authors.contains { $0.username == query.author } ?? false) {
                        Text("@\(query.author)").tag(query.author)
                    }
                } label: { Label("Author", systemImage: "person") }
                .disabled(options?.authors.isEmpty ?? true)
                .accessibilityIdentifier("authorFilter")

            }
            .pickerStyle(.menu)

            Section {
                Picker(selection: $query.mode) {
                    ForEach(SearchMode.allCases) { mode in Text(mode.title).tag(mode) }
                } label: { Label("Search mode", systemImage: "magnifyingglass") }
                .pickerStyle(.menu)
            } footer: {
                Text("Keyword matches words. Semantic finds related ideas. Hybrid combines both.")
            }
            Section {
                NavigationLink(value: LibraryDestination.settings) {
                    Label("Settings", systemImage: "gearshape")
                }
                .accessibilityIdentifier("openSettings")
                .tag(LibraryDestination.settings)
            } footer: {
                Text(server)
            }
        }
        .listStyle(.sidebar)
    }

    private var visibleCategories: [FilterOptions.Tag] {
        let tags = appearance.sidebarCategoryOrder.sorted(options?.tags ?? [])
        if showAllCategories { return tags }
        var visible = Array(tags.prefix(appearance.sidebarCategoryLimit.count))
        if let selected = tags.first(where: { $0.tag == query.tag }),
           !visible.contains(where: { $0.id == selected.id }) {
            visible.append(selected)
        }
        return visible
    }

}
