import SwiftUI
import SwiftData
import BackgroundTasks

@main
struct ExpedienteRosaApp: App {
    /// Tarea en segundo plano que baja las jornadas programadas (en Info.plist: BGTaskSchedulerPermittedIdentifiers).
    static let tareaJornadas = "org.eira.expedienterosa.jornadas"

    /// Un solo contenedor para la app y para la tarea en segundo plano.
    static let contenedor: ModelContainer = {
        let esquema = Schema(Esquema.modelos)
        if let c = try? ModelContainer(for: esquema) { return c }
        return try! ModelContainer(for: esquema, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }()

    @Environment(\.scenePhase) private var fase

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(Self.contenedor)
        .onChange(of: fase) { _, nueva in
            if nueva == .background { Self.programarJornadas() }
        }
        .backgroundTask(.appRefresh(Self.tareaJornadas)) {
            await Self.refrescarJornadas()
        }
    }

    /// Pide a iOS que despierte la app en unas horas para bajar las jornadas. En el simulador no hace nada.
    static func programarJornadas() {
        let pedido = BGAppRefreshTaskRequest(identifier: tareaJornadas)
        pedido.earliestBeginDate = .now.addingTimeInterval(3 * 3600)
        try? BGTaskScheduler.shared.submit(pedido)
    }

    static func refrescarJornadas() async {
        programarJornadas()
        let sync = Sincronizador.principal ?? Sincronizador(contexto: contenedor.mainContext, vigilarRed: false)
        await sync.prepararProximas()
    }
}
