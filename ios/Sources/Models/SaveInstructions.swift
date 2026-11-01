import Foundation

/// Uses the same save endpoint and token as the web app. Never includes the login cookie.
struct SaveInstructions: Sendable {
    let saveURL: URL
    let bookmarklet: String

    init(server: URL, token: String) throws {
        guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ArchiveError.message("The server did not return a save token. Try again.")
        }
        guard var parts = URLComponents(url: server.appending(path: "api/save"), resolvingAgainstBaseURL: false) else {
            throw ArchiveError.message("Could not create the save URL.")
        }
        parts.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = parts.url else { throw ArchiveError.message("Could not create the save URL.") }
        saveURL = url
        // Encode as a JavaScript string literal, including unusual server paths or token characters.
        let endpoint = String(decoding: try JSONEncoder().encode(url.absoluteString), as: UTF8.self)
        bookmarklet = "javascript:(()=>{var s=String(window.getSelection?window.getSelection():'').slice(0,1500),"
            + "u=\(endpoint)+'&url='+encodeURIComponent(location.href)"
            + "+'&title='+encodeURIComponent(document.title.slice(0,300))"
            + "+(s?'&sel='+encodeURIComponent(s):'');"
            + "window.open(u,'xbmsave','width=420,height=260')})()"
    }

    var shortcutPrompt: String {
        """
        Create a shortcut named "Save to Archive".

        It is a Share Sheet shortcut: turn on "Show in Share Sheet" and accept URLs and Safari web pages as input.

        It has a single action, "Get Contents of URL", configured as:
        - URL: \(saveURL.absoluteString)
        - Method: POST
        - Request Body: JSON, with exactly one field — key "url", value set to the Shortcut Input variable.

        No other actions are needed and it should not display any output. When I share a page from Safari (or a link from any app) and pick "Save to Archive", the shortcut sends that page's URL to my personal bookmark archive, which saves it.
        """
    }
}
