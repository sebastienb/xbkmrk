import AVKit
import SwiftUI

/// Opening a player is the only action that creates a video network request.
struct VideoLauncher<Content: View>: View {
    let bookmark: Bookmark
    let client: ArchiveClient
    @ViewBuilder let content: () -> Content
    @State private var selection: BookmarkVideo?

    var body: some View {
        Button { selection = bookmark.videos.first } label: { content() }
            .accessibilityLabel("Play video: \(bookmark.title)")
            .fullScreenCover(item: $selection) { video in
                VideoPlayerScreen(bookmark: bookmark, client: client, initialVideo: video)
            }
    }
}

private struct VideoPlayerScreen: View {
    let bookmark: Bookmark
    let client: ArchiveClient
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var selected: BookmarkVideo
    @State private var isPlaying = true

    init(bookmark: Bookmark, client: ArchiveClient, initialVideo: BookmarkVideo) {
        self.bookmark = bookmark
        self.client = client
        _selected = State(initialValue: initialVideo)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text(bookmark.title).font(.headline).lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20)
                if bookmark.videos.count > 1 {
                    Picker("Video", selection: $selected) {
                        ForEach(Array(bookmark.videos.enumerated()), id: \.element.id) { index, video in
                            Text("Video \(index + 1)").tag(video)
                        }
                    }
                    .pickerStyle(.menu)
                }
                if isPlaying {
                    switch selected {
                    case .server(let path, let animated):
                        NativeStreamView(path: path, animated: animated, client: client).id(selected.id)
                    case .youtube(let id):
                        YouTubePlayerView(videoID: id).id(selected.id)
                    }
                } else {
                    ContentUnavailableView {
                        Label("Playback paused", systemImage: "pause.circle")
                    } actions: {
                        Button("Resume video") { isPlaying = true }.buttonStyle(.glassProminent)
                    }
                }
            }
            .background(.black)
            .navigationTitle("Video")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close", systemImage: "xmark") { isPlaying = false; dismiss() }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if let url = bookmark.originalURL {
                        ShareLink(item: url, subject: Text(bookmark.title)) {
                            Label("Share bookmark", systemImage: "square.and.arrow.up")
                        }
                        Link(destination: url) { Label("Open original", systemImage: "arrow.up.right") }
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .onChange(of: scenePhase) { _, phase in
            // Destroy the stream in the background; returning requires a tap.
            if phase == .background { isPlaying = false }
        }
    }
}

private struct NativeStreamView: View {
    let path: String
    let animated: Bool
    let client: ArchiveClient
    @State private var playback = NativeVideoPlayback()
    @State private var attempt = 0

    var body: some View {
        ZStack {
            if let error = playback.error {
                ContentUnavailableView {
                    Label("Video unavailable", systemImage: "video.slash")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try again") { attempt += 1 }.buttonStyle(.glassProminent)
                }
            } else {
                if let player = playback.player { NativePlayerController(player: player) }
                if playback.isLoading { ProgressView("Connecting to video…") }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: attempt) { await playback.start(path: path, muted: animated, client: client) }
        .onDisappear { playback.stop() }
    }
}

@MainActor @Observable
private final class NativeVideoPlayback {
    var player: AVPlayer?
    var error: String?
    var isLoading = true
    private var loader: VideoStreamLoader?
    private var statusObservation: NSKeyValueObservation?

    func start(path: String, muted: Bool, client: ArchiveClient) async {
        stop()
        error = nil
        isLoading = true
        do {
            let request = try await client.videoRequest(path: path)
            try Task.checkCancellation()
            let loader = VideoStreamLoader(request: request)
            self.loader = loader
            let item = AVPlayerItem(asset: loader.asset)
            item.preferredForwardBufferDuration = 5
            item.canUseNetworkResourcesForLiveStreamingWhilePaused = false
            let player = AVPlayer(playerItem: item)
            player.isMuted = muted
            self.player = player
            statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    switch self.player?.currentItem?.status {
                    case .readyToPlay: self.isLoading = false
                    case .failed:
                        let message = self.loader?.failure ?? "This video could not be played. Try again or open the original."
                        self.stop()
                        self.error = message
                        self.isLoading = false
                    default: break
                    }
                }
            }
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try AVAudioSession.sharedInstance().setActive(true)
            player.play()
        } catch {
            stop()
            if !Task.isCancelled { self.error = error.localizedDescription; isLoading = false }
        }
    }

    func stop() {
        statusObservation = nil
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        loader?.stop()
        loader = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

private struct NativePlayerController: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.allowsPictureInPicturePlayback = false
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        controller.player = player
    }

    static func dismantleUIViewController(_ controller: AVPlayerViewController, coordinator: ()) {
        controller.player?.pause()
        controller.player = nil
    }
}
