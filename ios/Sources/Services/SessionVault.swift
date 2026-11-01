import Foundation
import Security

struct SavedSession: Codable {
    let server: URL
    let cookie: SessionCookie
}

@MainActor enum SessionVault {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "net.3sparks.xbkmrk.session",
        kSecAttrAccount as String: "current-server"
    ]

    static func load() -> SavedSession? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(SavedSession.self, from: data)
    }

    static func save(_ saved: SavedSession) throws {
        let data = try JSONEncoder().encode(saved)
        var attributes: [String: Any] = [kSecValueData as String: data]
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes, uniquingKeysWith: { _, new in new }) as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            throw ArchiveError.message("Could not save the session securely in Keychain (\(status)).")
        }
    }

    static func clear() { SecItemDelete(query as CFDictionary) }
}
