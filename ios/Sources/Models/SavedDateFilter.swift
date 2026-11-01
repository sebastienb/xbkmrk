import Foundation

struct SavedDateFilter: Equatable, Sendable {
    enum Preset: String, CaseIterable, Identifiable, Sendable {
        case all, today, yesterday, thisWeek, lastWeek, custom
        var id: Self { self }
        var title: String {
            switch self {
            case .all: "All dates"
            case .today: "Saved today"
            case .yesterday: "Saved yesterday"
            case .thisWeek: "This week"
            case .lastWeek: "Last week"
            case .custom: "Date range…"
            }
        }
    }

    var preset: Preset = .all
    var from: Date?
    var before: Date?

    static func make(_ preset: Preset, start: Date = .now, end: Date = .now,
                     now: Date = .now, timeZone: TimeZone = .autoupdatingCurrent) -> Self {
        guard preset != .all else { return Self() }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.firstWeekday = 2 // Match the web's Monday–Sunday weeks.
        let today = calendar.startOfDay(for: now)
        func addingDays(_ count: Int, to date: Date) -> Date {
            calendar.date(byAdding: .day, value: count, to: date)!
        }
        let from: Date
        let before: Date
        switch preset {
        case .all: return Self()
        case .today:
            from = today; before = addingDays(1, to: today)
        case .yesterday:
            from = addingDays(-1, to: today); before = today
        case .thisWeek, .lastWeek:
            let monday = calendar.dateInterval(of: .weekOfYear, for: today)!.start
            from = preset == .lastWeek ? addingDays(-7, to: monday) : monday
            before = addingDays(7, to: from)
        case .custom:
            from = calendar.startOfDay(for: start)
            before = addingDays(1, to: calendar.startOfDay(for: max(start, end)))
        }
        return Self(preset: preset, from: from, before: before)
    }

    var items: [URLQueryItem] {
        let format = ISO8601DateFormatter()
        return [from.map { URLQueryItem(name: "saved_from", value: format.string(from: $0)) },
                before.map { URLQueryItem(name: "saved_before", value: format.string(from: $0)) }].compactMap { $0 }
    }

    var summary: String? {
        guard preset != .all else { return nil }
        guard preset == .custom, let from, let before else { return preset.title }
        return "Saved \(from.formatted(date: .abbreviated, time: .omitted)) – \(before.addingTimeInterval(-1).formatted(date: .abbreviated, time: .omitted))"
    }
}
