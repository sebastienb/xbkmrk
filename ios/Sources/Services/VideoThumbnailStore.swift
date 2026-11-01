import AVFoundation
import UIKit

/// Session-owned, bounded image cache. Only a still frame is retained, in memory.
/// Image generation uses the same authenticated, uncached range transport as
/// playback, with a byte budget and deadline instead of an AVPlayer.
@MainActor
final class VideoThumbnailStore {
    private let cache = NSCache<NSString, UIImage>()
    private var generation = 0

    init() {
        cache.countLimit = 60
        cache.totalCostLimit = 24 * 1024 * 1024
    }

    func clear() {
        generation += 1
        cache.removeAllObjects()
    }

    func image(path: String, client: ArchiveClient) async throws -> UIImage {
        try Task.checkCancellation()
        let key = "\(client.mediaCacheID):\(path)" as NSString
        if let image = cache.object(forKey: key) { return image }
        let currentGeneration = generation
        let request = try await client.videoRequest(path: path)
        try Task.checkCancellation()
        let job = ThumbnailGeneration(request: request)
        let deadline = Task {
            do { try await Task.sleep(for: .seconds(10)) }
            catch { return }
            job.stop()
        }
        defer {
            deadline.cancel()
            job.stop()
        }
        let result = try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await job.image()
        } onCancel: {
            Task { @MainActor in job.stop() }
        }
        try Task.checkCancellation()
        guard generation == currentGeneration else { throw CancellationError() }
        let image = UIImage(cgImage: result)
        cache.setObject(image, forKey: key, cost: result.bytesPerRow * result.height)
        return image
    }
}

/// Confine the non-Sendable AVAssetImageGenerator and its cancellation to one
/// actor. Its callback API performs decoding asynchronously without sending
/// the mutable generator across actor boundaries.
@MainActor
private final class ThumbnailGeneration {
    private let loader: VideoStreamLoader
    private let generator: AVAssetImageGenerator
    private var stopped = false

    init(request: URLRequest) {
        loader = VideoStreamLoader(request: request, byteLimit: 3 * 1024 * 1024)
        generator = AVAssetImageGenerator(asset: loader.asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 800, height: 800)
        generator.requestedTimeToleranceBefore = .positiveInfinity
        generator.requestedTimeToleranceAfter = .positiveInfinity
    }

    func image() async throws -> CGImage {
        guard !stopped else { throw CancellationError() }
        return try await withCheckedThrowingContinuation { continuation in
            generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: CMTime(seconds: 0.1, preferredTimescale: 600))]) {
                _, image, _, _, error in
                if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: error ?? ArchiveError.message("Video preview unavailable.")) }
            }
        }
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        generator.cancelAllCGImageGeneration()
        loader.stop()
    }
}
