import SwiftUI
import SwiftData

/// Segunda visita: quién es, qué se le ha hecho y qué salió.
/// Enfermería no ve resultados; el médico sí, con un resumen hecho en el teléfono.
struct ExpedienteView: View {
    let paciente: Paciente
    @Query private var estudios: [Estudio]
    @AppStorage("rol") private var rol: Rol = .enfermeria
    @State private var resumen: String?
    @State private var resumiendo = false
    @State private var agregar = false

    init(paciente: Paciente) {
        self.paciente = paciente
        let id = paciente.id
        _estudios = Query(filter: #Predicate<Estudio> { $0.pacienteId == id }, sort: \Estudio.fecha, order: .reverse)
    }

    private var veResultados: Bool { rol != .enfermeria }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                encabezado
                if veResultados && !estudios.isEmpty && (resumen != nil || resumiendo) {
                    Tarjeta {
                        Text("Resumen para el médico").font(.subheadline.weight(.semibold))
                        LineaIA(texto: resumen, cargando: resumiendo)
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
                historial
            }
            .padding(16)
            .animation(Tema.resorte, value: estudios.map(\.id))
            .animation(Tema.resorte, value: resumen)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(paciente.nombre)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if rol == .medico {
                ToolbarItem(placement: .primaryAction) {
                    Button { agregar = true } label: { Label("Agregar estudio", systemImage: "plus") }
                }
            }
        }
        .sheet(isPresented: $agregar) { AgregarEstudioView(paciente: paciente) }
        .task(id: "\(estudios.count)-\(rol.rawValue)") { await resumir() }
    }

    private var encabezado: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(paciente.nombreCompleto).font(.title2.weight(.bold))
                    Text(paciente.subtitulo).font(.subheadline).opacity(0.9)
                }
                Spacer()
                Text(paciente.folio)
                    .font(.caption.monospaced().weight(.semibold))
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .glassEffect(.regular, in: .capsule)
            }
            HStack(spacing: 18) {
                dato("\(estudios.count)", "estudios")
                dato(estudios.first.map { $0.fecha.formatted(.dateTime.month(.abbreviated).year()) } ?? "—", "último")
                dato(paciente.consentimiento.formatted(.dateTime.day().month(.abbreviated)), "consintió")
            }
        }
        .foregroundStyle(.white)
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tema.degradado, in: .rect(cornerRadius: 24))
        .shadow(color: Tema.rosa.opacity(0.3), radius: 16, y: 8)
    }

    private func dato(_ valor: String, _ etiqueta: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(valor).font(.headline).contentTransition(.numericText())
            Text(etiqueta).font(.caption).opacity(0.8)
        }
    }

    @ViewBuilder private var historial: some View {
        if estudios.isEmpty {
            Tarjeta {
                Label("Primera visita: sin estudios previos", systemImage: "sparkles")
                    .foregroundStyle(.secondary)
            }
        } else {
            Tarjeta {
                Text("Historial").font(.headline)
                VStack(spacing: 0) {
                    ForEach(Array(estudios.enumerated()), id: \.element.id) { i, e in
                        FilaEstudio(estudio: e, veResultado: veResultados, ultima: i == estudios.count - 1)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
            }
        }
    }

    private func resumir() async {
        guard veResultados, !estudios.isEmpty, Inteligencia.disponible else { resumen = nil; return }
        resumiendo = true
        let r = await Inteligencia.resumir(estudios)
        if Task.isCancelled { return }
        withAnimation(Tema.resorte) { resumen = r; resumiendo = false }
    }
}

/// Un estudio en la línea de tiempo.
struct FilaEstudio: View {
    let estudio: Estudio
    var veResultado: Bool
    var ultima: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Image(systemName: Tema.icono(estudio.tipo))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(veResultado ? Tema.color(estudio.resultado) : Tema.rosa, in: .circle)
                if !ultima {
                    Rectangle().fill(Color(.separator)).frame(width: 2).frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(estudio.tipo.nombre).font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(estudio.fecha.formatted(.dateTime.day().month(.abbreviated).year()))
                        .font(.caption).foregroundStyle(.secondary)
                }
                if veResultado {
                    Chip(texto: estudio.resultado.nombre,
                         icono: estudio.resultado == .anormal ? "exclamationmark.triangle.fill" : nil,
                         color: Tema.color(estudio.resultado))
                    if let nota = estudio.nota { Text(nota).font(.footnote).foregroundStyle(.secondary) }
                } else {
                    Label("Resultado visible solo para el médico", systemImage: "lock.fill")
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }
            .padding(.bottom, ultima ? 0 : 16)
        }
    }
}

/// El médico agrega el estudio de hoy, escrito o dictado.
struct AgregarEstudioView: View {
    let paciente: Paciente
    @Environment(Sincronizador.self) private var sync
    @Environment(\.dismiss) private var cerrar
    @State private var tipo: TipoEstudio = .mastografia
    @State private var resultado: Resultado = .pendiente
    @State private var nota = ""
    @State private var dictado = ""
    @State private var interpretando = false
    @State private var guardado = false

    var body: some View {
        NavigationStack {
            Form {
                if Inteligencia.disponible {
                    Section {
                        TextField("Ej. «mastografía normal, regresa en un año»", text: $dictado, axis: .vertical)
                        Button {
                            Task { await interpretar() }
                        } label: {
                            HStack {
                                Label("Llenar con IA del teléfono", systemImage: "apple.intelligence")
                                if interpretando { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(dictado.limpio.isEmpty || interpretando)
                    } header: {
                        Text("Dictar")
                    } footer: {
                        Text("Usa el micrófono del teclado. Se procesa en el teléfono, sin internet.")
                    }
                }
                Section("Estudio") {
                    Picker("Tipo", selection: $tipo) {
                        ForEach(TipoEstudio.allCases, id: \.self) { Label($0.nombre, systemImage: Tema.icono($0)).tag($0) }
                    }
                    Picker("Resultado", selection: $resultado) {
                        ForEach(Resultado.allCases, id: \.self) { Text($0.nombre).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    TextField("Nota (opcional)", text: $nota, axis: .vertical)
                }
            }
            .navigationTitle("Estudio de hoy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { cerrar() } }
                ToolbarItem(placement: .confirmationAction) { Button("Guardar", action: guardar).tint(Tema.rosa) }
            }
            .animation(Tema.resorte, value: tipo)
            .animation(Tema.resorte, value: resultado)
            .sensoryFeedback(.success, trigger: guardado)
        }
        .presentationDetents([.medium, .large])
    }

    private func interpretar() async {
        interpretando = true
        if let e = await Inteligencia.dictarEstudio(dictado) {
            withAnimation(Tema.resorte) { tipo = e.tipo; resultado = e.resultado; nota = e.nota ?? nota }
        }
        interpretando = false
    }

    private func guardar() {
        let e = NuevoEstudio(tipo: tipo, fecha: .now, resultado: resultado, nota: nota.limpio.nilSiVacio)
        if (try? sync.repositorio.agregarEstudio(e, a: paciente)) != nil {
            guardado = true
            cerrar()
        }
    }
}
