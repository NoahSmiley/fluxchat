// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "FluxChat",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FluxChat", targets: ["FluxChat"]),
    ],
    dependencies: [
        .package(url: "https://github.com/livekit/client-sdk-swift.git", from: "2.0.0"),
        .package(url: "https://github.com/kean/Nuke.git", from: "12.0.0"),
        .package(url: "https://github.com/kishikawakatsumi/KeychainAccess.git", from: "4.2.2"),
    ],
    targets: [
        .target(
            name: "FluxChat",
            dependencies: [
                .product(name: "LiveKit", package: "client-sdk-swift"),
                .product(name: "NukeUI", package: "Nuke"),
                "KeychainAccess",
            ],
            path: "FluxChat"
        ),
    ]
)
