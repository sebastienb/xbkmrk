import SwiftUI

struct BookmarkVideoPreview: View {
    let bookmark: Bookmark
    let client: ArchiveClient
    @Environment(AppSession.self) private var session

    var body: some View {
        if case .server(let path, _) = bookmark.videos.first {
            ServerVideoThumbnail(path: path, client: client, store: session.videoThumbnails)
                .accessibilityLabel("Video preview of \(bookmark.title)")
        } else if let path = bookmark.thumbnailPath {
            ServerImage(path: path, client: client, alt: "Preview of \(bookmark.title)")
        } else {
            Rectangle().fill(Color(.secondarySystemBackground))
        }
    }
}

struct ServerVideoThumbnail: View {
    let path: String
    let client: ArchiveClient
    let store: VideoThumbnailStore
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        GeometryReader { geometry in
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Rectangle().fill(Color(.secondarySystemBackground))
                        .overlay(alignment: .bottomLeading) {
                            if failed {
                                Label("Preview unavailable", systemImage: "photo")
                                    .font(.caption).foregroundStyle(.secondary).padding(12)
                            } else {
                                ProgressView().controlSize(.small).padding(12)
                            }
                        }
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height).clipped()
        }
        .task(id: "\(client.mediaCacheID):\(path)") {
            image = nil
            failed = false
            do { image = try await store.image(path: path, client: client) }
            catch { if !Task.isCancelled { failed = true } }
        }
    }
}
