import SwiftUI
import SwiftData

@main
struct ExpedienteRosaApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [Paciente.self, Estudio.self, EventoPendiente.self])
    }
}
