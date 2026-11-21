import SwiftUI
import SwiftData

/// Antes de dar de alta: ¿ya vino? Busca en lo que hay en el teléfono, sin señal.
/// Lo primero es escanear la hoja de papel; escribir los datos es la segunda vía.
struct BuscarView: View {
    /// Lleva a la pestaña Jornada (para elegir comunidad o bajar sus pacientes).
    var irAJornada: () -> Void = {}

    @Environment(Sincronizador.self) private var sync
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @Query(sort: \Paciente.apellidoPaterno) private var pacientes: [Paciente]
    @Query(sort: \Estudio.fecha, order: .reverse) private var estudios: [Estudio]
    /// Comunidad de trabajo: la que eligen en Jornada.
    @AppStorage("comunidad") private var comunidadTrabajo = ""

    @State private var nombre = ""
    @State private var paterno = ""
    @State private var materno = ""
    @State private var edad = ""
    /// Solo si la cambian para esta búsqueda (a mano o porque la hoja dice otra). Si no, vale la de trabajo.
    @State private var comunidadEditada: String?
    /// Lo que leyó la hoja escaneada: marca en rosa los campos que siguen igual que en la hoja.
    @State private var hoja: DatosHoja?
    @State private var ruta: [Paciente] = []
    @State private var alta: NuevaPaciente?
    @State private var escanear = false
    @State private var editandoComunidad = false
    @State private var borradorComunidad = ""
    @State private var explicacion: String?
    @State private var explicando = false
    @State private var escaneos = 0

    private var comunidad: String { comunidadEditada ?? comunidadTrabajo }

    private var consulta: NuevaPaciente {
        NuevaPaciente(nombre: nombre, apellidoPaterno: paterno, apellidoMaterno: materno.nilSiVacio,
                      nacimiento: nil, edad: Int(edad), comunidad: comunidad, municipio: nil)
    }
    private var hayConsulta: Bool { !nombre.limpio.isEmpty && !paterno.limpio.isEmpty }
    private var algoEscrito: Bool { ![nombre, paterno, materno, edad].allSatisfy { $0.limpio.isEmpty } }
    private var candidatas: [Candidata] {
        hayConsulta ? Array(Coincidencias.buscar(consulta, en: pacientes).prefix(5)) : []
    }

    /// Pacientes de una comunidad que ya están en el teléfono (sin las que se unieron a otra).
    private func deComunidad(_ c: String) -> [Paciente] {
        let n = Coincidencias.normalizar(c)
        guard !n.isEmpty else { return [] }
        return pacientes.filter { $0.fusionadaEn == nil && Coincidencias.normalizar($0.comunidad) == n }
    }

    var body: some View {
        NavigationStack(path: $ruta) {
            ScrollView {
                VStack(alignment: .leading, spacing: Tema.Espacio.l) {
                    contexto
                    botonEscanear
                    formulario
                    resultados
                }
                .padding(.horizontal, Tema.Espacio.l)
                .padding(.bottom, Tema.Espacio.xxl)
                .animation(Tema.resorte, value: candidatas.map(\.id))
                .animation(Tema.resorte, value: hayConsulta)
                .animation(Tema.resorte, value: hoja)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Tema.fondo)
            .navigationTitle("Buscar")
            .toolbar { ToolbarItem(placement: .topBarLeading) { SelectorRol() } }
            .safeAreaInset(edge: .bottom) {
                if hayConsulta {
                    botonNueva
                        .padding(.horizontal, Tema.Espacio.l)
                        .padding(.bottom, Tema.Espacio.s)
                        .transition(.opacity)
                }
            }
            .navigationDestination(for: Paciente.self) { ExpedienteView(paciente: $0) }
            .sheet(item: $alta) { p in
                AltaView(inicial: p) { nueva in
                    alta = nil
                    limpiar()
                    ruta = [nueva]
                }
            }
            .sheet(isPresented: $escanear) {
                EscanearView { leida in
                    escanear = false
                    llenarDesdeHoja(leida)
                }
            }
            .alert("Comunidad", isPresented: $editandoComunidad) {
                TextField("Comunidad", text: $borradorComunidad)
                    .textInputAutocapitalization(.words)
                Button("Usar") { usarComunidad(borradorComunidad) }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Solo para esta búsqueda. La de la jornada se cambia en Jornada.")
            }
            .sensoryFeedback(.success, trigger: escaneos)
            .task(id: candidatas.first?.id) { await explicarPrimera() }
            #if DEBUG
            .onAppear(perform: abrirCaptura)
            #endif
        }
    }

