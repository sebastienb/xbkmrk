import SwiftUI

struct BookmarkDetailView: View {
    let client: ArchiveClient
    @Environment(AppSession.self) private var session
    @Environment(AppAppearance.self) private var appearance
    @State private var bookmark: Bookmark
    @State private var isLoading = true
    @State private var isUpdating = false
    @State private var error: String?
    @State private var reader: ReaderItem?

    init(bookmark: Bookmark, client: ArchiveClient) {
        _bookmark = State(initialValue: bookmark)
        self.client = client
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 14) {
                    Label(bookmark.sourceLabel, systemImage: bookmark.symbol)
                        .font(.subheadline.weight(.semibold)).foregroundStyle(.tint)
                    Text(bookmark.title)
                        .font(.system(.title, design: appearance.detailTextFont.design, weight: .bold))
                        .lineLimit(nil).fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                    HStack {
                        Text(bookmark.attribution)
                        if let date = bookmark.savedDate {
                            Text("·")
                            Text(date, format: .dateTime.month(.abbreviated).day().year())
                        }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                if !bookmark.videos.isEmpty {
                    VideoLauncher(bookmark: bookmark, client: client) {
                        VStack(spacing: 0) {
                            if appearance.detailShowsImages {
                                BookmarkVideoPreview(bookmark: bookmark, client: client)
                                    .frame(height: 220)
                            }
                            Label(bookmark.videos.count > 1 ? "Play videos (\(bookmark.videos.count))" : "Play video",
                                  systemImage: "play.fill")
                                .font(.headline).padding(18).frame(maxWidth: .infinity)
                        }
                        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20))
                        .clipShape(.rect(cornerRadius: 20))
                    }
                    .buttonStyle(.plain).foregroundStyle(.tint)
                } else if appearance.detailShowsImages, let path = bookmark.thumbnailPath {
                    ServerImage(path: path, client: client, alt: bookmark.media.first?.altText ?? "Bookmark image")
                        .frame(height: 220).clipShape(.rect(cornerRadius: 24))
                }
                if !bookmark.bodyText.isEmpty {
                    Text(LinkedPostText.attributed(bookmark.bodyText, urls: bookmark.urls ?? []))
                        .font(.system(.body, design: appearance.detailTextFont.design))
                        .lineLimit(nil).fixedSize(horizontal: false, vertical: true)
                        .lineSpacing(5).textSelection(.enabled)
                        .accessibilityIdentifier("fullPostText")
                } else if let description = bookmark.link?.description {
                    Text(description).font(.system(.body, design: appearance.detailTextFont.design))
                        .lineSpacing(5).textSelection(.enabled)
                }
                if isLoading {
                    ProgressView("Loading saved content…").font(.callout)
                }
                if bookmark.textTruncated == true, let url = bookmark.originalURL {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("X supplied only a preview of this post.")
                            .font(.callout).foregroundStyle(.secondary)
                        Link("Read the full post on X", destination: url)
                    }
                }
                if !bookmark.linkedPages.isEmpty {
                    BookmarkLinksView(links: bookmark.linkedPages)
                }
                if let content = bookmark.content, !content.isEmpty {
                    Button {
                        reader = ReaderItem(title: bookmark.title, content: content,
                                            format: bookmark.readerFormat, url: bookmark.readerURL)
                    } label: {
                        Label(bookmark.link?.kind == "video" ? "Read transcript" : "Read saved article", systemImage: "doc.richtext")
                            .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.glassProminent).controlSize(.large)
                    .accessibilityIdentifier("readSavedContent")
                }
                if appearance.detailShowsTags, !bookmark.tags.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Tags").font(.headline)
                        Text(bookmark.tags.map { "#\($0)" }.joined(separator: "  "))
                            .font(.subheadline).foregroundStyle(.tint).textSelection(.enabled)
                    }
                }
                if appearance.detailShowsNotes, let notes = bookmark.notes, !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Your notes", systemImage: "note.text").font(.headline)
                        Text(notes).textSelection(.enabled)
                    }
                    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20))
                }
                if let error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error).font(.callout).foregroundStyle(.secondary)
                        Button("Reload bookmark") { Task { await load() } }
                    }
                }
                HStack {
                    Label(bookmark.readAt == nil ? "In your saves" : "In your archive",
                          systemImage: bookmark.readAt == nil ? "bookmark" : "checkmark.circle")
                        .font(.footnote).foregroundStyle(.secondary)
                    Spacer()
                }
            }
            .padding(24).frame(maxWidth: 720).frame(maxWidth: .infinity)
        }
        .background(Color(.systemBackground))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let url = bookmark.originalURL {
                    ShareLink(item: url, subject: Text(bookmark.title)) {
                        Label("Share bookmark", systemImage: "square.and.arrow.up")
                    }
                    .accessibilityIdentifier("shareBookmark")
                } else {
                    ShareLink(item: bookmark.text) { Label("Share bookmark text", systemImage: "square.and.arrow.up") }
                }
                Menu {
                    if let url = bookmark.originalURL {
                        Link(destination: url) { Label("Open original in Safari", systemImage: "safari") }
                    }
                    Button {
                        Task { await toggleRead() }
                    } label: {
                        Label(bookmark.readAt == nil ? "Move to archive" : "Move to saves",
                              systemImage: bookmark.readAt == nil ? "archivebox" : "bookmark")
                    }
                    .disabled(isUpdating)
                } label: {
                    Label("Bookmark actions", systemImage: "ellipsis")
                }
            }
        }
        .sheet(item: $reader) { ReaderView(item: $0) }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do { bookmark = try await client.bookmark(id: bookmark.id) }
        catch { if !Task.isCancelled { self.error = session.handle(error) } }
    }

    private func toggleRead() async {
        isUpdating = true
        error = nil
        defer { isUpdating = false }
        do {
            let read = bookmark.readAt == nil
            try await client.setRead(read, id: bookmark.id)
            bookmark.readAt = read ? Date().ISO8601Format() : nil
            session.changeRevision += 1
        } catch { self.error = session.handle(error) }
    }
}
