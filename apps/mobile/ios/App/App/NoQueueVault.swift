import Capacitor
import Security

/// A single, device-only Keychain record. No cloud sync or plaintext fallback.
@objc(NoQueueVaultPlugin)
public class NoQueueVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NoQueueVaultPlugin"
    public let jsName = "NoQueueVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.noqueue.installation.v1",
         kSecAttrAccount as String: "installation",
         kSecAttrSynchronizable as String: false]
    }
    @objc func read(_ call: CAPPluginCall) {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("Secure installation storage is unavailable"); return
        }
        call.resolve(["value": value])
    }
    @objc func write(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), let data = value.data(using: .utf8),
              data.count <= 65536 else { call.reject("Invalid vault value"); return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { call.reject("Could not save secure installation"); return }
        call.resolve()
    }
}

@objc(NoQueueViewController)
class NoQueueViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NoQueueVaultPlugin())
        // The shared web header is content, not a native translucent toolbar.
        // iOS 26+ otherwise blurs it under the automatic scroll-edge effect.
        if #available(iOS 26.0, *) {
            webView?.scrollView.topEdgeEffect.isHidden = true
            webView?.scrollView.bottomEdgeEffect.isHidden = true
        }
    }
}