    // MARK: - Contexto: señal y cuántas hay en el teléfono

    private var contexto: some View {
        let cuantas = comunidadTrabajo.limpio.isEmpty ? pacientes.filter { $0.fusionadaEn == nil }.count
                                                     : deComunidad(comunidadTrabajo).count
        let numero = cuantas == 0 ? "Ninguna" : "\(cuantas)"
        let texto = comunidadTrabajo.limpio.isEmpty
            ? "\(numero) en el teléfono"
            : "\(numero) en el teléfono · \(comunidadTrabajo)"
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: Tema.Espacio.m) {
                EstadoSenal(enLinea: sync.enLinea)
                Text(texto).lineLimit(1)
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: Tema.Espacio.s) {
                EstadoSenal(enLinea: sync.enLinea)
                Text(texto).fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(.nota)
        .foregroundStyle(.secondary)
        .contentTransition(.numericText(value: Double(cuantas)))
        .animation(Tema.resorte, value: cuantas)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Escanear: la acción principal

    /// Grande mientras no hay búsqueda; con resultados se encoge a un renglón para dejarles lugar.
    private var botonEscanear: some View {
        let compacto = hayConsulta
        return Button { escanear = true } label: {
            Group {
                if compacto {
                    HStack(spacing: Tema.Espacio.m) {
                        Image(systemName: "doc.viewfinder")
                            .font(.title3.weight(.medium))
                            .accessibilityHidden(true)
                        Text(hoja == nil ? "Escanear hoja" : "Escanear otra hoja").font(.seccion)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.nota.weight(.bold))
                            .accessibilityHidden(true)
                    }
                    .foregroundStyle(Tema.rosa)
                    .padding(.horizontal, Tema.Espacio.l)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    .background(Tema.rosaSuave, in: .rect(cornerRadius: Tema.Radio.tarjeta))
                } else {
                    HStack(spacing: Tema.Espacio.l) {
                        Image(systemName: "doc.viewfinder")
                            .font(.system(size: 30, weight: .medium))
                            .frame(width: 56, height: 56)
                            .background(.white.opacity(0.18), in: .rect(cornerRadius: Tema.Radio.campo))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                            Text("Escanear hoja").font(.title3.weight(.bold))
                            Text("Foto de la hoja de papel; la app busca a la paciente")
                                .font(.nota)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.right")
                            .font(.nota.weight(.bold))
                            .accessibilityHidden(true)
                    }
                    .foregroundStyle(.white)
                    .padding(Tema.Espacio.l)
                    .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
                    .background(Tema.rosaRelleno, in: .rect(cornerRadius: Tema.Radio.tarjeta))
                }
            }
            .multilineTextAlignment(.leading)
            .contentShape(.rect(cornerRadius: Tema.Radio.tarjeta))
        }
        .buttonStyle(Presionable())
        .accessibilityHint("Abre la cámara o una foto; los datos de la hoja llenan la búsqueda")
    }

    // MARK: - Formulario

    private var formulario: some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
            HStack(alignment: .center) {
                if hoja != nil {
                    Label("Datos de la hoja escaneada · revisa", systemImage: "doc.viewfinder")
                        .font(.nota.weight(.semibold))
                        .foregroundStyle(Tema.rosa)
                        .padding(.horizontal, Tema.Espacio.s).padding(.vertical, Tema.Espacio.xs)
                        .background(Tema.rosaSuave, in: .capsule)
                        .transition(.opacity)
                } else {
                    Text("o escribe sus datos")
                        .font(.nota).foregroundStyle(.secondary)
                        .transition(.opacity)
                }
                Spacer(minLength: Tema.Espacio.s)
                if algoEscrito {
                    Button("Borrar") { withAnimation(Tema.resorte) { limpiar() } }
                        .font(.nota.weight(.semibold))
                        .tint(Tema.rosa)
                        .frame(minHeight: Tema.toque)
                        .transition(.opacity)
                }
            }
            .frame(minHeight: Tema.toque)

