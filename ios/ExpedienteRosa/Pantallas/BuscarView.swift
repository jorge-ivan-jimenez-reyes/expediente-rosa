import SwiftUI
import SwiftData

/// Antes de dar de alta: ¿ya vino? Busca en lo que hay en el teléfono, sin señal.
struct BuscarView: View {
    @Query(sort: \Paciente.apellidoPaterno) private var pacientes: [Paciente]
    @State private var nombre = ""
    @State private var paterno = ""
    @State private var materno = ""
    @State private var edad = ""
    @State private var comunidad = ""
    @State private var ruta: [Paciente] = []
    @State private var alta: NuevaPaciente?
    @State private var escanear = false
    @State private var explicacion: String?
    @State private var explicando = false

    private var consulta: NuevaPaciente {
        NuevaPaciente(nombre: nombre, apellidoPaterno: paterno, apellidoMaterno: materno.nilSiVacio,
                      nacimiento: nil, edad: Int(edad), comunidad: comunidad, municipio: nil)
    }
    private var hayConsulta: Bool { !nombre.limpio.isEmpty && !paterno.limpio.isEmpty }
    private var candidatas: [Candidata] {
        hayConsulta ? Array(Coincidencias.buscar(consulta, en: pacientes).prefix(5)) : []
    }

    var body: some View {
        NavigationStack(path: $ruta) {
            ScrollView {
                VStack(alignment: .leading, spacing: Tema.Espacio.l) {
                    formulario
                    resultados
                }
                .padding(.horizontal, Tema.Espacio.l)
                .padding(.bottom, Tema.Espacio.xxl)
                .animation(Tema.resorte, value: candidatas.map(\.id))
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Tema.fondo)
            .navigationTitle("Buscar")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { SelectorRol() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Escanear") { escanear = true }
                        .accessibilityHint("Lee una hoja de papel con la cámara")
                }
            }
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
                    alta = leida
                }
            }
            .task(id: candidatas.first?.id) { await explicarPrimera() }
            #if DEBUG
            .onAppear(perform: abrirCaptura)
            #endif
        }
    }

    private var formulario: some View {
        Tarjeta {
            CampoTexto(titulo: "Nombre", texto: $nombre)
            Renglon {
                CampoTexto(titulo: "Apellido paterno", texto: $paterno)
                CampoTexto(titulo: "Apellido materno", texto: $materno)
            }
            Renglon {
                CampoTexto(titulo: "Edad", texto: $edad, teclado: .numberPad)
                CampoTexto(titulo: "Comunidad", texto: $comunidad)
            }
        }
        .padding(.top, Tema.Espacio.s)
    }

    @ViewBuilder private var resultados: some View {
        if hayConsulta {
            if candidatas.isEmpty {
                Text("Sin coincidencias en el teléfono")
                    .font(.cuerpo).foregroundStyle(.secondary)
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
            Text("\(pacientes.count) pacientes en el teléfono. Se busca sin señal.")
                .font(.nota).foregroundStyle(.secondary)
                .contentTransition(.numericText(value: Double(pacientes.count)))
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
        nombre = ""; paterno = ""; materno = ""; edad = ""; comunidad = ""
    }

    #if DEBUG
    /// Modo captura: deja la pantalla pedida abierta, con datos ficticios.
    private func abrirCaptura() {
        switch ModoCaptura.pantalla {
        case "buscar-resultados":
            let q = ModoCaptura.consulta
            nombre = q.nombre; paterno = q.apellidoPaterno; materno = q.apellidoMaterno ?? ""
            edad = q.edad.map(String.init) ?? ""; comunidad = q.comunidad
        case "expediente", "expediente-medico":
            if let p = pacientes.first(where: { $0.folio == ModoCaptura.folioExpediente }) { ruta = [p] }
        case "alta": alta = ModoCaptura.altaInicial
        case "escanear": escanear = true
        default: break
        }
    }
    #endif
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
