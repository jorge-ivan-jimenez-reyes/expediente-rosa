import SwiftUI
import SwiftData

/// Raíz: crea el sincronizador con el contexto de SwiftData y reparte las pestañas.
struct ContentView: View {
    @Environment(\.modelContext) private var contexto
    @State private var sync: Sincronizador?

    var body: some View {
        Group {
            if let sync {
                Pestanas().environment(sync)
            } else {
                ProgressView().tint(Tema.rosa)
            }
        }
        .task {
            if sync == nil { sync = Sincronizador(contexto: contexto) }
            Inteligencia.precalentar()
        }
    }
}

struct Pestanas: View {
    @AppStorage("rol") private var rol: Rol = .enfermeria
    @Environment(Sincronizador.self) private var sync

    var body: some View {
        TabView {
            Tab("Buscar", systemImage: "magnifyingglass") {
                BuscarView()
            }
            Tab("Jornada", systemImage: "antenna.radiowaves.left.and.right") {
                JornadaView()
            }
            .badge(sync.pendientes)
            Tab("Revisión", systemImage: "person.2.badge.gearshape") {
                RevisionView()
            }
        }
        .tint(Tema.rosa)
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}

/// Selector de quién usa el teléfono. Sin login: en campo el teléfono se comparte.
struct SelectorRol: View {
    @AppStorage("rol") private var rol: Rol = .enfermeria
    var body: some View {
        Menu {
            Picker("¿Quién usa el teléfono?", selection: $rol) {
                ForEach(Rol.allCases) { r in
                    Label(r.nombre, systemImage: r.icono).tag(r)
                }
            }
        } label: {
            Label(rol.nombre, systemImage: rol.icono)
                .font(.subheadline.weight(.semibold))
        }
        .sensoryFeedback(.selection, trigger: rol)
    }
}

extension Rol {
    var icono: String {
        switch self {
        case .enfermeria: "cross.case"
        case .medico: "stethoscope"
        case .coordinadora: "person.text.rectangle"
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Paciente.self, Estudio.self, EventoPendiente.self], inMemory: true)
}
