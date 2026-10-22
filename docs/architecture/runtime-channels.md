# Compose web and native journeys explicitly

The web and installed-app journeys share one React codebase but select different route trees and shells once, at startup.

## Runtime selection

`detectRuntime` chooses `WebShell` and web routes in a browser, or `NativeShell` and native routes under Capacitor. Feature code must not scatter platform conditionals throughout components.

| Channel | Identification | Notification path |
| --- | --- | --- |
| Web | Data supplied during queue entry | WhatsApp after explicit consent |
| Installed app | Anonymous installation identity | FCM token associated with that installation (APNs delivery on iOS) |

A push token is a delivery address, not an authentication credential or a person. Tokens rotate; registration stores platform, encrypted token, ownership and last-seen metadata separately from the anonymous installation secret.

iOS uses a lazy native FirebaseMessaging bridge with automatic initialization and swizzling disabled; existing Capacitor callbacks still handle permissions and notification navigation. The backend uses FCM HTTPv1 for both platforms; Firebase relays iOS alerts to APNs. Independent native/backend iOS gates remain OFF. Migration0032 retires legacy APNs registrations without changing installation identity or queue state. No Firebase Auth or Analytics product is added.

## Deep-link boundary

QR codes should contain canonical HTTPS queue URLs. Universal Links and Android App Links open the installed app; the same URL falls back to the web landing when it is not installed. Store banners are an acquisition aid, not an app-installation detector.

## Implemented admission boundary (20 October 2026)

The native admission API lives under `/api/v1/mobile`. Its strict join body has
no phone or WhatsApp consent. An automatically generated 256-bit installation
secret is stored in the native Keychain/Keystore vault and sent as a bearer over
HTTPS, never as a public device ID. The API stores a domain-separated hash and
binds it atomically to each ticket (`0029_mobile_installations.sql`). Native
reads/commands require both installation ownership and the existing ticket
capability. `/mobile/entries` recovers active tickets for that installation.
Web endpoints retain their existing consent and Origin checks.

Push has a local implementation but remains OFF and real delivery is unverified;
do not interpret anonymous admission as working notification delivery.
Follow `docs/development/mobile-launch-checklist.md` for
the outstanding native-device, staging and publication gates. Installation
reset/reinstall does not promise recovery or cross-device identity.

## Native discovery (20 October 2026)

Native `/` and `/search` now render the **same** `PublicDiscovery` as web;
`/v/:id` and `/q/:id` reuse the exact venue/service presentation (mobile forms
omit phone/WhatsApp). There is no native tab bar or turn dashboard. `/turns`
is a compatibility redirect, not a list.

`NativeTurnGate` checks installation ownership on startup, route changes and
foreground recovery independently from push. One waiting/called turn takes
precedence over discovery and other links; terminal screens remain until the
user leaves. Network/vault errors never imply an empty installation.
`0031_mobile_single_active_turn.sql` rejects duplicate legacy data before enabling
atomic guards across queues. Idempotent replay precedes the exclusivity check.
New conflicting admissions return authenticated `409 active_turn_exists`; an
inaccessible/suspended turn returns a generic unavailable conflict without its
reference. Web admissions have no installation binding and remain unchanged.

`customerFetch` maps search to `POST /api/v1/mobile/search` on the configured
HTTPS origin, with native Origin checks, installation authentication and a
separate 60/minute IP/installation bucket. Search rules/schema remain shared.
GPS uses `@capacitor/geolocation` only after an explicit action, with approximate
permission and no background watch. Coordinates stay in memory. QR keeps ZXing
and the shared camera dialog, validating native scans against
`VITE_PUBLIC_APP_ORIGIN` (HTTPS q/v destinations, optional ES/EN only), never the
WebView origin. Camera capture stops on close/navigation/background.

Push remains OFF; when enabled its opt-in is a secondary action below the turn,
not an additional panel. OS permission sheets and safe areas are platform
adaptations, not a separate design. iOS26+ scroll-edge effects are disabled on
the WKWebView so they cannot blur the shared web header.
