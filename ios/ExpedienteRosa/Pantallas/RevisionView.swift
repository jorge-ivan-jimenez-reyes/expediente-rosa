import SwiftUI

/// La coordinadora revisa los posibles duplicados que encontró el servidor
/// (dos teléfonos registraron a la misma señora). Ella decide, nunca el sistema solo.
struct RevisionView: View {
    @Environment(Sincronizador.self) private var sync
    @State private var pares: [ParDuplicado] = []
    @State private var cargando = false
    @State private var error: String?
    @State private var resueltos = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if pares.isEmpty && !cargando {
                        ContentUnavailableView {
                            Label(error == nil ? "Sin duplicados por revisar" : "No se pudo consultar", systemImage: error == nil ? "checkmark.circle" : "wifi.exclamationmark")
                        } description: {
                            Text(error ?? "Cuando dos teléfonos registren a la misma paciente, aparece aquí.")
                        }
                        .padding(.top, 40)
                    }
                    ForEach(pares) { par in
                        TarjetaPar(par: par) { unir in Task { await resolver(par, unir: unir) } }
                            .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .leading).combined(with: .opacity)))
                    }
                }
                .padding(16)
                .animation(Tema.resorte, value: pares.map(\.id))
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Revisión")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { SelectorRol() }
                ToolbarItem(placement: .topBarTrailing) {
                    if cargando { ProgressView() } else {
                        Button { Task { await cargar() } } label: { Label("Actualizar", systemImage: "arrow.clockwise") }
                    }
                }
            }
            .refreshable { await cargar() }
            .task { await cargar() }
            .sensoryFeedback(.success, trigger: resueltos)
        }
    }

    private func cargar() async {
        cargando = true; error = nil
        do { pares = try await sync.api.duplicados() } catch { self.error = error.localizedDescription; pares = [] }
        cargando = false
    }

    private func resolver(_ par: ParDuplicado, unir: Bool) async {
        do {
            try await sync.api.resolver(par, unir: unir)
            withAnimation(Tema.resorte) { pares.removeAll { $0.id == par.id } }
            resueltos += 1
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct TarjetaPar: View {
    var par: ParDuplicado
    var decidir: (Bool) -> Void

    var body: some View {
        Tarjeta {
            HStack {
                AnilloPuntaje(puntaje: par.puntaje)
                VStack(alignment: .leading) {
                    Text("¿Es la misma persona?").font(.headline)
                    Text(par.razones).font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .top, spacing: 10) {
                ficha(par.a, contra: par.b)
                ficha(par.b, contra: par.a)
            }
            HStack(spacing: 10) {
                Button { decidir(false) } label: {
                    Label("Son distintas", systemImage: "person.2").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                Button { decidir(true) } label: {
                    Label("Unir", systemImage: "arrow.triangle.merge").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent).tint(Tema.rosa)
            }
        }
    }

    /// Ficha de una paciente; lo que difiere de la otra se resalta en rosa.
    private func ficha(_ p: PacienteDTO?, contra o: PacienteDTO?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let p {
                campo(p.nombre, o?.nombre)
                campo(p.apellidoPaterno, o?.apellidoPaterno)
                campo(p.apellidoMaterno ?? "—", o?.apellidoMaterno ?? "—")
                campo(p.nacimiento ?? p.edad.map { "\($0) años" } ?? "—", o?.nacimiento ?? o?.edad.map { "\($0) años" } ?? "—")
                campo(p.comunidad, o?.comunidad)
                Text(p.folio).font(.caption2.monospaced()).foregroundStyle(.tertiary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 14))
    }

    private func campo(_ valor: String, _ otro: String?) -> some View {
        let distinto = valor.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            != (otro ?? "").folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        return Text(valor)
            .font(.subheadline.weight(distinto ? .semibold : .regular))
            .foregroundStyle(distinto ? Tema.rosaProfundo : .primary)
    }
}
