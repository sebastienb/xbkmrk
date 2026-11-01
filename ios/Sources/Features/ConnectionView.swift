import SwiftUI

struct ConnectionView: View {
    @Environment(AppSession.self) private var session
    @State private var password = ""
    @FocusState private var focus: Field?
    private enum Field { case server, password }

    var body: some View {
        @Bindable var session = session
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 30) {
                    VStack(alignment: .leading, spacing: 18) {
                        Image(systemName: "bookmark.fill")
                            .font(.system(size: 36, weight: .medium))
                            .foregroundStyle(.tint)
                            .frame(width: 80, height: 80)
                            .glassEffect(.regular, in: .rect(cornerRadius: 26))
                        Text("Your bookmarks.\nYour server.")
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        Text("A little space for everything worth coming back to.")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 30)

                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Server address").font(.subheadline.weight(.semibold))
                            TextField("https://bookmarks.example.com", text: $session.serverAddress)
                                .keyboardType(.URL)
                                .textContentType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .submitLabel(.next)
                                .focused($focus, equals: .server)
                                .onSubmit { focus = .password }
                                .accessibilityIdentifier("serverAddress")
                                .padding(16)
                                .background(.background, in: .rect(cornerRadius: 16))
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Site password").font(.subheadline.weight(.semibold))
                            SecureField("Your existing xbkmrk password", text: $password)
                                .textContentType(.password)
                                .submitLabel(.go)
                                .focused($focus, equals: .password)
                                .onSubmit { connect() }
                                .accessibilityIdentifier("sitePassword")
                                .padding(16)
                                .background(.background, in: .rect(cornerRadius: 16))
                        }
                        if session.serverAddress.lowercased().hasPrefix("http://") {
                            Label("HTTP sends your password over an unencrypted connection. Use it only on a trusted local network.", systemImage: "lock.open")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        if let error = session.error {
                            Label(error, systemImage: "exclamationmark.circle")
                                .font(.callout).foregroundStyle(.red)
                                .accessibilityIdentifier("connectionError")
                        }
                        Button(action: connect) {
                            HStack {
                                if session.isConnecting { ProgressView().tint(.white) }
                                Text(session.isConnecting ? "Connecting…" : "Connect to server")
                                Spacer()
                                Image(systemName: "arrow.right")
                            }
                            .font(.headline).padding(.vertical, 10)
                        }
                        .buttonStyle(.glassProminent)
                        .controlSize(.large)
                        .disabled(session.isConnecting || password.isEmpty || session.serverAddress.isEmpty)
                        .accessibilityIdentifier("connectServer")
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Made for your own archive", systemImage: "externaldrive.connected.to.line.below")
                            .font(.subheadline.weight(.medium))
                        Text("Use your server’s web address. For a private Tailscale address, connect Tailscale on your device first. Your password is never saved.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: 500)
                .padding(.horizontal, 24).padding(.bottom, 40)
                .frame(maxWidth: .infinity)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("xbkmrk")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func connect() {
        guard !password.isEmpty, !session.isConnecting else { return }
        focus = nil
        Task {
            if await session.connect(password: password) { password = "" }
        }
    }
}

#Preview { ConnectionView().environment(AppSession()) }
