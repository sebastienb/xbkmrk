import SwiftUI
import Observation

enum AppTheme: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: Self { self }
    var title: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

enum FeedImageSize: String, CaseIterable, Identifiable {
    case large, compact, hidden
    var id: Self { self }
    var title: String { rawValue.capitalized }
    var aspectRatio: CGFloat { self == .compact ? 2.4 : 1.6 }
}

enum BookmarkTextFont: String, CaseIterable, Identifiable {
    case system, serif
    var id: Self { self }
    var title: String { self == .system ? "System" : "Serif" }
    var design: Font.Design { self == .serif ? .serif : .default }
}

enum CategoryOrder: String, CaseIterable, Identifiable {
    case mostUsed, alphabetical
    var id: Self { self }
    var title: String { self == .mostUsed ? "Most used" : "Alphabetical" }

    func sorted(_ tags: [FilterOptions.Tag]) -> [FilterOptions.Tag] {
        tags.sorted { lhs, rhs in
            if self == .mostUsed, lhs.count != rhs.count { return lhs.count > rhs.count }
            return lhs.tag.localizedStandardCompare(rhs.tag) == .orderedAscending
        }
    }
}

enum CategoryLimit: Int, CaseIterable, Identifiable {
    case four = 4, eight = 8, all = 0
    var id: Self { self }
    var title: String { self == .all ? "All" : "\(rawValue)" }
    var count: Int { self == .all ? .max : rawValue }
}

/// Device preferences are independent of the connected server and its Keychain session.
@MainActor @Observable
final class AppAppearance {
    private let defaults: UserDefaults
    var theme: AppTheme { didSet { save(theme.rawValue, "theme") } }
    var feedImageSize: FeedImageSize { didSet { save(feedImageSize.rawValue, "feedImageSize") } }
    var feedShowsDescriptions: Bool { didSet { save(feedShowsDescriptions, "feedShowsDescriptions") } }
    var feedShowsTags: Bool { didSet { save(feedShowsTags, "feedShowsTags") } }
    var detailShowsImages: Bool { didSet { save(detailShowsImages, "detailShowsImages") } }
    var detailShowsTags: Bool { didSet { save(detailShowsTags, "detailShowsTags") } }
    var detailShowsNotes: Bool { didSet { save(detailShowsNotes, "detailShowsNotes") } }
    var detailTextFont: BookmarkTextFont { didSet { save(detailTextFont.rawValue, "detailTextFont") } }
    var sidebarShowsCounts: Bool { didSet { save(sidebarShowsCounts, "sidebarShowsCounts") } }
    var sidebarCategoryOrder: CategoryOrder { didSet { save(sidebarCategoryOrder.rawValue, "sidebarCategoryOrder") } }
    var sidebarCategoryLimit: CategoryLimit { didSet { save(sidebarCategoryLimit.rawValue, "sidebarCategoryLimit") } }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        theme = AppTheme(rawValue: defaults.string(forKey: "appearance.theme") ?? "") ?? .system
        feedImageSize = FeedImageSize(rawValue: defaults.string(forKey: "appearance.feedImageSize") ?? "") ?? .large
        detailTextFont = BookmarkTextFont(rawValue: defaults.string(forKey: "appearance.detailTextFont") ?? "") ?? .system
        sidebarCategoryOrder = CategoryOrder(rawValue: defaults.string(forKey: "appearance.sidebarCategoryOrder") ?? "") ?? .mostUsed
        sidebarCategoryLimit = (defaults.object(forKey: "appearance.sidebarCategoryLimit") as? Int)
            .flatMap(CategoryLimit.init(rawValue:)) ?? .four
        feedShowsDescriptions = defaults.object(forKey: "appearance.feedShowsDescriptions") as? Bool ?? true
        feedShowsTags = defaults.object(forKey: "appearance.feedShowsTags") as? Bool ?? true
        detailShowsImages = defaults.object(forKey: "appearance.detailShowsImages") as? Bool ?? true
        detailShowsTags = defaults.object(forKey: "appearance.detailShowsTags") as? Bool ?? true
        detailShowsNotes = defaults.object(forKey: "appearance.detailShowsNotes") as? Bool ?? true
        sidebarShowsCounts = defaults.object(forKey: "appearance.sidebarShowsCounts") as? Bool ?? true
    }

    func reset() {
        theme = .system
        feedImageSize = .large
        feedShowsDescriptions = true
        feedShowsTags = true
        detailShowsImages = true
        detailShowsTags = true
        detailShowsNotes = true
        detailTextFont = .system
        sidebarShowsCounts = true
        sidebarCategoryOrder = .mostUsed
        sidebarCategoryLimit = .four
    }

    private func save(_ value: Any, _ key: String) {
        defaults.set(value, forKey: "appearance.\(key)")
    }
}