            Tarjeta {
                CampoTexto(titulo: "Nombre", texto: $nombre, resaltado: deHoja(nombre, hoja?.nombre))
                Renglon {
                    CampoTexto(titulo: "Apellido paterno", texto: $paterno, resaltado: deHoja(paterno, hoja?.paterno))
                    CampoTexto(titulo: "Apellido materno", texto: $materno, resaltado: deHoja(materno, hoja?.materno))
                }
                Renglon {
                    CampoTexto(titulo: "Edad", texto: $edad, teclado: .numberPad, resaltado: deHoja(edad, hoja?.edad))
                        .frame(maxWidth: 104)
                    chipComunidad
                }
            }
        }
    }

    /// La comunidad ya viene puesta (la de la jornada). Tocarla la cambia solo para esta búsqueda.
    private var chipComunidad: some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
            Text("Comunidad").font(.nota).foregroundStyle(.secondary)
            Button {
                borradorComunidad = comunidad
                editandoComunidad = true
            } label: {
                HStack(spacing: Tema.Espacio.s) {
                    Text(comunidad.limpio.isEmpty ? "Elegir" : comunidad)
                        .font(.cuerpo.weight(.medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Image(systemName: "pencil")
                        .font(.nota.weight(.semibold))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(Tema.rosa)
                .padding(.horizontal, Tema.Espacio.m)
                .frame(minHeight: Tema.toque)
                .background(deHoja(comunidad, hoja?.comunidad) ? Tema.rosaSuave : Tema.campo, in: .capsule)
                .contentShape(.capsule)
            }
            .buttonStyle(Presionable())
            .accessibilityLabel("Comunidad: \(comunidad.limpio.isEmpty ? "sin elegir" : comunidad)")
            .accessibilityHint("Cámbiala solo para esta búsqueda")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func deHoja(_ actual: String, _ leido: String?) -> Bool {
        guard let leido, !leido.limpio.isEmpty else { return false }
        return actual.limpio == leido.limpio
    }

    // MARK: - Resultados / estado vacío

    @ViewBuilder private var resultados: some View {
        if hayConsulta {
            if candidatas.isEmpty {
                Label("Sin coincidencias en el teléfono", systemImage: "person.crop.circle.badge.questionmark")
                    .font(.cuerpo).foregroundStyle(.secondary)
                    .padding(.top, Tema.Espacio.s)
                    .transition(.opacity)
            } else {
                ForEach(Array(candidatas.enumerated()), id: \.element.id) { i, c in
                    FilaCandidata(candidata: c, explicacion: i == 0 ? explicacion : nil, explicando: i == 0 && explicando) {
                        ruta = [c.paciente]
                    }
                    .transition(.opacity)
                }
            }
        } else {
            YaVinieron(pacientes: deComunidad(comunidad), estudios: estudios, comunidad: comunidad,
                       filtro: [nombre, paterno, materno].joined(separator: " "),
                       abrir: { ruta = [$0] }, irAJornada: irAJornada)
                .transition(.opacity)
        }
    }

    /// Si hay coincidencias, «Es ella» es lo probable y este botón baja de peso.
    @ViewBuilder private var botonNueva: some View {
        if candidatas.isEmpty {
            BotonPrincipal(titulo: "Es nueva", icono: "person.badge.plus") { alta = consulta }
        } else {
            Button { alta = consulta } label: {
                Label("Es nueva", systemImage: "person.badge.plus")
                    .font(.seccion)
                    .frame(maxWidth: .infinity, minHeight: Tema.toque)
            }
            .buttonStyle(.glass)
            .tint(Tema.rosa)
        }
    }

    // MARK: - Acciones

    /// La hoja llena la búsqueda campo por campo: si ya vino, aparece abajo; si no, «Es nueva» abre el alta prellenada.
    private func llenarDesdeHoja(_ p: NuevaPaciente) {
        let leida = DatosHoja(nombre: p.nombre, paterno: p.apellidoPaterno, materno: p.apellidoMaterno ?? "",
                              edad: p.edad.map(String.init) ?? edadDesde(p.nacimiento), comunidad: p.comunidad)
        limpiar()
        let pasos: [() -> Void] = [
            { hoja = leida },
            { nombre = leida.nombre },
            { paterno = leida.paterno },
            { materno = leida.materno },
            { edad = leida.edad },
            { if !leida.comunidad.limpio.isEmpty { usarComunidad(leida.comunidad) } },
        ]
        Task {
            // Espera a que baje la hoja para que se vea cómo se llenan los campos.
            if !sinMovimiento { try? await Task.sleep(for: .milliseconds(380)) }
            for paso in pasos {
                withAnimation(Tema.resorte) { paso() }
                if !sinMovimiento { try? await Task.sleep(for: .milliseconds(90)) }
            }
            escaneos += 1
        }
    }

    private func usarComunidad(_ c: String) {
        let c = c.limpio
        comunidadEditada = c.isEmpty || c == comunidadTrabajo ? nil : c
    }

    private func explicarPrimera() async {
        explicacion = nil
        guard let c = candidatas.first, Inteligencia.disponible else { return }
        try? await Task.sleep(for: .milliseconds(500)) // espera a que termine de escribir
        if Task.isCancelled { return }
        explicando = true
        let texto = await Inteligencia.explicar(c, para: consulta)
        if Task.isCancelled { return }
        withAnimation(Tema.resorte) { explicacion = texto; explicando = false }
    }

    private func limpiar() {
        nombre = ""; paterno = ""; materno = ""; edad = ""
        comunidadEditada = nil; hoja = nil
    }

    #if DEBUG
    /// Modo captura: deja la pantalla pedida abierta, con datos ficticios.
    private func abrirCaptura() {
        switch ModoCaptura.pantalla {
        case "buscar-resultados":
            let q = ModoCaptura.consulta
            nombre = q.nombre; paterno = q.apellidoPaterno; materno = q.apellidoMaterno ?? ""
            edad = q.edad.map(String.init) ?? ""; usarComunidad(q.comunidad)
        case "buscar-hoja":
            let p = ModoCaptura.hojaBuscar
            hoja = DatosHoja(nombre: p.nombre, paterno: p.apellidoPaterno, materno: p.apellidoMaterno ?? "",
                             edad: p.edad.map(String.init) ?? edadDesde(p.nacimiento), comunidad: p.comunidad)
            nombre = p.nombre; paterno = p.apellidoPaterno; materno = p.apellidoMaterno ?? ""
            edad = hoja?.edad ?? ""; usarComunidad(p.comunidad)
        case "expediente", "expediente-medico", "editar", "estudio":
            if let p = pacientes.first(where: { $0.folio == ModoCaptura.folioExpediente }) { ruta = [p] }
        case "alta": alta = ModoCaptura.altaInicial
        case "escanear": escanear = true
        default: break
        }
    }
    #endif
}

/// Lo que leyó la hoja, ya como texto de los campos.
private struct DatosHoja: Equatable {
    var nombre, paterno, materno, edad, comunidad: String
}

/// Respuesta al dedo apenas se presiona.
private struct Presionable: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(Tema.resorte, value: configuration.isPressed)
    }
}

