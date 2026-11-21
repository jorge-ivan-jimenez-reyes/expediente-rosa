import SwiftUI
import SwiftData

@main
struct ExpedienteRosaApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: Esquema.modelos)
    }
}
