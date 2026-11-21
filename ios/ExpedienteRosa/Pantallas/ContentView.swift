import SwiftUI
import SwiftData

/// Raíz: crea el sincronizador con el contexto de SwiftData y reparte las pestañas.
struct ContentView: View {
    @Environment(\.modelContext) private var contexto
    @State private var sync: Sincronizador?
    @State private var arrancando = true

    var body: some View {
        // ZStack a pantalla completa: mientras se crea el sincronizador, `principal` es un
        // ProgressView chico y un overlay tomaría su tamaño.
        ZStack {
            principal.frame(maxWidth: .infinity, maxHeight: .infinity)
            if arrancando { Arranque { arrancando = false } }
        }
    }

    @ViewBuilder private var principal: some View {
        #if DEBUG
        if ModoCaptura.pantalla != nil {
            RaizCaptura()
        } else {
            raiz
        }
        #else
        raiz
        #endif
    }

    private var raiz: some View {
        Group {
            if let sync {
                Pestanas().environment(sync)
            } else {
                ProgressView()
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
    @State var pestana = "buscar"

    var body: some View {
        TabView(selection: $pestana) {
            Tab("Buscar", systemImage: "magnifyingglass", value: "buscar") {
                BuscarView()
            }
            Tab("Jornada", systemImage: "antenna.radiowaves.left.and.right", value: "jornada") {
                JornadaView()
            }
            .badge(sync.pendientes)
            Tab("Revisión", systemImage: "person.2.badge.gearshape", value: "revision") {
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
            Picker("Quién usa el teléfono", selection: $rol) {
                ForEach(Rol.allCases) { r in
                    Label(r.nombre, systemImage: r.icono).tag(r)
                }
            }
        } label: {
            HStack(spacing: Tema.Espacio.xs) {
                Text(rol.nombre)
                Image(systemName: "chevron.down").imageScale(.small)
            }
            .font(.nota.weight(.semibold))
            .padding(.horizontal, Tema.Espacio.xs)
            .frame(minHeight: Tema.toque)
        }
        .accessibilityLabel("Rol: \(rol.nombre)")
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
        .modelContainer(for: Esquema.modelos, inMemory: true)
}
