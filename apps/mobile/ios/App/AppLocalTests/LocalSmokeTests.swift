import XCTest
import UIKit
import WebKit
import Security
import CryptoKit

/// Hosted by the real App, but compiled only into the separate simulator test bundle.
/// Run each test in a separate xcodebuild invocation to prove process-death recovery.
@MainActor
final class LocalSmokeTests: XCTestCase {
    private let origin = "https://127.0.0.1:8788"
    private var web: WKWebView!
    private var checkpointURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("noqueue-local-smoke-checkpoint.json")
    }
    private func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func findWebView(_ view: UIView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        return view.subviews.lazy.compactMap { self.findWebView($0) }.first
    }
    private func bootstrap() async throws {
        continueAfterFailure = false
        for _ in 0..<100 {
            web = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }.compactMap { findWebView($0) }.first
            if web != nil { break }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        _ = try XCTUnwrap(web, "App did not create its real WKWebView")
        try await wait("!!window.Capacitor?.Plugins?.NoQueueVault && !!document.querySelector('main')")
        try await navigate("/turns?lang=es")
        try await wait("location.pathname.startsWith('/t/') || document.body.innerText.includes('¿Dónde quieres') || !!document.querySelector('[role=alert]')")
    }
    @discardableResult
    private func js(_ body: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
        try await web.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
    }
    private func wait(_ condition: String) async throws {
        for _ in 0..<100 {
            if (try? await js("return Boolean(\(condition));")) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        // Never include the current URL/body, which could expose a capability.
        XCTFail("Timed out waiting for expected native UI state")
        throw NSError(domain: "NoQueueLocalSmoke", code: 1)
    }
    private func navigate(_ route: String) async throws {
        try await js("history.pushState(null, '', route); window.dispatchEvent(new PopStateEvent('popstate'));", ["route": route])
    }
    private func evidence() async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: origin + "/__local/evidence")!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    private func record() throws -> (secret: String, state: [String: Any]) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.noqueue.installation.v1",
            kSecAttrAccount as String: "installation",
            kSecAttrSynchronizable as String: false,
            kSecReturnAttributes as String: true, kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &result), errSecSuccess)
        let attributes = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(attributes[kSecAttrAccessible as String] as? String,
                       kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
        XCTAssertFalse((attributes[kSecAttrSynchronizable as String] as? Bool) ?? false)
        let data = try XCTUnwrap(attributes[kSecValueData as String] as? Data)
        let state = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let secret = try XCTUnwrap(state["secret"] as? String)
        XCTAssertTrue(secret.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil)
        return (secret, state)
    }
    private func snapshot(_ name: String) async throws {
        let image = try await web.takeSnapshot(configuration: nil)
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    private func interceptMetadata() async throws {
        try await js("""
          window.__iosSmoke = [];
          const original = window.fetch;
          window.fetch = async function(input, init) {
            const response = await original.call(this, input, init);
            if (init?.method === 'POST') {
              const body = JSON.parse(init.body);
              window.__iosSmoke.push({ status: response.status,
                hasPhone: 'phone' in body, hasWhatsApp: 'whatsapp' in body,
                authorization: new Headers(init.headers).has('Authorization') });
            }
            return response;
          };
        """)
    }
    private func verifyNoWhatsApp(_ counts: [String: Int], entries: Int) {
        XCTAssertEqual(counts["queue_entry"], entries)
        XCTAssertEqual(counts["mobile_entry_installation"], entries)
        for table in ["queue_entry_contact", "consent", "notification_outbox"] {
            XCTAssertEqual(counts[table], 0)
        }
    }

    func test01AnonymousAdmissionAndKeychain() async throws {
        try await bootstrap()
        let initial = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(initial["counts"] as? [String: Int]), entries: 0)
        try await wait("document.body.innerText.includes('No tienes turnos activos')")
        let identity = try record()
        let nativeMatches = try await js("return JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value).secret === expected", ["expected": identity.secret])
        XCTAssertTrue(nativeMatches as? Bool == true, "JS plugin must read the actual Keychain record")
        let service = try XCTUnwrap(initial["service"] as? String)
        try await navigate("/q/\(service)?lang=es")
        try await wait("!!document.querySelector('#customer-name')")
        let noPhone = try await js("return !document.querySelector('input[type=tel]') && !document.body.innerText.includes('WhatsApp')")
        XCTAssertTrue(noPhone as? Bool == true)
        try await snapshot("01-mobile-form")
        try await interceptMetadata()
        try await js("""
          const input = document.querySelector('#customer-name');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Prueba iOS local');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        """)
        try await wait("!document.querySelector('button[type=submit]').disabled")
        try await js("document.querySelector('button[type=submit]').click()")
        try await wait("location.pathname.startsWith('/t/') && document.body.innerText.includes('Abandonar la lista')")
        let requestValue = try await js("return window.__iosSmoke")
        let requests = try XCTUnwrap(requestValue as? [[String: Any]])
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?["status"] as? Int, 201)
        XCTAssertTrue(requests.first?["authorization"] as? Bool == true)
        XCTAssertFalse(requests.first?["hasPhone"] as? Bool ?? true)
        XCTAssertFalse(requests.first?["hasWhatsApp"] as? Bool ?? true)
        let turnValue = try await js("return location.pathname")
        let turn = try XCTUnwrap(turnValue as? String)
        let after = try record()
        XCTAssertTrue(after.secret == identity.secret, "Identity must remain stable")
        XCTAssertEqual((after.state["pending"] as? [Any])?.count, 0)
        let checkpoint: [String: Any] = ["identityDigest": digest(identity.secret), "turnDigest": digest(turn),
                                       "pid": ProcessInfo.processInfo.processIdentifier, "service": service]
        try JSONSerialization.data(withJSONObject: checkpoint).write(to: checkpointURL, options: .atomic)
        let database = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(database["counts"] as? [String: Int]), entries: 1)
        try await snapshot("02-active-turn")
    }

    func test02RecoveryAndCancellationAfterRelaunch() async throws {
        try await bootstrap()
        let checkpoint = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: checkpointURL)) as? [String: Any])
        XCTAssertNotEqual(checkpoint["pid"] as? Int, Int(ProcessInfo.processInfo.processIdentifier), "Must run in a fresh app process")
        let identity = try record()
        XCTAssertTrue(digest(identity.secret) == checkpoint["identityDigest"] as? String, "Keychain identity changed across launches")
        try await wait("Array.from(document.querySelectorAll('a')).some(a => a.textContent === 'Abrir turno 1')")
        try await snapshot("03-recovered-turn")
        try await js("Array.from(document.querySelectorAll('a')).find(a => a.textContent === 'Abrir turno 1').click()")
        try await wait("document.body.innerText.includes('Abandonar la lista')")
        let turnValue = try await js("return location.pathname")
        let turn = try XCTUnwrap(turnValue as? String)
        XCTAssertTrue(digest(turn) == checkpoint["turnDigest"] as? String, "Recovered a different ticket")
        let denied = try await js("""
          const token = location.pathname.split('/')[2];
          const other = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
          const read = await fetch(origin + '/api/v1/mobile/entries/' + token, {headers: {Authorization: 'Bearer ' + other}});
          const command = await fetch(origin + '/api/v1/mobile/entries/' + token + '/commands', {method:'POST',headers:{Authorization:'Bearer '+other,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({action:'cancel',version:0})});
          const missing = await fetch(origin + '/api/v1/mobile/entries');
          return [read.status, command.status, missing.status];
        """, ["origin": origin])
        XCTAssertEqual(denied as? [Int], [404, 404, 401])
        try await interceptMetadata()
        try await js("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Abandonar la lista').click()")
        try await wait("Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Sí, abandonar la lista de espera')")
        try await js("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Sí, abandonar la lista de espera').click()")
        try await wait("window.__iosSmoke.some(r => r.status === 200)")
        try await navigate("/turns?lang=es")
        try await wait("document.body.innerText.includes('No tienes turnos activos')")
        let final = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(final["counts"] as? [String: Int]), entries: 1)
        let statuses = try XCTUnwrap(final["statuses"] as? [[String: Any]])
        XCTAssertEqual(statuses.count, 1)
        XCTAssertEqual(statuses[0]["status"] as? String, "cancelled")
        XCTAssertEqual(statuses[0]["n"] as? Int, 1)
        try await snapshot("04-cancelled-empty-list")
    }

    func test03CancelledTicketStaysAbsentAfterRelaunch() async throws {
        try await bootstrap()
        let checkpoint = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: checkpointURL)) as? [String: Any])
        XCTAssertTrue(digest(try record().secret) == checkpoint["identityDigest"] as? String)
        try await wait("document.body.innerText.includes('No tienes turnos activos')")
        let noActiveLink = try await js("return !document.querySelector('a[href^=\"/t/\"]')")
        XCTAssertTrue(noActiveLink as? Bool == true)
        let database = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(database["counts"] as? [String: Int]), entries: 1)
    }

    private func fillAndSubmit(_ service: String) async throws {
        try await navigate("/q/\(service)?lang=es")
        try await wait("!!document.querySelector('#customer-name')")
        try await js("""
          const input = document.querySelector('#customer-name');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Respuesta perdida iOS');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        """)
        try await wait("!document.querySelector('button[type=submit]').disabled")
        try await js("document.querySelector('button[type=submit]').click()")
    }

    /// The real Worker commits first. Only delivery to the UI is interrupted.
    private func observeAdmission(drop: Bool) async throws {
        try await js("""
          window.__admissions = [];
          const original = window.fetch;
          window.fetch = async function(input, init) {
            const response = await original.call(this, input, init);
            if (init?.method === 'POST' && String(input).includes('/mobile/services/') && String(input).endsWith('/entries')) {
              const joined = await response.clone().json();
              window.__admissions.push({status: response.status,
                key: new Headers(init.headers).get('Idempotency-Key'), token: joined.recoveryToken});
              if (drop) throw new TypeError('Respuesta perdida local');
            }
            return response;
          };
        """, ["drop": drop])
    }

    func test04CommittedResponseLostTwice() async throws {
        try await bootstrap()
        var checkpoint = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: checkpointURL)) as? [String: Any])
        let service = try XCTUnwrap(checkpoint["service"] as? String)
        try await observeAdmission(drop: true)
        try await fillAndSubmit(service)
        try await wait("window.__admissions.length === 1 && document.body.innerText.includes('Respuesta perdida local')")
        let firstValue = try await js("return window.__admissions[0]")
        let first = try XCTUnwrap(firstValue as? [String: Any])
        XCTAssertEqual(first["status"] as? Int, 201)
        let key = try XCTUnwrap(first["key"] as? String)
        let token = try XCTUnwrap(first["token"] as? String)
        let pending = try XCTUnwrap(try record().state["pending"] as? [[String: Any]])
        XCTAssertEqual(pending.count, 1)
        XCTAssertTrue(pending.first?["key"] as? String == key)
        try await wait("!document.querySelector('button[type=submit]').disabled")
        try await js("document.querySelector('button[type=submit]').click()")
        try await wait("window.__admissions.length === 2 && !document.querySelector('button[type=submit]').disabled")
        let replay = try await js("return window.__admissions[1].status === 200 && window.__admissions[1].key === window.__admissions[0].key && window.__admissions[1].token === window.__admissions[0].token")
        XCTAssertTrue(replay as? Bool == true, "Retry must replay the same committed ticket")
        XCTAssertEqual((try record().state["pending"] as? [Any])?.count, 1)
        XCTAssertTrue(digest(try record().secret) == checkpoint["identityDigest"] as? String)
        let database = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(database["counts"] as? [String: Int]), entries: 2)
        checkpoint["retryKeyDigest"] = digest(key)
        checkpoint["retryTurnDigest"] = digest("/t/" + token)
        checkpoint["retryPID"] = ProcessInfo.processInfo.processIdentifier
        try JSONSerialization.data(withJSONObject: checkpoint).write(to: checkpointURL, options: .atomic)
        try await snapshot("05-committed-response-lost")
    }

    func test05RetryAfterRelaunchWithoutDuplicate() async throws {
        try await bootstrap()
        let checkpoint = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: checkpointURL)) as? [String: Any])
        XCTAssertNotEqual(checkpoint["retryPID"] as? Int, Int(ProcessInfo.processInfo.processIdentifier))
        let identity = try record()
        XCTAssertTrue(digest(identity.secret) == checkpoint["identityDigest"] as? String)
        let pending = try XCTUnwrap(identity.state["pending"] as? [[String: Any]])
        XCTAssertEqual(pending.count, 1)
        XCTAssertTrue(digest(try XCTUnwrap(pending.first?["key"] as? String)) == checkpoint["retryKeyDigest"] as? String)
        try await wait("document.querySelectorAll('a[href^=\"/t/\"]').length === 1")
        let recoveredValue = try await js("return new URL(document.querySelector('a[href^=\"/t/\"]').href).pathname")
        XCTAssertTrue(digest(try XCTUnwrap(recoveredValue as? String)) == checkpoint["retryTurnDigest"] as? String)
        try await observeAdmission(drop: false)
        try await fillAndSubmit(try XCTUnwrap(checkpoint["service"] as? String))
        try await wait("location.pathname.startsWith('/t/') && document.body.innerText.includes('Abandonar la lista')")
        let responseValue = try await js("return window.__admissions")
        let responses = try XCTUnwrap(responseValue as? [[String: Any]])
        XCTAssertEqual(responses.count, 1)
        XCTAssertEqual(responses.first?["status"] as? Int, 200)
        XCTAssertTrue(digest(try XCTUnwrap(responses.first?["key"] as? String)) == checkpoint["retryKeyDigest"] as? String)
        let turnValue = try await js("return location.pathname")
        XCTAssertTrue(digest(try XCTUnwrap(turnValue as? String)) == checkpoint["retryTurnDigest"] as? String)
        XCTAssertEqual((try record().state["pending"] as? [Any])?.count, 0)
        let database = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(database["counts"] as? [String: Int]), entries: 2)
        try await interceptMetadata()
        try await js("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Abandonar la lista').click()")
        try await wait("Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Sí, abandonar la lista de espera')")
        try await js("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Sí, abandonar la lista de espera').click()")
        try await wait("window.__iosSmoke.some(r => r.status === 200)")
        try await navigate("/turns?lang=es")
        try await wait("document.body.innerText.includes('No tienes turnos activos')")
    }

    private var vaultQuery: [String: Any] { [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.noqueue.installation.v1",
        kSecAttrAccount as String: "installation",
        kSecAttrSynchronizable as String: false
    ] }
    private func rawVault() throws -> Data {
        var query = vaultQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &result), errSecSuccess)
        return try XCTUnwrap(result as? Data)
    }
    private func replaceVault(_ data: Data) -> OSStatus {
        SecItemUpdate(vaultQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    }
    private func reloadDocument() async throws {
        // A new document is essential: the JS installation module caches its state.
        try await js("window.__oldDocument = true")
        web.reload()
        try await wait("!window.__oldDocument && !!document.querySelector('main') && !!window.Capacitor?.Plugins?.NoQueueVault")
    }

    func test06CorruptKeychainFailsClosedAndRestores() async throws {
        try await bootstrap()
        continueAfterFailure = true // Ensure defer restores the original even after an assertion failure.
        let original = try rawVault()
        defer { XCTAssertEqual(replaceVault(original), errSecSuccess, "Restore original test identity") }
        // Observes real network calls from document start, before the app mounts.
        let observer = WKUserScript(source: """
          window.__credentialedCalls = 0;
          const original = window.fetch;
          window.fetch = function(input, init) {
            if (new Headers(init?.headers).has('Authorization')) window.__credentialedCalls++;
            return original.apply(this, arguments);
          };
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        web.configuration.userContentController.addUserScript(observer)
        let cases = [Data("{broken".utf8), Data("{\"version\":1,\"secret\":\"invalid\",\"pending\":[]}".utf8), Data([0xff, 0xfe, 0xfd])]
        for (index, corrupt) in cases.enumerated() {
            XCTAssertEqual(replaceVault(corrupt), errSecSuccess)
            try await reloadDocument()
            try await wait("document.body.innerText.includes('No se pueden actualizar los datos')")
            // Explicit retry still must not replace identity or issue authenticated HTTP.
            try await js("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Reintentar').click()")
            try await wait("document.body.innerText.includes('No se pueden actualizar los datos')")
            try await Task.sleep(nanoseconds: 500_000_000)
            let calls = try await js("return window.__credentialedCalls")
            XCTAssertEqual(calls as? Int, 0)
            XCTAssertTrue(try rawVault() == corrupt, "Corrupt record must not be silently replaced")
            let nativeRejected = try await js("try { await window.Capacitor.Plugins.NoQueueVault.read(); return false; } catch { return true; }")
            XCTAssertEqual(nativeRejected as? Bool, index == 2, "UTF8 failure belongs to native vault; JSON/schema failures to JS")
            try await snapshot("06-corrupt-keychain-\(index)")
            XCTAssertEqual(replaceVault(original), errSecSuccess)
            try await reloadDocument()
            try await wait("document.body.innerText.includes('No tienes turnos activos')")
            XCTAssertTrue(try rawVault() == original, "Original bytes restored")
            let database = try await evidence()
            verifyNoWhatsApp(try XCTUnwrap(database["counts"] as? [String: Int]), entries: 2)
        }
    }

    func test07RestoredIdentityAfterRelaunch() async throws {
        try await bootstrap()
        let checkpoint = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: checkpointURL)) as? [String: Any])
        XCTAssertTrue(digest(try record().secret) == checkpoint["identityDigest"] as? String)
        XCTAssertEqual((try record().state["pending"] as? [Any])?.count, 0)
        try await wait("document.body.innerText.includes('No tienes turnos activos')")
        let database = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(database["counts"] as? [String: Int]), entries: 2)
    }

    private func verifyBuild(version: String, build: String) {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "com.noqueue-app.ios")
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String, version)
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String, build)
    }

    func test08SeedBeforeUpgrade() async throws {
        continueAfterFailure = false
        verifyBuild(version: "1.0.0", build: "1001")
        // Keep both tickets active: one acknowledged and one with a lost response.
        try await test01AnonymousAdmissionAndKeychain()
        try await test04CommittedResponseLostTwice()
        try await navigate("/turns?lang=es")
        try await wait("document.querySelectorAll('a[href^=\"/t/\"]').length === 2")
        var checkpoint = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: checkpointURL)) as? [String: Any])
        checkpoint["vaultDigestBeforeUpgrade"] = SHA256.hash(data: try rawVault()).map { String(format: "%02x", $0) }.joined()
        checkpoint["upgradePID"] = ProcessInfo.processInfo.processIdentifier
        checkpoint["sourceVersion"] = "1.0.0"
        checkpoint["sourceBuild"] = "1001"
        try JSONSerialization.data(withJSONObject: checkpoint).write(to: checkpointURL, options: .atomic)
        try await snapshot("08-two-active-before-upgrade")
    }

    func test09UpgradePreservesIdentityTicketsAndPendingRetry() async throws {
        continueAfterFailure = false
        verifyBuild(version: "1.0.1", build: "1002")
        try await bootstrap()
        let checkpoint = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: checkpointURL)) as? [String: Any])
        XCTAssertEqual(checkpoint["sourceVersion"] as? String, "1.0.0")
        XCTAssertEqual(checkpoint["sourceBuild"] as? String, "1001")
        XCTAssertNotEqual(checkpoint["upgradePID"] as? Int, Int(ProcessInfo.processInfo.processIdentifier))
        let vaultDigest = SHA256.hash(data: try rawVault()).map { String(format: "%02x", $0) }.joined()
        XCTAssertTrue(vaultDigest == checkpoint["vaultDigestBeforeUpgrade"] as? String, "All Keychain bytes, including pending input, must survive update")
        let identity = try record()
        XCTAssertTrue(digest(identity.secret) == checkpoint["identityDigest"] as? String)
        let pending = try XCTUnwrap(identity.state["pending"] as? [[String: Any]])
        XCTAssertEqual(pending.count, 1)
        XCTAssertTrue(digest(try XCTUnwrap(pending.first?["key"] as? String)) == checkpoint["retryKeyDigest"] as? String)
        try await wait("document.querySelectorAll('a[href^=\"/t/\"]').length === 2")
        let pathsValue = try await js("return Array.from(document.querySelectorAll('a[href^=\"/t/\"]'), a => new URL(a.href).pathname)")
        let paths = try XCTUnwrap(pathsValue as? [String])
        let expected = Set([try XCTUnwrap(checkpoint["turnDigest"] as? String), try XCTUnwrap(checkpoint["retryTurnDigest"] as? String)])
        XCTAssertTrue(Set(paths.map { digest($0) }) == expected, "Both original tickets must be recovered, not replaced")
        try await snapshot("09-two-recovered-after-upgrade")
        // Open the acknowledged ticket too: listing alone does not prove access.
        let originalPath = try XCTUnwrap(paths.first { digest($0) == checkpoint["turnDigest"] as? String })
        try await navigate(originalPath + "?lang=es")
        try await wait("document.body.innerText.includes('Abandonar la lista')")
        try await observeAdmission(drop: false)
        try await fillAndSubmit(try XCTUnwrap(checkpoint["service"] as? String))
        try await wait("location.pathname.startsWith('/t/') && document.body.innerText.includes('Abandonar la lista')")
        let requestsValue = try await js("return window.__admissions")
        let requests = try XCTUnwrap(requestsValue as? [[String: Any]])
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?["status"] as? Int, 200, "Pending intent must replay, not create201")
        XCTAssertTrue(digest(try XCTUnwrap(requests.first?["key"] as? String)) == checkpoint["retryKeyDigest"] as? String)
        let pathValue = try await js("return location.pathname")
        XCTAssertTrue(digest(try XCTUnwrap(pathValue as? String)) == checkpoint["retryTurnDigest"] as? String)
        XCTAssertEqual((try record().state["pending"] as? [Any])?.count, 0)
        let afterReplay = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(afterReplay["counts"] as? [String: Int]), entries: 2)
        // Both old tickets remain operable by this installation after the update.
        for route in paths {
            try await navigate("/turns?lang=es")
            try await wait("document.body.innerText.includes('Tus turnos')")
            try await navigate(route + "?lang=es")
            try await wait("document.body.innerText.includes('Abandonar la lista')")
            try await interceptMetadata()
            try await js("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Abandonar la lista').click()")
            try await wait("Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Sí, abandonar la lista de espera')")
            try await js("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Sí, abandonar la lista de espera').click()")
            try await wait("window.__iosSmoke.some(r => r.status === 200)")
        }
        try await navigate("/turns?lang=es")
        try await wait("document.body.innerText.includes('No tienes turnos activos')")
    }

    func test10UpdatedAppAfterRelaunch() async throws {
        continueAfterFailure = false
        verifyBuild(version: "1.0.1", build: "1002")
        try await test07RestoredIdentityAfterRelaunch()
    }

    private var servicesCheckpointURL: URL {
        checkpointURL.deletingLastPathComponent().appendingPathComponent("noqueue-services-checkpoint.json")
    }
    private func runServiceScenario(_ phase: String) async throws {
        try await bootstrap()
        let database = try await evidence()
        let services = try XCTUnwrap(database["services"] as? [String: String])
        let resource = try XCTUnwrap(Bundle(for: LocalSmokeTests.self).url(forResource: "service-scenarios", withExtension: "js"))
        let source = try String(contentsOf: resource, encoding: .utf8)
        var args: [String: Any] = ["phase": phase, "services": services]
        var previous: [String: Any] = [:]
        if phase != "seed" {
            previous = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: servicesCheckpointURL)) as? [String: Any])
            XCTAssertNotEqual(previous["pid"] as? Int, Int(ProcessInfo.processInfo.processIdentifier))
            args["expected"] = previous
        }
        let value = try await js("return await (\(source))(args)", ["args": args])
        let result = try XCTUnwrap(value as? [String: Any])
        // Native read independently verifies actual Keychain + protection attributes.
        XCTAssertTrue(digest(try record().secret) == result["identityDigest"] as? String)
        XCTAssertEqual((try record().state["pending"] as? [Any])?.count, 0)
        var checkpoint = phase == "seed" ? result : previous
        checkpoint["pid"] = ProcessInfo.processInfo.processIdentifier
        try JSONSerialization.data(withJSONObject: checkpoint).write(to: servicesCheckpointURL, options: .atomic)
        let final = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(final["counts"] as? [String: Int]), entries: 4)
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "service-\(phase)-safe-results"
        attachment.lifetime = .keepAlways
        add(attachment)
        try await snapshot("service-\(phase)")
    }
    func test11RestaurantPoolAdmission() async throws { try await runServiceScenario("seed") }
    func test12RestaurantManagementAfterRelaunch() async throws { try await runServiceScenario("restaurant") }
    func test13PoolManagementAfterRelaunch() async throws { try await runServiceScenario("pool") }
    func test14ServicesCancelledAfterRelaunch() async throws { try await runServiceScenario("empty") }

    // Saved known links for testing, NOT product history. Separate device-only Keychain record.
    private var lifecycleQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.noqueue.local-tests.lifecycle",
         kSecAttrAccount as String: "known-links", kSecAttrSynchronizable as String: false]
    }
    func test15LifecycleSeed() async throws {
        try await runServiceScenario("seed")
        let links = try await js("""
          const state = JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value);
          const r = await fetch('https://127.0.0.1:8788/api/v1/mobile/entries', {headers:{Authorization:'Bearer '+state.secret}});
          const entries = (await r.json()).entries;
          return entries.map(e => ({token:e.recoveryToken,serviceId:e.serviceId}));
        """)
        let data = try JSONSerialization.data(withJSONObject: XCTUnwrap(links))
        SecItemDelete(lifecycleQuery as CFDictionary)
        var query = lifecycleQuery
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        XCTAssertEqual(SecItemAdd(query as CFDictionary, nil), errSecSuccess)
    }
    private func runLifecycleScenario(_ phase: String) async throws {
        try await bootstrap()
        var expected = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: servicesCheckpointURL)) as? [String: Any])
        XCTAssertNotEqual(expected["pid"] as? Int, Int(ProcessInfo.processInfo.processIdentifier))
        var query = lifecycleQuery
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &item), errSecSuccess)
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(item as? Data)) as? [[String: String]])
        let tickets = try XCTUnwrap(expected["tickets"] as? [[String: Any]])
        let links: [[String: Any]] = try saved.map { link in
            let token = try XCTUnwrap(link["token"])
            let ticket = try XCTUnwrap(tickets.first { $0["digest"] as? String == digest(token) })
            return ["token": token, "type": try XCTUnwrap(ticket["type"]), "index": try XCTUnwrap(ticket["index"])]
        }
        let resource = try XCTUnwrap(Bundle(for: LocalSmokeTests.self).url(forResource: "lifecycle-scenarios", withExtension: "js"))
        let source = try String(contentsOf: resource, encoding: .utf8)
        let value = try await js("return await (\(source))(args)", ["args": ["phase": phase, "expected": expected, "links": links]])
        let result = try XCTUnwrap(value as? [String: Any])
        XCTAssertTrue(digest(try record().secret) == result["identityDigest"] as? String)
        let database = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(database["counts"] as? [String: Int]), entries: 4)
        expected["pid"] = ProcessInfo.processInfo.processIdentifier
        try JSONSerialization.data(withJSONObject: expected).write(to: servicesCheckpointURL, options: .atomic)
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "lifecycle-\(phase)-safe-results"
        attachment.lifetime = .keepAlways
        add(attachment)
        try await snapshot("lifecycle-\(phase)")
        if phase == "recovered" { XCTAssertEqual(SecItemDelete(lifecycleQuery as CFDictionary), errSecSuccess) }
    }
    func test16CalledAfterRelaunch() async throws { try await runLifecycleScenario("called") }
    func test17TerminalAfterRelaunch() async throws { try await runLifecycleScenario("terminal") }
    func test18TerminalRecoveredAgain() async throws { try await runLifecycleScenario("recovered") }
    func test19NativeDiscoveryAndAdmission() async throws {
        try await bootstrap()
        let initial = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(initial["counts"] as? [String: Int]), entries: 0)
        let resource = try XCTUnwrap(Bundle(for: LocalSmokeTests.self).url(forResource: "discovery-scenarios", withExtension: "js"))
        let source = try String(contentsOf: resource, encoding: .utf8)
        try await js("""
          window.__paritySnapshot = null;
          window.__noqueueCapture = async name => {
            window.__paritySnapshot = name;
            for (let i=0;i<100;i++) {
              if (window.__paritySnapshot === null) return;
              await new Promise(r=>setTimeout(r,100));
            }
            throw new Error('snapshot timeout');
          };
        """)
        let snapshots = Task { @MainActor in
            while !Task.isCancelled {
                if let name = try? await js("return window.__paritySnapshot"), let label = name as? String {
                    try await snapshot("parity-" + label)
                    try await js("window.__paritySnapshot = null")
                }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
        }
        defer { snapshots.cancel() }
        let value = try await js("return await (\(source))(args)", ["args": ["services": try XCTUnwrap(initial["services"]), "venue": try XCTUnwrap(initial["venue"])]])
        let result = try XCTUnwrap(value as? [String: Any])
        XCTAssertEqual(result["status"] as? String, "passed")
        let database = try await evidence()
        verifyNoWhatsApp(try XCTUnwrap(database["counts"] as? [String: Int]), entries: 1)
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "discovery-safe-results"
        attachment.lifetime = .keepAlways
        add(attachment)
        try await snapshot("discovery-home")
    }

    func test20NativeLocation() async throws {
        try await bootstrap()
        try await js("""
          window.__locationUsed = false;
          const original = window.fetch;
          window.fetch = async function(input, init) {
            if (String(input).endsWith('/mobile/search') && init?.body) {
              const c = JSON.parse(init.body).coordinates;
              if (c && Math.abs(c.latitude - 40.4168)<0.1 && Math.abs(c.longitude + 3.7038)<0.1) window.__locationUsed = true;
            }
            return original.call(this,input,init);
          };
          Array.from(document.querySelectorAll('button')).find(b=>b.innerText.includes('Usar mi ubicación')).click();
        """)
        try await wait("window.__locationUsed && document.querySelectorAll('a[href^=\"/q/\"]').length === 3")
        try await snapshot("parity-location")
    }

    /// Real Capacitor bridge, Firebase OFF; no initialization or token requests.
    func test21FcmDisabledDoesNotInitializeOrChangeIdentity() async throws {
        continueAfterFailure = false
        for _ in 0..<100 {
            web = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }.compactMap { findWebView($0) }.first
            if web != nil { break }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        _ = try XCTUnwrap(web)
        try await wait("!!window.Capacitor?.Plugins?.NoQueueFcm && !!window.Capacitor?.Plugins?.NoQueueVault")
        let result = try await js("""
          const fcm = window.Capacitor.Plugins.NoQueueFcm;
          const vault = window.Capacitor.Plugins.NoQueueVault;
          const before = await vault.read();
          const first = await fcm.availability();
          let rejected = false;
          try { await fcm.start(); } catch { rejected = true; }
          await fcm.stop();
          const after = await vault.read();
          return { first, last: await fcm.availability(), rejected, unchanged: JSON.stringify(before) === JSON.stringify(after) };
        """) as? [String: Any]
        XCTAssertEqual(result?["rejected"] as? Bool, true)
        XCTAssertEqual(result?["unchanged"] as? Bool, true)
        for field in ["first", "last"] {
            let state = result?[field] as? [String: Any]
            XCTAssertEqual(state?["available"] as? Bool, false)
            XCTAssertEqual(state?["initialized"] as? Bool, false)
        }
    }

    /// The real client plist being bundled must not turn Firebase on by itself.
    func test22FcmConfiguredButDisabledDoesNotInitializeOrChangeIdentity() async throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist"))
        let data = try Data(contentsOf: url)
        let config = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        XCTAssertEqual(config["PROJECT_ID"] as? String, "nq-app-f3127")
        XCTAssertEqual(config["BUNDLE_ID"] as? String, "com.noqueue-app.ios")
        XCTAssertEqual(config["GOOGLE_APP_ID"] as? String, "1:54689871019:ios:bf4f2ec894b1aa99bf73ee")
        try await test21FcmDisabledDoesNotInitializeOrChangeIdentity()
    }

}
