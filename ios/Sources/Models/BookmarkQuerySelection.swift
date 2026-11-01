import Foundation

enum BookmarkFilter: String, CaseIterable, Identifiable, Sendable {
    case category, source, content, author, savedDate

    var id: Self { self }

    var title: String {
        switch self {
        case .category: "Category"
        case .source: "Source"
        case .content: "Content"
        case .author: "Author"
        case .savedDate: "Saved date"
        }
    }

    var symbol: String {
        switch self {
        case .category: "number"
        case .source: "tray.2"
        case .content: "doc.richtext"
        case .author: "person"
        case .savedDate: "calendar"
        }
    }
}

struct ActiveBookmarkFilter: Identifiable, Equatable {
    let kind: BookmarkFilter
    let value: String
    var id: BookmarkFilter { kind }
}

extension BookmarkQuery {
    var activeFilters: [ActiveBookmarkFilter] {
        [tag.isEmpty ? nil : ActiveBookmarkFilter(kind: .category, value: "#\(tag)"),
         source == .all ? nil : ActiveBookmarkFilter(kind: .source, value: source.title),
         content == .all ? nil : ActiveBookmarkFilter(kind: .content, value: content.title),
         author.isEmpty ? nil : ActiveBookmarkFilter(kind: .author, value: "@\(author)"),
         savedDate.summary.map { ActiveBookmarkFilter(kind: .savedDate, value: $0) }]
            .compactMap { $0 }
    }

    var isShowingAll: Bool { reading == .all && text.isEmpty && !hasFilters }

    mutating func clear(_ filter: BookmarkFilter) {
        switch filter {
        case .category: tag = ""
        case .source: source = .all
        case .content: content = .all
        case .author: author = ""
        case .savedDate: savedDate = SavedDateFilter()
        }
    }

    mutating func showAll() {
        clearFilters()
        text = ""
        reading = .all
    }
}
