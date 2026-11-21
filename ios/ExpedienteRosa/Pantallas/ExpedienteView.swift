import SwiftUI
import SwiftData
import PhotosUI

/// Segunda visita: quién es, qué se le ha hecho y qué salió.
/// Enfermería no ve resultados; el médico sí, con un resumen hecho en el teléfono.
struct ExpedienteView: View {
    let paciente: Paciente
    @Query private var estudios: [Estudio]
    @Query private var visitas: [Visita]
    @Environment(Sincronizador.self) private var sync
    @AppStorage("rol") private var rol: Rol = .enfermeria
    @State private var resumen: String?
    @State private var resumiendo = false
    @State private var agregar = false
    @State private var editar = false
    @State private var visitaGuardada = 0

    init(paciente: Paciente) {
        self.paciente = paciente
        let id = paciente.id
        _estudios = Query(filter: #Predicate<Estudio> { $0.pacienteId == id }, sort: \Estudio.fecha, order: .reverse)
        _visitas = Query(filter: #Predicate<Visita> { $0.pacienteId == id }, sort: \Visita.fecha, order: .reverse)
    }

    private var vinoHoy: Bool { visitas.contains { Calendar.current.isDateInToday($0.fecha) } }

    /// Estudios agrupados por visita (fecha + comunidad). Los estudios viejos sin visita se agrupan por día.
    private var grupos: [GrupoVisita] {
        let ids = Set(visitas.map(\.id))
        var porVisita: [String: [Estudio]] = [:]
        var sueltos: [Date: [Estudio]] = [:]
        for e in estudios {
            if let v = e.visitaId, ids.contains(v) { porVisita[v, default: []].append(e) }
            else { sueltos[Calendar.current.startOfDay(for: e.fecha), default: []].append(e) }
        }
        var out = visitas.map { GrupoVisita(id: $0.id, fecha: $0.fecha, comunidad: $0.comunidad, estudios: porVisita[$0.id] ?? []) }
        out += sueltos.map { GrupoVisita(id: "dia-\($0.key.timeIntervalSince1970)", fecha: $0.key, comunidad: nil, estudios: $0.value) }
        return out.sorted { $0.fecha > $1.fecha }
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
            Group {
                if rol == .medico {
                    BotonPrincipal(titulo: "Agregar estudio", icono: "plus") { agregar = true }
                } else if rol == .enfermeria && !vinoHoy {
                    BotonPrincipal(titulo: "Registrar visita", icono: "calendar.badge.plus") { registrarVisita() }
                }
            }
            .padding(.horizontal, Tema.Espacio.l).padding(.bottom, Tema.Espacio.s)
        }
        .toolbar {
            if rol == .enfermeria {
                ToolbarItem(placement: .topBarTrailing) { Button("Editar datos") { editar = true } }
            }
        }
        .sheet(isPresented: $agregar) { AgregarEstudioView(paciente: paciente) }
        .sheet(isPresented: $editar) { EditarDatosView(paciente: paciente) }
        .sensoryFeedback(.success, trigger: visitaGuardada)
        .task(id: "\(estudios.count)-\(rol.rawValue)") { await resumir() }
        #if DEBUG
        .onAppear {
            if ModoCaptura.pantalla == "editar" { editar = true }
            if ModoCaptura.pantalla == "estudio" { agregar = true }
        }
        #endif
    }

    private func registrarVisita() {
        if (try? sync.repositorio.registrarVisita(paciente, motivo: "jornada de tamizaje")) != nil {
            withAnimation(Tema.resorteLogro) { visitaGuardada += 1 }
        }
    }

    private var encabezado: some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
            Text(paciente.nombreCompleto).font(.titulo)
            Text(paciente.subtitulo).font(.cuerpo).foregroundStyle(.secondary)
            if let extra = datosEira {
                Text(extra).font(.nota).foregroundStyle(.secondary)
            }
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

    private var datosEira: String? {
        let partes = [paciente.idEira.map { "ID \($0)" }, paciente.entidadNacimiento.map { "Nació en \($0)" }].compactMap { $0 }
        return partes.isEmpty ? nil : partes.joined(separator: " · ")
    }

    @ViewBuilder private var historial: some View {
        Tarjeta(espacio: Tema.Espacio.l) {
            HStack(alignment: .firstTextBaseline) {
                Text("Visitas").font(.seccion)
                Spacer()
                if !veResultados && !estudios.isEmpty {
                    Label("Resultados: solo médico", systemImage: "lock.fill")
                        .font(.nota).foregroundStyle(.secondary)
                }
            }
            if grupos.isEmpty {
                Text("Primera visita").font(.cuerpo).foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: Tema.Espacio.l) {
                    ForEach(Array(grupos.enumerated()), id: \.element.id) { i, g in
                        if i > 0 { Divider() }
                        BloqueVisita(grupo: g, veResultados: veResultados)
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

struct GrupoVisita: Identifiable {
    var id: String
    var fecha: Date
    var comunidad: String?
    var estudios: [Estudio]
}

/// Una visita: fecha y comunidad arriba, sus estudios abajo.
struct BloqueVisita: View {
    let grupo: GrupoVisita
    var veResultados: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.m) {
            HStack(alignment: .firstTextBaseline, spacing: Tema.Espacio.s) {
                Text(grupo.fecha.formatted(.dateTime.day().month(.wide).year()))
                    .font(.cuerpo.weight(.semibold))
                if Calendar.current.isDateInToday(grupo.fecha) { Chip(texto: "Hoy") }
                Spacer()
                if let c = grupo.comunidad { Text(c).font(.nota).foregroundStyle(.secondary) }
            }
            .accessibilityElement(children: .combine)
            if grupo.estudios.isEmpty {
                Text("Sin estudios todavía").font(.nota).foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(grupo.estudios.enumerated()), id: \.element.id) { i, e in
                        FilaEstudio(estudio: e, veResultado: veResultados, ultima: i == grupo.estudios.count - 1)
                    }
                }
            }
        }
    }
}

/// Un estudio en la línea de tiempo.
struct FilaEstudio: View {
    let estudio: Estudio
    var veResultado: Bool
    var ultima: Bool

    private var colorPunto: Color { veResultado ? Tema.color(estudio.resultado) : Color.secondary }
    /// Clasificación y conducta: solo las ve el médico.
    private var detalleClinico: String? {
        let partes = [estudio.clasificacion, estudio.conducta?.nombre].compactMap { $0 }
        return partes.isEmpty ? nil : partes.joined(separator: " · ")
    }

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
                }
                // La etapa la ven todos (no es dato clínico); el resultado, solo quien tiene permiso.
                if veResultado || estudio.etapa != nil {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Tema.Espacio.s) { chips }
                        VStack(alignment: .leading, spacing: Tema.Espacio.xs) { chips }
                    }
                }
                if veResultado {
                    if let detalle = detalleClinico {
                        Text(detalle).font(.nota.weight(.semibold))
                    }
                    if let nota = estudio.nota { Text(nota).font(.nota).foregroundStyle(.secondary) }
                }
            }
            .padding(.top, Tema.Espacio.xs)
            .padding(.bottom, ultima ? 0 : Tema.Espacio.l)
        }
        .accessibilityElement(children: .combine)
    }
}

