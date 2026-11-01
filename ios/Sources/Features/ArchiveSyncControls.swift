import SwiftUI

struct FetchLatestButton: View {
    let sync: ArchiveSyncModel

    var body: some View {
        Button(action: sync.start) {
            Label(sync.isSyncing ? "Fetching latest posts…" : "Fetch latest posts", systemImage: "arrow.clockwise")
        }
        .disabled(sync.isSyncing)
        .accessibilityIdentifier("fetchLatestPosts")
        .accessibilityHint("Asks your server to check its connected sources for new posts.")
    }
}

struct ArchiveSyncStatusView: View {
    let sync: ArchiveSyncModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let message = sync.message {
                HStack(alignment: .top, spacing: 8) {
                    if sync.isSyncing { ProgressView().controlSize(.small) }
                    Text(message)
                }
                .accessibilityIdentifier("syncStatus")
            }
            if let error = sync.error {
                Label(error, systemImage: "exclamationmark.circle")
                    .accessibilityIdentifier("syncError")
            }
        }
        .font(.footnote).foregroundStyle(.secondary)
    }
}
