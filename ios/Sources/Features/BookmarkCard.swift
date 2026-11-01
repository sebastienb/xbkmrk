import SwiftUI

struct BookmarkCard: View {
    let bookmark: Bookmark
    let client: ArchiveClient
    let isUpdating: Bool
    let onToggleRead: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(AppAppearance.self) private var appearance
    @ScaledMetric(relativeTo: .body) private var actionSize = 17

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            sourceHeader
            if appearance.feedImageSize != .hidden, !bookmark.videos.isEmpty {
                VideoLauncher(bookmark: bookmark, client: client) {
                    videoPreview
                }
                .buttonStyle(.plain)
            } else if appearance.feedImageSize != .hidden, let path = bookmark.thumbnailPath {
                NavigationLink(value: bookmark) {
                    ServerImage(path: path, client: client,
                                alt: bookmark.media.first?.altText ?? "Preview of \(bookmark.title)")
                        .aspectRatio(appearance.feedImageSize.aspectRatio, contentMode: .fit)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Read \(bookmark.title)")
            }
            NavigationLink(value: bookmark) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(bookmark.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 3)
                        .fixedSize(horizontal: false, vertical: true)
                    if appearance.feedShowsDescriptions, let description = bookmark.previewDescription {
                        Text(description)
                            .font(.subheadline).foregroundStyle(.secondary)
                            .lineSpacing(2)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
            .padding(.top, appearance.feedImageSize == .hidden || (bookmark.thumbnailPath == nil && bookmark.videos.isEmpty) ? 2 : 14)
            if appearance.feedShowsTags, !bookmark.tags.isEmpty {
                Text(bookmark.tags.prefix(3).map { "#\($0)" }.joined(separator: "  "))
                    .font(.caption.weight(.medium)).foregroundStyle(.tint)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    .padding(.horizontal, 16).padding(.top, 10)
            }
            Divider().padding(.horizontal, 16).padding(.top, 14)
            actionBar
        }
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(.rect(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(Color(.separator).opacity(0.2), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bookmarkCard-\(bookmark.id)")
    }

    private var sourceHeader: some View {
        HStack(spacing: 10) {
            Image(systemName: bookmark.symbol)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(sourceColor)
                .frame(width: 28, height: 28)
                .background(sourceColor.opacity(0.1), in: .circle)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(bookmark.attribution).font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary).lineLimit(1)
                HStack(spacing: 5) {
                    Text(bookmark.sourceLabel)
                    if let date = bookmark.savedDate {
                        Text("·")
                        Text(date, format: .dateTime.month(.abbreviated).day())
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Menu {
                NavigationLink(value: bookmark) { Label("Read bookmark", systemImage: "doc.text") }
                if let url = bookmark.originalURL {
                    Link(destination: url) { Label("Open original in Safari", systemImage: "safari") }
                }
                Button(action: onToggleRead) {
                    Label(bookmark.readAt == nil ? "Move to archive" : "Move to saves",
                          systemImage: bookmark.readAt == nil ? "archivebox" : "bookmark")
                }
                .disabled(isUpdating)
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 16, weight: .medium))
                    .frame(width: 44, height: 44).contentShape(.rect)
            }
            .tint(.secondary)
            .accessibilityLabel("Actions for \(bookmark.title)")
        }
        .padding(.leading, 16).padding(.trailing, 6).padding(.vertical, 6)
    }

    private var actionBar: some View {
        HStack(spacing: 4) {
            if !bookmark.videos.isEmpty {
                VideoLauncher(bookmark: bookmark, client: client) {
                    actionLabel("Play", symbol: "play.fill")
                }
                .padding(.horizontal, 6)
            } else {
                NavigationLink(value: bookmark) { actionLabel("Read", symbol: "doc.text") }
                    .accessibilityLabel("Read bookmark")
                    .padding(.horizontal, 6)
            }
            if let url = bookmark.originalURL {
                ShareLink(item: url, subject: Text(bookmark.title)) {
                    actionIcon("square.and.arrow.up", label: "Share bookmark")
                }
                .accessibilityIdentifier("feedShare-\(bookmark.id)")
                Link(destination: url) {
                    actionIcon("arrow.up.right", label: "Open original in Safari")
                }
            } else {
                ShareLink(item: bookmark.text) {
                    actionIcon("square.and.arrow.up", label: "Share bookmark text")
                }
            }
            Spacer(minLength: 8)
            Button(action: onToggleRead) {
                Group {
                    if isUpdating { ProgressView().controlSize(.small) }
                    else {
                        Image(systemName: bookmark.readAt == nil ? "archivebox" : "arrow.uturn.backward")
                            .font(.system(size: actionSize, weight: .regular))
                    }
                }
                .frame(minWidth: 44, minHeight: 44).contentShape(.rect)
            }
            .disabled(isUpdating)
            .accessibilityLabel(bookmark.readAt == nil ? "Move to archive" : "Move to saves")
            .accessibilityIdentifier("feedArchive-\(bookmark.id)")
        }
        .buttonStyle(.plain).foregroundStyle(.secondary)
        .padding(.horizontal, 10).padding(.vertical, 2)
    }

    private var videoPreview: some View {
        ZStack {
            BookmarkVideoPreview(bookmark: bookmark, client: client)
                .aspectRatio(appearance.feedImageSize.aspectRatio, contentMode: .fit)
            Label("Play video", systemImage: "play.fill")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 16).padding(.vertical, 12)
                .glassEffect()
        }
        .contentShape(.rect)
    }

    private func actionLabel(_ text: String, symbol: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: actionSize))
            Text(text).font(.subheadline.weight(.medium))
        }
        .frame(minWidth: 44, minHeight: 44).contentShape(.rect)
    }

    private func actionIcon(_ symbol: String, label: String) -> some View {
        Image(systemName: symbol).font(.system(size: actionSize, weight: .regular))
            .frame(minWidth: 44, minHeight: 44).contentShape(.rect)
            .accessibilityLabel(label)
    }

    private var sourceColor: Color {
        switch bookmark.source {
        case "youtube": .red
        case "x": .primary
        default: .accentColor
        }
    }
}
