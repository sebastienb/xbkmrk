import SwiftUI
import WebKit

struct YouTubePlayerView: View {
    let videoID: String
    @State private var error: String?
    @State private var attempt = 0

    var body: some View {
        VStack(spacing: 12) {
            YouTubeWebPlayer(videoID: videoID, error: $error).id(attempt)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if let error {
                Text(error).font(.callout).foregroundStyle(.secondary).padding(.horizontal)
                Button("Try again") { self.error = nil; attempt += 1 }
                    .buttonStyle(.glass).padding(.bottom)
            }
        }
    }
}

/// YouTube owns playback, buffering, captions, and its controls. This ephemeral
/// web view never receives the private archive's URL or session cookie.
private struct YouTubeWebPlayer: UIViewRepresentable {
    let videoID: String
    @Binding var error: String?

    func makeCoordinator() -> Coordinator { Coordinator(error: $error) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = false
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(context.coordinator, name: "playback")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.navigationDelegate = context.coordinator
        // YouTube requires the installed app's bundle ID as the embed identity.
        let origin = "https://\((Bundle.main.bundleIdentifier ?? "net.3sparks.xbkmrk").lowercased())"
        let html = """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="referrer" content="strict-origin-when-cross-origin">
        <style>html,body{margin:0;width:100%;height:100%;background:#000}#player{width:100%;height:100%}</style>
        </head><body><div id="player"></div>
        <script src="https://www.youtube.com/iframe_api"></script>
        <script>
        var player;
        function onYouTubeIframeAPIReady(){
          player=new YT.Player('player',{
            host:'https://www.youtube-nocookie.com',videoId:'\(videoID)',
            playerVars:{playsinline:1,origin:'\(origin)'},
            events:{onReady:function(e){e.target.playVideo()},
              onError:function(e){window.webkit.messageHandlers.playback.postMessage(e.data)}}
          });
        }
        </script></body></html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: origin))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) { }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "playback")
        webView.navigationDelegate = nil
        webView.loadHTMLString("", baseURL: nil)
    }

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        @Binding var error: String?
        private var hasLoadedDocument = false

        init(error: Binding<String?>) { _error = error }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let code = message.body as? Int else { return }
            switch code {
            case 100: error = "This YouTube video is private or no longer available."
            case 101, 150: error = "The creator only allows this video to play on YouTube. Use Open original above."
            default: error = "YouTube could not play this video. Try again or use Open original above."
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            if action.navigationType == .linkActivated {
                if let url = action.request.url, Bookmark.webURL(url.absoluteString) != nil {
                    await UIApplication.shared.open(url)
                }
                return .cancel
            } else if action.targetFrame?.isMainFrame == false {
                return action.request.url?.scheme == "https" ? .allow : .cancel
            } else if !hasLoadedDocument, action.navigationType == .other {
                hasLoadedDocument = true
                return .allow
            } else {
                return .cancel
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
            self.error = "Could not connect to YouTube. Check your connection and try again."
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            error = "The video player stopped. Tap Try again to reconnect."
        }
    }
}
