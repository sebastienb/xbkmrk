import SwiftUI
import WebKit

struct ReaderItem: Identifiable {
    let id = UUID()
    let title: String
    let content: String
    let format: ReaderContentFormat
    let url: URL?
}

struct ReaderView: View {
    let item: ReaderItem
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if item.format != .html {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            Text(item.title).font(.system(.title, design: .serif, weight: .bold))
                            Text(item.format == .markdown ? markdown : LinkedPostText.attributed(item.content))
                                .lineLimit(nil).fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled).lineSpacing(5)
                                .accessibilityIdentifier("savedReaderText")
                        }
                        .frame(maxWidth: 680, alignment: .leading).padding(24).frame(maxWidth: .infinity)
                    }
                } else {
                    ArticleWebView(content: item.content, baseURL: item.url)
                }
            }
            .navigationTitle("Reader").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
                if let url = item.url {
                    ToolbarItem(placement: .topBarLeading) {
                        ShareLink(item: url, subject: Text(item.title)) { Label("Share", systemImage: "square.and.arrow.up") }
                    }
                }
            }
        }
    }

    private var markdown: AttributedString {
        (try? AttributedString(markdown: item.content, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace), baseURL: item.url)) ?? AttributedString(item.content)
    }
}

private struct ArticleWebView: UIViewRepresentable {
    let content: String
    let baseURL: URL?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let size = UIFont.preferredFont(forTextStyle: .body).pointSize
        let html = """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
        <style>
        :root { color-scheme: light dark; }
        body { font: \(size)px/1.7 -apple-system, system-ui; margin: 24px auto; padding: 0 24px 40px; max-width: 680px; overflow-wrap: anywhere; }
        h1,h2,h3 { font-family: Georgia,serif; line-height: 1.25; }
        img,video,iframe,svg { max-width: 100%; height: auto; border-radius: 12px; }
        a { color: #6576ed; } pre { overflow-x: auto; padding: 16px; background: light-dark(#f3f3f6,#202025); border-radius: 12px; }
        blockquote { border-left: 3px solid #6576ed; padding-left: 18px; margin-left: 0; }
        table { display: block; overflow-x: auto; } td,th { padding: 8px; }
        </style></head><body>\(content)</body></html>
        """
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        context.coordinator.isLoadingDocument = true
        view.loadHTMLString(html, baseURL: baseURL)
    }

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedHTML: String?
        var isLoadingDocument = false

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            if action.navigationType == .linkActivated {
                if let url = action.request.url, Bookmark.webURL(url.absoluteString) != nil {
                    await UIApplication.shared.open(url)
                }
                return .cancel
            } else if action.navigationType == .other, isLoadingDocument {
                // loadHTMLString reports the supplied base URL for its initial navigation.
                // Allow that one document; subsequent unsolicited navigations stay blocked.
                isLoadingDocument = false
                return .allow
            } else {
                return .cancel
            }
        }
    }
}
