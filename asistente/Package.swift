// swift-tools-version: 6.2
// Asistente de coordinación: redacta respuestas cortas con el modelo de Apple
// que corre en esta Mac (Foundation Models). Las cifras llegan ya calculadas por la API.
import PackageDescription

let package = Package(
    name: "asistente",
    platforms: [.macOS(.v26)],
    targets: [
        .executableTarget(name: "asistente", path: "Sources/asistente"),
    ]
)
