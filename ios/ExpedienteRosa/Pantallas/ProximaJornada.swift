import SwiftUI

/// Tarjeta de arriba en Jornada: a dónde va la brigada (lo programó coordinación en el panel)
/// y si sus pacientes ya están en el teléfono. Tocar una jornada la vuelve la jornada actual.
/// No aparece si no hay jornadas programadas o si la API no tiene `/jornadas`.
struct ProximaJornada: View {
    @Environment(Sincronizador.self) private var sync
    @AppStorage("comunidad") private var comunidad = ""
    @AppStorage("estado") private var entidad = ""
    @State private var eligio = 0

    var body: some View {
        let lista = sync.proximasJornadas
        if let primera = lista.first {
            Tarjeta {
                Text("Próxima jornada").font(.nota.weight(.semibold)).foregroundStyle(.secondary)
                fila(primera, principal: true)
                if lista.count > 1 {
                    Divider().padding(.vertical, Tema.Espacio.xs)
                    Text("Después").font(.nota.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(lista.dropFirst().prefix(4)) { fila($0, principal: false) }
                }
                if let e = sync.errorJornadas, sync.enLinea, !sync.preparandoProximas {
                    Label(e, systemImage: "exclamationmark.triangle.fill")
                        .font(.nota).foregroundStyle(Tema.rojo)
                }
                actualizar
            }
            .sensoryFeedback(.selection, trigger: eligio)
            .animation(Tema.resorte, value: sync.preparandoProximas)
            .animation(Tema.resorte, value: sync.preparacion)
            .transition(.opacity)
        }
    }

    private func fila(_ j: JornadaDTO, principal: Bool) -> some View {
        let actual = j.comunidad == comunidad && j.estado == entidad
        return Button {
            withAnimation(Tema.resorte) { comunidad = j.comunidad; entidad = j.estado }
            eligio += 1
        } label: {
            VStack(alignment: .leading, spacing: principal ? Tema.Espacio.s : Tema.Espacio.xs) {
                HStack(alignment: .firstTextBaseline, spacing: Tema.Espacio.m) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(j.comunidad)
                            .font(principal ? .titulo : .seccion)
                            .foregroundStyle(.primary)
                        Text([j.estado, Self.enPalabras(j)].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.nota).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    if actual {
                        Image(systemName: "checkmark").font(.nota.weight(.bold)).foregroundStyle(Tema.rosa)
                            .accessibilityHidden(true)
                    } else {
                        Text("Usar").font(.nota.weight(.semibold)).foregroundStyle(Tema.rosa)
                    }
                }
                if principal, let nota = j.nota, !nota.isEmpty {
                    Text(nota).font(.nota).foregroundStyle(.primary).lineLimit(2)
                }
                estadoPreparacion(j)
            }
            .frame(maxWidth: .infinity, minHeight: Tema.toque, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(actual ? .isSelected : [])
        .accessibilityHint(actual ? "" : "La usa para las visitas de hoy")
    }

    @ViewBuilder private func estadoPreparacion(_ j: JornadaDTO) -> some View {
        if let p = sync.preparacion[j.id] {
            TimelineView(.periodic(from: .now, by: 30)) { contexto in
                Label(Self.lista(p, ahora: contexto.date), systemImage: "checkmark.circle.fill")
                    .font(.nota).foregroundStyle(Tema.verde)
            }
        } else if sync.preparandoProximas {
            HStack(spacing: Tema.Espacio.s) {
                ProgressView().controlSize(.small)
                Text("Bajando pacientes…")
            }
            .font(.nota).foregroundStyle(.secondary)
        } else {
            Label(sync.enLinea ? "Falta bajarla" : "Falta bajarla: necesita señal", systemImage: "clock.fill")
                .font(.nota).foregroundStyle(Tema.ambar)
        }
    }

    private var actualizar: some View {
        Button {
            Task { await sync.prepararProximas() }
        } label: {
            Label(sync.preparandoProximas ? "Actualizando…" : "Actualizar ahora", systemImage: "arrow.clockwise")
                .symbolEffect(.rotate, options: .repeating, isActive: sync.preparandoProximas)
                .font(.seccion)
                .frame(maxWidth: .infinity, minHeight: Tema.toque)
        }
        .buttonStyle(.glass)
        .tint(Tema.rosa)
        .disabled(!sync.enLinea || sync.preparandoProximas)
    }

    // MARK: - Textos

    private static let espanol = Locale(identifier: "es_MX")

    private static let formatoDia: DateFormatter = {
        let f = DateFormatter()
        f.locale = espanol
        f.dateFormat = "EEEE d 'de' MMMM"
        return f
    }()

    /// «Miércoles 25 de noviembre»; «Hoy, sábado 21 de noviembre»; «Mañana, …».
    static func enPalabras(_ j: JornadaDTO) -> String {
        guard let d = j.dia else { return j.fecha }
        let dia = formatoDia.string(from: d)
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Hoy, \(dia)" }
        if cal.isDateInTomorrow(d) { return "Mañana, \(dia)" }
        return dia.prefix(1).uppercased() + dia.dropFirst()
    }

    /// «Lista en el teléfono · 12 pacientes · actualizada hace 5 min».
    static func lista(_ p: PreparacionJornada, ahora: Date) -> String {
        let cuantas = p.pacientes == 1 ? "1 paciente" : "\(p.pacientes) pacientes"
        let cuando = ahora.timeIntervalSince(p.en) < 60
            ? "ahora"
            : p.en.formatted(.relative(presentation: .numeric, unitsStyle: .abbreviated).locale(espanol))
        return "Lista en el teléfono · \(cuantas) · actualizada \(cuando)"
    }
}
