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
            VStack(alignment: .leading, spacing: Tema.Espacio.l) {
                encabezado
                if veResultados && !estudios.isEmpty && (resumen != nil || resumiendo) {
                    Tarjeta(espacio: Tema.Espacio.s) {
                        Text("Resumen").font(.seccion)
                        LineaIA(texto: resumen, cargando: resumiendo, esperando: "Resumiendo…")
                    }
                    .transition(.opacity)
                }
                historial
            }
            .padding(Tema.Espacio.l)
            .animation(Tema.resorte, value: estudios.map(\.id))
            .animation(Tema.resorte, value: resumen)
        }
        .background(Tema.fondo)
        .navigationTitle("Expediente")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if rol == .medico {
                BotonPrincipal(titulo: "Agregar estudio", icono: "plus") { agregar = true }
                    .padding(.horizontal, Tema.Espacio.l).padding(.bottom, Tema.Espacio.s)
            }
        }
        .sheet(isPresented: $agregar) { AgregarEstudioView(paciente: paciente) }
        .task(id: "\(estudios.count)-\(rol.rawValue)") { await resumir() }
    }

    private var encabezado: some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
            Text(paciente.nombreCompleto).font(.titulo)
            Text(paciente.subtitulo).font(.cuerpo).foregroundStyle(.secondary)
            HStack(spacing: Tema.Espacio.s) {
                Text(paciente.folio).monospaced()
                Text("·")
                Text("Firmó el \(paciente.consentimiento.formatted(.dateTime.day().month(.abbreviated).year()))")
            }
            .font(.nota).foregroundStyle(.secondary)
            .padding(.top, Tema.Espacio.xs)
        }
        .padding(.top, Tema.Espacio.s)
    }

    @ViewBuilder private var historial: some View {
        Tarjeta(espacio: Tema.Espacio.l) {
            HStack(alignment: .firstTextBaseline) {
                Text("Estudios").font(.seccion)
                Spacer()
                if !veResultados && !estudios.isEmpty {
                    Label("Resultados: solo médico", systemImage: "lock.fill")
                        .font(.nota).foregroundStyle(.secondary)
                }
            }
            if estudios.isEmpty {
                Text("Primera visita").font(.cuerpo).foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(estudios.enumerated()), id: \.element.id) { i, e in
                        FilaEstudio(estudio: e, veResultado: veResultados, ultima: i == estudios.count - 1)
                            .transition(.opacity)
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

    private var colorPunto: Color { veResultado ? Tema.color(estudio.resultado) : Color.secondary }

    var body: some View {
        HStack(alignment: .top, spacing: Tema.Espacio.m) {
            VStack(spacing: 0) {
                Image(systemName: Tema.icono(estudio.tipo))
                    .font(.nota.weight(.semibold))
                    .foregroundStyle(colorPunto)
                    .frame(width: 32, height: 32)
                    .background(colorPunto.opacity(0.14), in: .circle)
                if !ultima {
                    Rectangle().fill(Tema.linea).frame(width: 1).frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(estudio.tipo.nombre).font(.seccion)
                    Spacer()
                    Text(estudio.fecha.formatted(.dateTime.day().month(.abbreviated).year()))
                        .font(.nota).foregroundStyle(.secondary)
                }
                if veResultado {
                    Chip(texto: estudio.resultado.nombre, icono: Tema.icono(estudio.resultado),
                         color: Tema.color(estudio.resultado))
                    if let nota = estudio.nota { Text(nota).font(.nota).foregroundStyle(.secondary) }
                }
            }
            .padding(.top, Tema.Espacio.xs)
            .padding(.bottom, ultima ? 0 : Tema.Espacio.l)
        }
        .accessibilityElement(children: .combine)
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
                        TextField("mastografía normal, regresa en un año", text: $dictado, axis: .vertical)
                        Button {
                            Task { await interpretar() }
                        } label: {
                            HStack {
                                Label("Llenar con IA", systemImage: "apple.intelligence")
                                if interpretando { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(dictado.limpio.isEmpty || interpretando)
                    } header: {
                        Text("Dictar")
                    } footer: {
                        Text("Usa el micrófono del teclado. No necesita internet.")
                    }
                }
                Section("Estudio") {
                    Picker("Tipo", selection: $tipo) {
                        ForEach(TipoEstudio.allCases, id: \.self) { Text($0.nombre).tag($0) }
                    }
                    Picker("Resultado", selection: $resultado) {
                        ForEach(Resultado.allCases, id: \.self) { Text($0.nombre).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    TextField("Nota", text: $nota, axis: .vertical)
                }
            }
            .navigationTitle("Estudio de hoy")
            .navigationBarTitleDisplayMode(.inline)
            .tint(Tema.rosa)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { cerrar() } }
                ToolbarItem(placement: .confirmationAction) { Button("Guardar", action: guardar) }
            }
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
