# Compose web and native journeys explicitly

The web and installed-app journeys share one React codebase but select different route trees and shells once, at startup.

## Runtime selection

`detectRuntime` chooses `WebShell` and web routes in a browser, or `NativeShell` and native routes under Capacitor. Feature code must not scatter platform conditionals throughout components.

| Channel | Identification | Notification path |
| --- | --- | --- |
| Web | Data supplied during queue entry | WhatsApp after explicit consent |
| Installed app | Anonymous installation identity | APNs/FCM token associated with that installation |

A push token identifies an installation, not a person. Tokens can rotate and must eventually be modelled with status and last-seen metadata.

## Deep-link boundary

QR codes should contain canonical HTTPS queue URLs. Universal Links and Android App Links open the installed app; the same URL falls back to the web landing when it is not installed. Store banners are an acquisition aid, not an app-installation detector.
