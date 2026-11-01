import SwiftUI
import ImageIO

struct ServerImage: View {
    let path: String
    let client: ArchiveClient
    let alt: String
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        GeometryReader { geometry in
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Rectangle().fill(Color(.secondarySystemBackground))
                        .overlay {
                            if failed {
                                Label("Preview unavailable", systemImage: "photo")
                                    .font(.caption).foregroundStyle(.secondary)
                            } else { ProgressView().controlSize(.small) }
                        }
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .accessibilityLabel(alt)
        .task(id: path) {
            image = nil
            failed = false
            do {
                let data = try await client.image(path: path)
                // Decode large archived images away from the main actor and cap memory use.
                let decoded = await Task.detached(priority: .utility) {
                    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                          let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                            kCGImageSourceCreateThumbnailFromImageAlways: true,
                            kCGImageSourceThumbnailMaxPixelSize: 1200,
                            kCGImageSourceCreateThumbnailWithTransform: true
                          ] as CFDictionary) else { return nil as UIImage? }
                    return UIImage(cgImage: thumbnail)
                }.value
                try Task.checkCancellation()
                image = decoded
                failed = decoded == nil
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }
}
