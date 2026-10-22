// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "NoqueueNativeFcm",
    platforms: [.iOS(.v18)],
    products: [.library(name: "NoqueueNativeFcm", targets: ["NoQueueFcmPlugin"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.1"),
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", exact: "12.7.0")
    ],
    targets: [.target(name: "NoQueueFcmPlugin", dependencies: [
        .product(name: "Capacitor", package: "capacitor-swift-pm"),
        .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
        .product(name: "FirebaseMessaging", package: "firebase-ios-sdk")
    ], path: "ios/Sources/NoQueueFcmPlugin")],
    // Tools 6 provides the iOS 18 platform constant; keep the plugin language mode.
    swiftLanguageModes: [.v5]
)
