import XCTest
import UIKit
import WebKit

/// Tests the production Capacitor WKWebView. JavaScript helpers and screenshots live
/// in the separate AppLocalTests bundle, never in App.app or a release build.
@MainActor
final class TransitionSmokeTests: XCTestCase, WKScriptMessageHandler {
    private let origin = URL(string: "https://127.0.0.1:8788")!
    private var web: WKWebView!
    private var testLinks: [String: URL] = [:]

    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "noqueueTransitionAction",
           let body = message.body as? [String: Any],
           let action = body["action"] as? String,
           let id = body["id"] as? Int {
            Task { @MainActor [weak self] in
                guard let self, let url = self.testLinks[action],
                      let scene = UIApplication.shared.connectedScenes.first else { return }
                let activity = NSUserActivity(activityType: NSUserActivityTypeBrowsingWeb)
                activity.webpageURL = url
                // Exercise the actual SceneDelegate -> Capacitor AppUrlOpen bridge.
                // This is not a test of OS universal-link association.
                scene.delegate?.scene?(scene, continue: activity)
                try? await self.js("window.__noqueueNativeResolvers?.get(id)?.(); window.__noqueueNativeResolvers?.delete(id);", ["id": id])
            }
            return
        }
        guard message.name == "noqueueTransitionCapture",
              let body = message.body as? [String: Any],
              let name = body["name"] as? String,
              name.range(of: "^[a-z-]{1,32}$", options: .regularExpression) != nil else { return }
        Task { @MainActor [weak self] in
            try? await self?.snapshot("transitions-\(name)")
        }
    }

    private func findWebView(_ view: UIView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        return view.subviews.lazy.compactMap { self.findWebView($0) }.first
    }

    @discardableResult
    private func js(_ body: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
        try await web.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
    }

    private func wait(_ expression: String, label: String) async throws {
        for _ in 0..<120 {
            if (try? await js("return Boolean(\(expression));")) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        XCTFail("Timed out waiting for \(label)")
        throw NSError(domain: "NoQueueTransitions", code: 1)
    }

    private func snapshot(_ name: String) async throws {
        let image = try await web.takeSnapshot(configuration: nil)
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachSafeReport(_ value: [String: Any], name: String) throws {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func bootWebView() async throws {
        continueAfterFailure = false
        for _ in 0..<100 {
            web = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }.compactMap { self.findWebView($0) }.first
            if web != nil { break }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        _ = try XCTUnwrap(web, "App did not create its real WKWebView")
        try await wait("!!window.Capacitor?.isNativePlatform?.() && !!document.querySelector('main')", label: "native Capacitor page")

        // XCTest message handler is test-only and records only allowlisted screenshot names.
        web.configuration.userContentController.add(self, name: "noqueueTransitionCapture")
        web.configuration.userContentController.add(self, name: "noqueueTransitionAction")
        try await js("""
          window.__noqueueNativeActions = ['open-venue', 'open-service'];
          window.__noqueueNativeResolvers = new Map();
          let actionId = 0;
          window.__noqueueNativeAction = action => new Promise(resolve => {
            const id = ++actionId;
            window.__noqueueNativeResolvers.set(id, resolve);
            window.webkit.messageHandlers.noqueueTransitionAction.postMessage({action, id});
          });
          window.__noqueueCapture = name => {
            window.webkit.messageHandlers.noqueueTransitionCapture.postMessage({name});
            return new Promise(resolve => setTimeout(resolve, 350));
          };
        """)
    }

    private func fixture() async throws -> [String: Any] {
        var request = URLRequest(url: origin.appendingPathComponent("__local/evidence"))
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func runScenario(source: String, services: [String: Any], venue: String, reducedMotion: Bool) async throws -> [String: Any] {
        let args: [String: Any] = [
            "services": services,
            "venue": venue,
            "reducedMotionOverride": reducedMotion,
        ]
        let value = try await js("return await (0, eval)(source)(args);", ["source": source, "args": args])
        return try XCTUnwrap(value as? [String: Any])
    }

    func testNativeViewTransitions() async throws {
        try await bootWebView()
        let initial = try await fixture()
        let counts = try XCTUnwrap(initial["counts"] as? [String: Int])
        XCTAssertEqual(counts["queue_entry"], 0, "Restart the ephemeral dev:mobile API before each transition test")
        for table in ["queue_entry_contact", "consent", "notification_outbox", "mobile_push_registration", "mobile_push_outbox"] {
            XCTAssertEqual(counts[table], 0, "Local transition scenario must begin with push and contact data disabled")
        }
        let services = try XCTUnwrap(initial["services"] as? [String: Any])
        let venue = try XCTUnwrap(initial["venue"] as? String)
        let reception = try XCTUnwrap(services["reception"] as? String)
        testLinks = [
            "open-venue": URL(string: "https://app.noqueue-app.com/v/\(venue)?lang=es")!,
            "open-service": URL(string: "https://app.noqueue-app.com/q/\(reception)?lang=es")!,
        ]
        let sourceURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "transition-scenarios", withExtension: "js"))
        let source = try String(contentsOf: sourceURL, encoding: .utf8)

        let regular = try await runScenario(source: source, services: services, venue: venue, reducedMotion: false)
        try attachSafeReport(regular, name: "transition-trace-normal")
        XCTAssertEqual(regular["status"] as? String, "passed")
        XCTAssertTrue(regular["apiSupported"] as? Bool == true, "iOS 18+ WKWebView must expose document.startViewTransition")
        XCTAssertTrue(regular["instrumented"] as? Bool == true)
        XCTAssertFalse(regular["reducedMotion"] as? Bool ?? true, "Disable Reduce Motion only in this dedicated simulator for the animation pass")
        let events = try XCTUnwrap(regular["transitions"] as? [[String: Any]])
        let started = events.filter { $0["phase"] as? String == "start" }
        XCTAssertGreaterThanOrEqual(started.count, 4, "Expected real route transitions on the iOS WebView")
        for intent in ["forward", "back", "replace"] {
            XCTAssertTrue(started.contains { $0["intent"] as? String == intent }, "Missing safe \(intent) transition metadata")
        }
        XCTAssertTrue(events.contains { $0["phase"] as? String == "ready" })
        XCTAssertTrue(events.contains { $0["phase"] as? String == "finished" })

        // A second pass uses a test-local prefers-reduced-motion override and ensures
        // the WebView remains navigable while not requesting any route animation.
        let reduced = try await runScenario(source: source, services: services, venue: venue, reducedMotion: true)
        try attachSafeReport(reduced, name: "transition-trace-reduced-motion")
        XCTAssertEqual(reduced["status"] as? String, "passed")
        XCTAssertTrue(reduced["apiSupported"] as? Bool == true)
        XCTAssertTrue(reduced["reducedMotion"] as? Bool == true)
        XCTAssertTrue((reduced["transitions"] as? [[String: Any]])?.isEmpty ?? false,
                      "Reduced motion must suppress route View Transitions")

        let final = try await fixture()
        let finalCounts = try XCTUnwrap(final["counts"] as? [String: Int])
        XCTAssertEqual(finalCounts["queue_entry"], 1, "The test admission must be cancelled through the UI")
        XCTAssertEqual(finalCounts["mobile_entry_installation"], 1)
        for table in ["queue_entry_contact", "consent", "notification_outbox", "mobile_push_registration", "mobile_push_outbox"] {
            XCTAssertEqual(finalCounts[table], 0)
        }
        let statuses = try XCTUnwrap(final["statuses"] as? [[String: Any]])
        XCTAssertEqual(statuses.count, 1)
        XCTAssertEqual(statuses[0]["status"] as? String, "cancelled")
        XCTAssertEqual(statuses[0]["n"] as? Int, 1)
        web.configuration.userContentController.removeScriptMessageHandler(forName: "noqueueTransitionCapture")
        web.configuration.userContentController.removeScriptMessageHandler(forName: "noqueueTransitionAction")
    }
}
