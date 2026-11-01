import SwiftUI
import UniformTypeIdentifiers

enum SaveSetupKind {
    case bookmarklet, shortcut

    var title: String { self == .bookmarklet ? "Browser bookmarklet" : "iOS Shortcut" }
}

struct SaveSetupView: View {
    let kind: SaveSetupKind
    let client: ArchiveClient
    @Environment(AppSession.self) private var session
    @State private var instructions: SaveInstructions?
    @State private var error: String?
    @State private var retry = 0

    var body: some View {
        Form {
            Section {
                Text(kind == .bookmarklet
                     ? "Save the page you’re reading from a Safari bookmark. Select text first to save a quote with it."
                     : "Add Save to Archive to the share sheet, then save a page from Safari or a link from another app.")
                if let server = session.connectedURL {
                    LabeledContent("Server", value: server.absoluteString)
                        .font(.footnote)
                }
            } footer: {
                Text("Your device must be able to reach this server over Wi-Fi or Tailscale. Re-create your saving tools if you change servers.")
            }

            if let instructions {
                if kind == .bookmarklet {
                    bookmarkletSections(instructions)
                } else {
                    shortcutSections(instructions)
                }
            } else {
                Section {
                    if let error {
                        Text(error).foregroundStyle(.secondary)
                        Button("Try again") { retry += 1 }
                    } else {
                        ProgressView("Preparing your save tools…")
                    }
                }
            }
        }
        .navigationTitle(kind.title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: retry) {
            error = nil
            do {
                let loaded = try await client.saveInstructions()
                try Task.checkCancellation()
                instructions = loaded
            } catch {
                if !Task.isCancelled { self.error = session.handle(error) }
            }
        }
    }

    private func bookmarkletSections(_ instructions: SaveInstructions) -> some View {
        Group {
            Section {
                SaveCodeCopyButton("Copy bookmarklet code", text: instructions.bookmarklet)
                    .accessibilityIdentifier("copyBookmarklet")
            } footer: {
                Text("The code includes your private save token. Keep it private, just like a password.")
            }
            Section("Set up in Safari") {
                SetupStep(number: 1, title: "Create a bookmark",
                          detail: "In Safari, open any webpage, tap Share, then Add Bookmark. Name it Save to Archive and save it in Favorites.")
                SetupStep(number: 2, title: "Replace its address",
                          detail: "Copy the bookmarklet code above. In Safari’s bookmarks, edit Save to Archive, clear its address, and paste the entire code, including javascript:. Save your changes.")
                SetupStep(number: 3, title: "Save a page",
                          detail: "Visit a page you want to keep, then open Favorites and tap Save to Archive. A small page confirms the save; the server extracts its content, image, and tags.")
            }
        }
    }

    private func shortcutSections(_ instructions: SaveInstructions) -> some View {
        Group {
            Section {
                SaveCodeCopyButton("Copy AI prompt", text: instructions.shortcutPrompt)
                    .accessibilityIdentifier("copyShortcutPrompt")
                Link(destination: URL(string: "shortcuts://create-shortcut")!) {
                    Label("Open Shortcuts", systemImage: "arrow.up.forward.app")
                }
            } header: {
                Text("Create with Apple Intelligence")
            } footer: {
                Text("Copy the prompt, open Shortcuts, and paste it into Describe a Shortcut. This requires iOS 27 or iPadOS 27 with Apple Intelligence enabled. If that option isn’t available, use the manual steps below.")
            }
            Section {
                SaveCodeCopyButton("Copy save URL", text: instructions.saveURL.absoluteString)
                    .accessibilityIdentifier("copySaveURL")
            } footer: {
                Text("The prompt and save URL include your private save token. Keep them private, just like a password.")
            }
            Section("Set up manually") {
                SetupStep(number: 1, title: "Create a shortcut",
                          detail: "In Shortcuts, tap + and name the shortcut Save to Archive.")
                SetupStep(number: 2, title: "Enable the share sheet",
                          detail: "Open the shortcut’s details and turn on Show in Share Sheet. Set its accepted input types to URLs and Safari Web Pages.")
                SetupStep(number: 3, title: "Add the save action",
                          detail: "Add Get Contents of URL. Copy the save URL above and paste it into the action’s URL field.")
                SetupStep(number: 4, title: "Send the shared link",
                          detail: "Expand the action’s options. Set Method to POST and Request Body to JSON. Add a Text field with the key url, and set its value to the Shortcut Input variable.")
                SetupStep(number: 5, title: "Try it from Safari",
                          detail: "Open a page, tap Share, then Save to Archive. Allow the shortcut to connect to your server when asked. Your page will appear in Saves.")
            }
            Section {
                Link("Apple’s Shortcuts setup guide", destination: URL(string: "https://support.apple.com/guide/shortcuts/apd84c576f8c/ios")!)
            }
        }
    }
}

private struct SetupStep: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(number). \(title)").font(.headline)
            Text(detail).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct SaveCodeCopyButton: View {
    let title: String
    let text: String
    @State private var copied = false

    init(_ title: String, text: String) {
        self.title = title
        self.text = text
    }

    var body: some View {
        Button {
            UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: text]],
                                         options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(900)])
            copied = true
        } label: {
            Label(copied ? "Copied" : title, systemImage: copied ? "checkmark" : "doc.on.doc")
        }
        .sensoryFeedback(.success, trigger: copied)
    }
}