// MARK: - Estado vacío: las que ya están en el teléfono

/// Pacientes de la comunidad que ya vinieron, por apellido. Mientras se escribe el nombre, se van filtrando.
private struct YaVinieron: View {
    var pacientes: [Paciente]
    var estudios: [Estudio]
    var comunidad: String
    var filtro: String
    var abrir: (Paciente) -> Void
    var irAJornada: () -> Void

    private var ordenadas: [Paciente] {
        let llave = { (p: Paciente) in "\(p.apellidoPaterno) \(p.apellidoMaterno ?? "") \(p.nombre)" }
        return pacientes.sorted { llave($0).localizedStandardCompare(llave($1)) == .orderedAscending }
    }

    private var visibles: [Paciente] {
        let buscadas = Coincidencias.normalizar(filtro).split(separator: " ")
        guard !buscadas.isEmpty else { return ordenadas }
        return ordenadas.filter { p in
            let palabras = Coincidencias.normalizar(p.nombreCompleto).split(separator: " ")
            return buscadas.allSatisfy { b in palabras.contains { $0.hasPrefix(b) } }
        }
    }

    /// Último estudio de cada paciente (los estudios ya vienen del más nuevo al más viejo).
    private var ultimos: [String: Estudio] {
        var d: [String: Estudio] = [:]
        for e in estudios where d[e.pacienteId] == nil { d[e.pacienteId] = e }
        return d
    }

