import AVFoundation
import UniformTypeIdentifiers

/// Passes HTTP byte ranges directly to AVFoundation. There is no download task,
/// file writer, persistent cache, or complete-file Data buffer in this path.
/// Both delegate queues are main, matching the player owner's isolation.
@MainActor
final class VideoStreamLoader: NSObject, @preconcurrency AVAssetResourceLoaderDelegate,
                               @preconcurrency URLSessionDataDelegate {
    private struct Transfer {
        let loading: AVAssetResourceLoadingRequest
        let task: URLSessionDataTask
        let offset: Int64
        var expectedBytes: Int64 = 0
        var receivedBytes: Int64 = 0
    }

    let asset: AVURLAsset
    private let request: URLRequest
    private var transfers: [Int: Transfer] = [:]
    private var session: URLSession!
    private let byteLimit: Int?
    private var receivedBytes = 0
    private var isStopped = false
    private(set) var failure: String?

    init(request: URLRequest, byteLimit: Int? = nil) {
        self.request = request
        self.byteLimit = byteLimit
        // An opaque URL ensures AVFoundation cannot make unauthenticated HTTP
        // requests or use a disk cache behind the loader.
        asset = AVURLAsset(url: URL(string: "xbkmrk-stream://video/\(UUID().uuidString).mp4")!)
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        asset.resourceLoader.setDelegate(self, queue: .main)
    }

    func stop() {
        guard !isStopped else { return }
        isStopped = true
        asset.resourceLoader.setDelegate(nil, queue: nil)
        let pending = transfers.values
        transfers.removeAll()
        for transfer in pending {
            transfer.task.cancel()
            transfer.loading.finishLoading(with: CancellationError())
        }
        session.invalidateAndCancel()
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        guard !isStopped else { return false }
        let data = loadingRequest.dataRequest
        let start = max(data?.currentOffset ?? 0, data?.requestedOffset ?? 0)
        var ranged = request
        if let data, !data.requestsAllDataToEndOfResource {
            let end = data.requestedOffset + Int64(data.requestedLength) - 1
            ranged.setValue("bytes=\(start)-\(max(start, end))", forHTTPHeaderField: "Range")
        } else {
            ranged.setValue(data == nil ? "bytes=0-1" : "bytes=\(start)-", forHTTPHeaderField: "Range")
        }
        let task = session.dataTask(with: ranged)
        transfers[task.taskIdentifier] = Transfer(loading: loadingRequest, task: task, offset: start)
        task.resume()
        return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        guard let key = transfers.first(where: { $0.value.loading === loadingRequest })?.key else { return }
        transfers.removeValue(forKey: key)?.task.cancel()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        // A saved path can never forward the archive's session to another host.
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        guard var transfer = transfers[dataTask.taskIdentifier] else { completionHandler(.cancel); return }
        guard let http = response as? HTTPURLResponse else {
            fail(dataTask, "The server returned an invalid video response.")
            completionHandler(.cancel)
            return
        }
        guard http.statusCode == 206,
              let range = Self.contentRange(http.value(forHTTPHeaderField: "Content-Range")),
              range.start == transfer.offset else {
            let message: String
            switch http.statusCode {
            case 401, 403: message = "Your server session has expired. Reconnect in Settings to play this video."
            case 404: message = "This video is no longer on your server. You can open the original post."
            case 300..<400: message = "The video address redirects. Check your server address in Settings."
            default: message = "Your server could not stream this video. It must support HTTP byte ranges."
            }
            fail(dataTask, message)
            completionHandler(.cancel)
            return
        }
        let info = transfer.loading.contentInformationRequest
        info?.contentType = UTType.mpeg4Movie.identifier
        info?.contentLength = range.total
        info?.isByteRangeAccessSupported = true
        transfer.expectedBytes = range.end - range.start + 1
        transfers[dataTask.taskIdentifier] = transfer
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard var transfer = transfers[dataTask.taskIdentifier] else { return }
        receivedBytes += data.count
        if let byteLimit, receivedBytes > byteLimit {
            failure = "A preview could not be generated within the video preview data limit."
            stop()
            return
        }
        transfer.receivedBytes += Int64(data.count)
        guard transfer.receivedBytes <= transfer.expectedBytes else {
            fail(dataTask, "The server returned an invalid video range.")
            return
        }
        transfer.loading.dataRequest?.respond(with: data)
        transfers[dataTask.taskIdentifier] = transfer
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let transfer = transfers.removeValue(forKey: task.taskIdentifier) else { return }
        if let error {
            failure = "The video connection was interrupted. Check your connection and try again."
            transfer.loading.finishLoading(with: error)
        } else if transfer.receivedBytes != transfer.expectedBytes {
            failure = "The video stream ended unexpectedly. Try again."
            transfer.loading.finishLoading(with: ArchiveError.message(failure!))
        } else {
            transfer.loading.finishLoading()
        }
    }

    private func fail(_ task: URLSessionTask, _ message: String) {
        failure = message
        transfers.removeValue(forKey: task.taskIdentifier)?.loading.finishLoading(with: ArchiveError.message(message))
        task.cancel()
    }

    nonisolated static func contentRange(_ header: String?) -> (start: Int64, end: Int64, total: Int64)? {
        guard let header, header.hasPrefix("bytes ") else { return nil }
        let parts = header.dropFirst(6).split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        let bounds = parts[0].split(separator: "-", omittingEmptySubsequences: false)
        guard bounds.count == 2, let start = Int64(bounds[0]), let end = Int64(bounds[1]),
              let total = Int64(parts[1]), start >= 0, end >= start, total > end else { return nil }
        return (start, end, total)
    }
}
