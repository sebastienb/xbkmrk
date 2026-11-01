import SwiftUI

struct SavedDateFilterView: View {
    @Binding var filter: SavedDateFilter
    @State private var choice: SavedDateFilter.Preset = .all
    @State private var start: Date = .now
    @State private var end: Date = .now

    var body: some View {
        Section {
            Picker("Saved date", selection: Binding(get: { choice }, set: { value in
                choice = value
                if value != .custom { filter = .make(value) }
            })) {
                ForEach(SavedDateFilter.Preset.allCases) { preset in
                    Text(preset.title).tag(preset)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("savedDatePreset")
            if choice == .custom {
                DatePicker("From", selection: $start, in: ...end, displayedComponents: .date)
                    .accessibilityIdentifier("savedDateFrom")
                DatePicker("Through", selection: $end, in: start..., displayedComponents: .date)
                    .accessibilityIdentifier("savedDateThrough")
                Button("Apply date range") { filter = .make(.custom, start: start, end: end) }
                    .accessibilityIdentifier("applySavedDates")
            }
        } header: {
            Text("Saved date")
        } footer: {
            Text("Local dates · Monday–Sunday weeks. The end date is included.")
        }
        .onAppear { synchronize() }
        .onChange(of: filter) { synchronize() }
    }

    private func synchronize() {
        choice = filter.preset
        if filter.preset == .custom, let from = filter.from, let before = filter.before {
            start = from
            end = before.addingTimeInterval(-1)
        }
    }
}