    var body: some View {
        if comunidad.limpio.isEmpty {
            aviso("Elige la comunidad de la jornada para ver aquí a sus pacientes.")
        } else if pacientes.isEmpty {
            aviso("No hay pacientes de \(comunidad) en el teléfono. Bájalas en Jornada antes de salir.")
        } else {
            let lista = visibles
            let ult = ultimos
            VStack(alignment: .leading, spacing: Tema.Espacio.s) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Ya vinieron").font(.seccion)
                    Spacer()
                    Text(lista.count == pacientes.count ? "\(pacientes.count)" : "\(lista.count) de \(pacientes.count)")
                        .font(.nota).monospacedDigit().foregroundStyle(.secondary)
                        .contentTransition(.numericText(value: Double(lista.count)))
                }
                .padding(.top, Tema.Espacio.s)
                .accessibilityElement(children: .combine)

                if lista.isEmpty {
                    Text("Nadie con ese nombre en \(comunidad).")
                        .font(.cuerpo).foregroundStyle(.secondary)
                        .padding(.vertical, Tema.Espacio.s)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(lista.enumerated()), id: \.element.id) { i, p in
                            if i > 0 { Divider().padding(.leading, Tema.Espacio.l) }
                            fila(p, ultimo: ult[p.id])
                        }
                    }
                    .background(Tema.superficie, in: .rect(cornerRadius: Tema.Radio.tarjeta))
                }
            }
            .animation(Tema.resorte, value: lista.map(\.id))
        }
    }

    private func fila(_ p: Paciente, ultimo: Estudio?) -> some View {
        Button { abrir(p) } label: {
            HStack(spacing: Tema.Espacio.m) {
                VStack(alignment: .leading, spacing: 2) {
                    Text([p.apellidoPaterno, p.apellidoMaterno].compactMap { $0 }.joined(separator: " ") + ", " + p.nombre)
                        .font(.cuerpo.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(detalle(p, ultimo: ultimo))
                        .font(.nota).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.nota.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .multilineTextAlignment(.leading)
            .padding(.horizontal, Tema.Espacio.l)
            .padding(.vertical, Tema.Espacio.m)
            .frame(minHeight: Tema.toque)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre su expediente")
    }

    /// «51 años · Papanicolaou, hace 2 días». Solo el tipo y la fecha: el resultado vive en el expediente.
    private func detalle(_ p: Paciente, ultimo: Estudio?) -> String {
        var partes: [String] = []
        if let e = p.edadActual { partes.append("\(e) años") }
        if let u = ultimo { partes.append("\(u.tipo.nombre), \(Self.cuando(u.fecha))") }
        else { partes.append("Sin estudios") }
        return partes.joined(separator: " · ")
    }

    private static let espanol = Locale(identifier: "es_MX")

    static func cuando(_ d: Date) -> String {
        let cal = Calendar.current
        let dias = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: .now)).day ?? 0
        switch dias {
        case ..<1: return "hoy"
        case 1: return "ayer"
        case 2..<31: return "hace \(dias) días"
        default: return d.formatted(.dateTime.month(.abbreviated).year().locale(espanol))
        }
    }

    private func aviso(_ texto: String) -> some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.m) {
            Text(texto)
                .font(.cuerpo).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: irAJornada) {
                Label("Ir a Jornada", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.seccion)
                    .frame(minHeight: Tema.toque)
                    .padding(.horizontal, Tema.Espacio.s)
            }
            .buttonStyle(.glass)
            .tint(Tema.rosa)
        }
        .padding(.top, Tema.Espacio.s)
    }
}

/// Una posible coincidencia. Toda la fila es el botón «Es ella».
struct FilaCandidata: View {
    var candidata: Candidata
    var explicacion: String?
    var explicando: Bool
    var esElla: () -> Void

    var body: some View {
        Button(action: esElla) {
            Tarjeta(espacio: Tema.Espacio.m) {
                HStack(alignment: .top, spacing: Tema.Espacio.m) {
                    AnilloPuntaje(puntaje: candidata.puntaje)
                    VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                        Text(candidata.paciente.nombreCompleto).font(.seccion).foregroundStyle(.primary)
                        Text(candidata.paciente.subtitulo).font(.nota).foregroundStyle(.secondary)
                        Text(candidata.razones.joined(separator: " · ").capitalizandoPrimera)
                            .font(.nota).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                LineaIA(texto: explicacion, cargando: explicando, esperando: "Comparando…")
                HStack(spacing: Tema.Espacio.xs) {
                    Spacer()
                    Text("Es ella").font(.seccion)
                    Image(systemName: "chevron.right").font(.nota.weight(.semibold))
                }
                .foregroundStyle(Tema.rosa)
            }
            .multilineTextAlignment(.leading)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Abre su expediente")
    }
}

extension String {
    var capitalizandoPrimera: String { prefix(1).uppercased() + dropFirst() }
}

extension NuevaPaciente: Identifiable {
    public var id: String { [nombre, apellidoPaterno, apellidoMaterno ?? "", comunidad].joined(separator: "|") }
}

/// Edad a partir de "AAAA-MM-DD" para la búsqueda.
private func edadDesde(_ nacimiento: String?) -> String {
    guard let n = nacimiento, let y = Int(n.prefix(4)) else { return "" }
    return String(Calendar.current.component(.year, from: .now) - y)
}
