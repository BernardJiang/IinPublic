import Foundation
import Security
import WebKit

/// Password-free identity custody in the Apple Keychain.
///
/// The SEA pair is stored as one generic-password item, accessible after first unlock, this device
/// only (never synced to iCloud). Secure Enclave is intentionally not claimed: it cannot wrap the
/// arbitrary secp256k1/AES material SEA uses, so `hardwareBacked` is reported as unknown (null).
final class AppleCustodyBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let scriptName = "iinpublicCustody"
    private static let service = "app.iinpublic.identity-custody-v3"
    private static let account = "sea-pair"

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            return replyHandler(nil, "invalid-message")
        }
        switch op {
        case "describe":
            replyHandler(["version": 1, "provider": "apple-keychain", "available": true, "hardwareBacked": NSNull()], nil)
        case "read":
            do { replyHandler(["pair": try readPair() ?? NSNull()], nil) } catch { replyHandler(nil, "read-failed") }
        case "write":
            guard let pair = body["pair"] as? [String: String], Self.isValid(pair) else { return replyHandler(nil, "invalid-pair") }
            do {
                try writePair(pair)
                let back = try readPair()
                replyHandler(back == pair ? ["ok": true] : ["ok": false], nil)
            } catch { replyHandler(["ok": false], nil) }
        case "remove":
            guard let pub = body["pub"] as? String, let epub = body["epub"] as? String else { return replyHandler(nil, "invalid-message") }
            do {
                guard let stored = try readPair() else { return replyHandler(["ok": true], nil) }
                guard stored["pub"] == pub, stored["epub"] == epub else { return replyHandler(["ok": false], nil) }
                replyHandler(["ok": SecItemDelete(baseQuery() as CFDictionary) == errSecSuccess], nil)
            } catch { replyHandler(["ok": false], nil) }
        default:
            replyHandler(nil, "unknown-op")
        }
    }

    private static func isValid(_ pair: [String: String]) -> Bool {
        ["pub", "epub", "priv", "epriv"].allSatisfy { !(pair[$0] ?? "").isEmpty }
    }

    private func baseQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Self.service,
         kSecAttrAccount as String: Self.account]
    }

    private func readPair() throws -> [String: String]? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let pair = try JSONSerialization.jsonObject(with: data) as? [String: String], Self.isValid(pair) else {
            throw NSError(domain: "AppleCustody", code: Int(status))
        }
        return pair
    }

    private func writePair(_ pair: [String: String]) throws {
        let data = try JSONSerialization.data(withJSONObject: pair, options: [.sortedKeys])
        var attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(baseQuery() as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            attrs.merge(baseQuery()) { $1 }
            status = SecItemAdd(attrs as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw NSError(domain: "AppleCustody", code: Int(status)) }
    }
}
