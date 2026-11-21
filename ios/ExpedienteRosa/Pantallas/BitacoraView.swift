import SwiftUI
import SwiftData

/// Quién hizo qué y cuándo. La API no manda datos clínicos aquí: ni resultados ni valores de campos.
struct BitacoraView: View {
    @Environment(Sincronizador.self) private var sync
    @Query private var pacientes: [Paciente]
    @State private var entradas: [EntradaBitacora] = []
    @State private var cargando = false
    @State private var error: String?

    private var folios: [String: String] { Dictionary(pacientes.map { ($0.id, $0.folio) }, uniquingKeysWith: { a, _ in a }) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tema.Espacio.l) {
                Text("Sin resultados ni datos clínicos.").font(.nota).foregroundStyle(.secondary)
                if entradas.isEmpty && !cargando {
                    ContentUnavailableView(error == nil ? "Sin movimientos" : "Sin conexión",
                                           systemImage: error == nil ? "list.bullet.rectangle" : "wifi.exclamationmark",
                                           description: Text(error ?? "Aquí aparece cada alta, visita, estudio y corrección."))
                } else {
                    Tarjeta(espacio: 0) {
                        ForEach(Array(entradas.enumerated()), id: \.element.id) { i, e in
                            if i > 0 { Divider() }
                            fila(e)
                        }
                    }
                }
            }
            .padding(Tema.Espacio.l)
        }
        .background(Tema.fondo)
        .navigationTitle("Bitácora")
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if cargando && entradas.isEmpty { ProgressView() } }
        .refreshable { await cargar() }
        .task { await cargar() }
    }

    private func fila(_ e: EntradaBitacora) -> some View {
        HStack(alignment: .top, spacing: Tema.Espacio.m) {
            Image(systemName: Self.icono(e.tipo))
                .font(.nota.weight(.semibold))
                .foregroundStyle(Tema.rosa)
                .frame(width: 28, height: 28)
                .background(Tema.rosaSuave, in: .circle)
            VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                Text(Self.que(e)).font(.cuerpo.weight(.semibold))
                Text(quien(e)).font(.nota).foregroundStyle(.secondary)
            }
            Spacer(minLength: Tema.Espacio.s)
            Text(Self.cuando(e)).font(.nota).monospacedDigit().foregroundStyle(.secondary)
        }
        .padding(.vertical, Tema.Espacio.m)
        .accessibilityElement(children: .combine)
    }

    private func quien(_ e: EntradaBitacora) -> String {
        let folio = e.pacienteId.map { folios[$0] ?? String($0.prefix(8)) }
        return [e.autor, folio].compactMap { $0 }.joined(separator: " · ")
    }

    static func que(_ e: EntradaBitacora) -> String {
        let campos = (e.campos ?? []).map(CampoPaciente.nombre).joined(separator: ", ")
        let base: String = switch e.tipo {
        case "alta": "Alta"
        case "visita": "Visita"
        case "estudio": "Estudio"
        case "actualizacion": "Corrección"
        case "conflicto": "Conflicto"
        case "conflicto-aceptar": "Conflicto aceptado"
        case "conflicto-rechazar": "Conflicto rechazado"
        case "duplicado-unir": "Duplicado unido"
        case "duplicado-separar": "Son distintas"
        case "seguimiento-atendido": "Seguimiento atendido"
        default: e.tipo.capitalizandoPrimera
        }
        return campos.isEmpty ? base : "\(base): \(campos)"
    }

    static func icono(_ tipo: String) -> String {
        switch tipo {
        case "alta": "person.badge.plus"
        case "visita": "calendar"
        case "estudio": "doc.text"
        case "actualizacion": "pencil"
        case "conflicto", "conflicto-aceptar", "conflicto-rechazar": "arrow.triangle.branch"
        case "duplicado-unir", "duplicado-separar": "person.2"
        case "seguimiento-atendido": "checkmark"
        default: "circle"
        }
    }

    static func cuando(_ e: EntradaBitacora) -> String {
        guard let d = Fechas.leer(e.cuando) else { return "" }
        return Calendar.current.isDateInToday(d) ? d.formatted(.dateTime.hour().minute())
                                                 : d.formatted(.dateTime.day().month(.abbreviated))
    }

    private func cargar() async {
        #if DEBUG
        if ModoCaptura.pantalla != nil { entradas = ModoCaptura.bitacoraDemo(pacientes); return }
        #endif
        cargando = true; error = nil
        do { entradas = try await sync.api.bitacora(limite: 100) } catch { self.error = error.localizedDescription }
        cargando = false
    }
}
