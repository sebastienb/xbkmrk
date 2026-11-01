import SwiftUI

struct LibrarySelectionSection: View {
    @Binding var query: BookmarkQuery
    let showAll: () -> Void

    var body: some View {
        Section {
            LabeledContent("Collection", value: query.reading == .all ? "All bookmarks" : query.reading.rawValue)
                .font(.subheadline)
                .accessibilityIdentifier("sidebarCurrentCollection")

            if !query.text.isEmpty {
                SidebarFilterRow(title: "Search", value: query.text, symbol: "magnifyingglass", id: "search") {
                    query.text = ""
                }
            }
            ForEach(query.activeFilters) { filter in
                SidebarFilterRow(title: filter.kind.title, value: filter.value,
                                 symbol: filter.kind.symbol, id: filter.kind.rawValue) {
                    query.clear(filter.kind)
                }
            }
            if query.hasFilters {
                Button("Clear filters", systemImage: "line.3.horizontal.decrease.circle") {
                    query.clearFilters()
                }
                .accessibilityIdentifier("clearSidebarFilters")
                .accessibilityHint("Keeps your search and selected collection.")
            }
            if !query.isShowingAll {
                Button("Show all bookmarks", systemImage: "square.stack", action: showAll)
                    .accessibilityIdentifier("showAllBookmarks")
                    .accessibilityHint("Clears the search and all filters, and includes archived bookmarks.")
            } else {
                Text("No active filters")
                    .font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("noActiveFilters")
            }
        } header: {
            Text("Showing")
        } footer: {
            if query.hasFilters {
                Text("Clear filters keeps your collection and search. Show all bookmarks resets both too.")
            }
        }
    }
}

private struct SidebarFilterRow: View {
    let title: String
    let value: String
    let symbol: String
    let id: String
    let clear: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Label {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.caption).foregroundStyle(.secondary)
                    Text(value)
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("activeFilter-\(id)")
                }
            } icon: {
                Image(systemName: symbol).foregroundStyle(.tint)
            }
            Spacer(minLength: 0)
            Button(action: clear) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Clear \(title.lowercased()): \(value)")
            .accessibilityIdentifier("clearSidebarFilter-\(id)")
        }
    }
}

/// Query selection persists when the native navigation highlight moves to another row.
struct SidebarSelectionLabel: View {
    let title: String
    let symbol: String
    let selected: Bool

    var body: some View {
        HStack {
            Label(title, systemImage: symbol)
            if selected {
                Spacer(minLength: 8)
                Image(systemName: "checkmark")
                    .font(.subheadline.weight(.semibold))
                    .accessibilityHidden(true)
            }
        }
    }
}
