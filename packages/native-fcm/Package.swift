// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "NoqueueNativeFcm",
    platforms: [.iOS(.v15)],
    products: [.library(name: "NoqueueNativeFcm", targets: ["NoQueueFcmPlugin"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.1"),
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", exact: "12.7.0")
    ],
    targets: [.target(name: "NoQueueFcmPlugin", dependencies: [
        .product(name: "Capacitor", package: "capacitor-swift-pm"),
        .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
        .product(name: "FirebaseMessaging", package: "firebase-ios-sdk")
    ], path: "ios/Sources/NoQueueFcmPlugin")]
)
