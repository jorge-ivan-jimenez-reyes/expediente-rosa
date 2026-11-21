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
                VStack(spacing: Tema.Espacio.l) {
                    if pares.isEmpty && !cargando {
                        ContentUnavailableView {
                            Label(error == nil ? "Nada por revisar" : "Sin conexión", systemImage: error == nil ? "checkmark.circle" : "wifi.exclamationmark")
                        } description: {
                            Text(error ?? "Aquí aparecen las pacientes que dos teléfonos registraron por separado.")
                        }
                        .padding(.top, 40)
                    }
                    ForEach(pares) { par in
                        TarjetaPar(par: par) { unir in Task { await resolver(par, unir: unir) } }
                            .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .leading).combined(with: .opacity)))
                    }
                }
                .padding(Tema.Espacio.l)
                .animation(Tema.resorte, value: pares.map(\.id))
            }
            .background(Tema.fondo)
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
        #if DEBUG
        if let demo = ModoCaptura.paresDemo { pares = demo; return }
        #endif
        cargando = true; error = nil
        do { pares = try await sync.api.duplicados() } catch { self.error = error.localizedDescription; pares = [] }
        cargando = false
    }

    private func resolver(_ par: ParDuplicado, unir: Bool) async {
        do {
            #if DEBUG
            if ModoCaptura.paresDemo == nil { try await sync.api.resolver(par, unir: unir) }
            #else
            try await sync.api.resolver(par, unir: unir)
            #endif
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
            HStack(alignment: .top, spacing: Tema.Espacio.m) {
                AnilloPuntaje(puntaje: par.puntaje)
                VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                    Text("¿Es la misma persona?").font(.seccion)
                    Text(par.razones.capitalizandoPrimera).font(.nota).foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .top, spacing: Tema.Espacio.m) {
                ficha(par.a, contra: par.b)
                Rectangle().fill(Tema.linea).frame(width: 1)
                ficha(par.b, contra: par.a)
            }
            .padding(.vertical, Tema.Espacio.xs)
            Renglon {
                Button { decidir(false) } label: {
                    Text("Son distintas").font(.seccion).frame(maxWidth: .infinity, minHeight: Tema.toque)
                }
                .buttonStyle(.glass)
                .tint(Tema.rosa)
                Button { decidir(true) } label: {
                    Text("Unir").font(.seccion).frame(maxWidth: .infinity, minHeight: Tema.toque)
                }
                .buttonStyle(.glassProminent)
                .tint(Tema.rosaRelleno)
            }
        }
    }

    /// Ficha de una paciente; lo que difiere de la otra va en rosa y negritas.
    private func ficha(_ p: PacienteDTO?, contra o: PacienteDTO?) -> some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
            if let p {
                campo(p.nombre, o?.nombre)
                campo(p.apellidoPaterno, o?.apellidoPaterno)
                campo(p.apellidoMaterno ?? "—", o?.apellidoMaterno ?? "—")
                campo(Self.edad(p), o.map(Self.edad))
                campo(p.comunidad, o?.comunidad)
                Text(p.folio).font(.nota.monospaced()).foregroundStyle(.secondary).padding(.top, Tema.Espacio.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static func edad(_ p: PacienteDTO) -> String {
        if let n = p.nacimiento, let f = FechasIA.fecha(n) { return f.formatted(.dateTime.day().month(.abbreviated).year()) }
        return p.edad.map { "\($0) años" } ?? "—"
    }

    private func campo(_ valor: String, _ otro: String?) -> some View {
        let distinto = valor.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            != (otro ?? "").folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        return Text(valor)
            .font(.cuerpo.weight(distinto ? .semibold : .regular))
            .foregroundStyle(distinto ? Tema.rosa : .primary)
    }
}