extension FilaEstudio {
    @ViewBuilder fileprivate var chips: some View {
        if veResultado {
            Chip(texto: estudio.resultado.nombre, icono: Tema.icono(estudio.resultado),
                 color: Tema.color(estudio.resultado))
        }
        if let etapa = estudio.etapa, let texto = estudio.etapaTexto {
            Chip(texto: texto, icono: Tema.icono(etapa), color: Tema.color(etapa))
                .accessibilityLabel("Etapa: \(texto)")
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
    @State private var clasificacion = ""
    @State private var conducta: Conducta?
    @State private var nota = ""
    @State private var dictado = ""
    @State private var interpretando = false
    @State private var guardado = false
    @State private var foto: PhotosPickerItem?
    @State private var leyendo = false
    @State private var leido: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        PhotosPicker(selection: $foto, matching: .images) {
                            Label("Leer hoja", systemImage: "doc.viewfinder")
                        }
                        Spacer()
                        Menu("Ejemplo") {
                            Button("Hoja de hoy: Eulalia") { leerEjemplo("eulalia-hoy-p2") }
                            Button("Hoja de 2025: Eulalia") { leerEjemplo("eulalia-p2") }
                            Button("Revisión mamaria: Rosa María") { leerEjemplo("eira-mamaria-2") }
                            Button("Citología: Rosa María") { leerEjemplo("eira-citologia") }
                        }
                        if leyendo { ProgressView().padding(.leading, 8) }
                    }
                    if let leido {
                        Label(leido, systemImage: "checkmark.circle.fill")
                            .font(.footnote).foregroundStyle(Tema.verde)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                } header: {
                    Text("Desde la hoja")
                } footer: {
                    Text("Foto de la hoja de diagnóstico. Se lee en el teléfono; revisa antes de guardar.")
                }
                Section {
                        TextField("mastografía normal, regresa en un año", text: $dictado, axis: .vertical)
                        Button {
                            Task { await interpretar() }
                        } label: {
                            HStack {
                                Label(Inteligencia.disponible ? "Llenar con IA" : "Llenar", systemImage: Inteligencia.disponible ? "apple.intelligence" : "text.badge.checkmark")
                                if interpretando { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(dictado.limpio.isEmpty || interpretando)
                    } header: {
                        Text("Dictar")
                    } footer: {
                        Text("Usa el micrófono del teclado. No necesita internet.")
                    }
                Section("Estudio") {
                    Picker("Tipo", selection: $tipo) {
                        ForEach(TipoEstudio.allCases, id: \.self) { Text($0.nombre).tag($0) }
                    }
                    Picker("Resultado", selection: $resultado) {
                        ForEach(Resultado.allCases, id: \.self) { Text($0.nombre).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if !Clasificacion.opciones(tipo).isEmpty {
                        Picker("Clasificación", selection: $clasificacion) {
                            Text("Sin clasificar").tag("")
                            ForEach(Clasificacion.opciones(tipo), id: \.self) { Text(Clasificacion.corta($0)).tag($0) }
                        }
                    }
                    Picker("Conducta", selection: $conducta) {
                        Text("Sin definir").tag(Conducta?.none)
                        ForEach(Conducta.allCases, id: \.self) { Text($0.nombre).tag(Conducta?.some($0)) }
                    }
                    TextField("Nota", text: $nota, axis: .vertical)
                }
            }
            .onChange(of: tipo) { if !Clasificacion.opciones(tipo).contains(clasificacion) { clasificacion = "" } }
            .onChange(of: clasificacion) { sugerir() }
            .onChange(of: foto) { _, f in
                Task {
                    guard let f, let d = try? await f.loadTransferable(type: Data.self), let img = UIImage(data: d) else { return }
                    await leerImagen(img)
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
        .presentationDetents([.large])
        #if DEBUG
        .onAppear {
            if ModoCaptura.pantalla == "estudio" { tipo = .mastografia; clasificacion = "BI-RADS 4" }
        }
        #endif
    }

    private func interpretar() async {
        interpretando = true
        if Inteligencia.disponible, let e = await Inteligencia.dictarEstudio(dictado) {
            withAnimation(Tema.resorte) { tipo = e.tipo; resultado = e.resultado; nota = e.nota ?? nota }
        }
        // Lo que el dictado dice con todas sus letras (BI-RADS, Bethesda, «referir») manda sobre el modelo.
        var r = LecturaEstudio.desdeTexto(dictado)
        r.nota = nil
        aplicar(r, avisar: false)
        interpretando = false
    }

    private func aplicar(_ r: EstudioLeido, avisar: Bool = true) {
        withAnimation(Tema.resorte) {
            if let t = r.tipo { tipo = t }
            if let c = r.clasificacion { clasificacion = c; sugerir() }
            if r.referida { conducta = .referencia }
            if let n = r.nota { nota = n }
            if avisar {
                leido = [r.clasificacion, r.referida ? "referida" : nil].compactMap { $0 }.joined(separator: " · ")
                if leido?.isEmpty == true { leido = "No encontré BI-RADS ni Bethesda; revisa la nota" }
            }
        }
    }

    private func leerEjemplo(_ nombre: String) {
        guard let url = Bundle.main.url(forResource: nombre, withExtension: "jpg"),
              let img = UIImage(contentsOfFile: url.path) else { return }
        Task { await leerImagen(img) }
    }

    private func leerImagen(_ img: UIImage) async {
        leyendo = true; leido = nil
        if let r = try? await LecturaEstudio.leer(img) { aplicar(r) } else { leido = "No se pudo leer la hoja" }
        leyendo = false
    }

    /// Al elegir la clasificación propone la conducta y el resultado; el médico los puede cambiar.
    private func sugerir() {
        guard let s = Clasificacion.sugerencia(clasificacion) else { return }
        withAnimation(Tema.resorte) { conducta = s.conducta; if let r = s.resultado { resultado = r } }
    }

    private func guardar() {
        let e = NuevoEstudio(tipo: tipo, fecha: .now, resultado: resultado, nota: nota.limpio.nilSiVacio,
                             clasificacion: clasificacion.nilSiVacio, conducta: conducta)
        if (try? sync.repositorio.agregarEstudio(e, a: paciente)) != nil {
            guardado = true
            cerrar()
        }
    }
}

/// Clasificaciones de la lista corta: BI-RADS para mama, Bethesda para papanicolaou.
/// El texto es el que la API reconoce para el seguimiento («BI-RADS 4», «Bethesda: LSIL»).
enum Clasificacion {
    static func opciones(_ t: TipoEstudio) -> [String] {
        switch t {
        case .mastografia, .ultrasonido: (0...5).map { "BI-RADS \($0)" }
        case .papanicolaou: ["NILM", "ASC-US", "ASC-H", "LSIL", "HSIL", "AGC"].map { "Bethesda: \($0)" }
        case .exploracion: []
        }
    }

    static func corta(_ c: String) -> String {
        c == "Bethesda: NILM" ? "NILM (negativo)" : c.replacingOccurrences(of: "Bethesda: ", with: "")
    }

    static func sugerencia(_ c: String) -> (conducta: Conducta, resultado: Resultado?)? {
        switch c {
        case "BI-RADS 0": (.imagenComplementaria, .pendiente)
        case "BI-RADS 1", "BI-RADS 2": (.rutina1Anio, .normal)
        case "BI-RADS 3": (.evaluacion6Meses, nil)
        case "BI-RADS 4", "BI-RADS 5": (.referencia, .anormal)
        case "Bethesda: NILM": (.rutina1Anio, .normal)
        case _ where c.hasPrefix("Bethesda: "): (.referencia, .anormal)
        default: nil
        }
    }
}
