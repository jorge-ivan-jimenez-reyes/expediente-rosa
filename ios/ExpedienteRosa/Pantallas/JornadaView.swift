import SwiftUI

/// Estado de la jornada: señal, lo que falta por mandar, preparar antes de salir.
struct JornadaView: View {
    @Environment(Sincronizador.self) private var sync
    @AppStorage("comunidad") private var comunidad = ""
    /// Entidad federativa de la jornada. Va en cada visita nueva junto con «comunidad · mes año».
    @AppStorage("estado") private var entidad = ""
    @AppStorage("api_url") private var apiURL = Config.apiURL.absoluteString
    @State private var resultado: ResultadoSync?
    @State private var preparadas: Int?
    @State private var error: String?
    @State private var preparando = false
    @State private var exito = 0
    /// Unos segundos después de sincronizar bien, la mascota rebota.
    @State private var celebrando = false

    var body: some View {
        @Bindable var sync = sync
        NavigationStack {
            ScrollView {
                VStack(spacing: Tema.Espacio.l) {
                    ProximaJornada()
                    estado
                    QuienVeQue()
                    if let resultado { tarjetaResultado(resultado) }
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.nota).foregroundStyle(Tema.rojo)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .transition(.opacity)
                    }
                    preparar
                    Tarjeta {
                        Toggle("Simular sin señal", isOn: $sync.simularSinSenal.animation(Tema.resorte))
                            .font(.cuerpo)
                            .tint(Tema.ambar)
                            .frame(minHeight: Tema.toque)
                    }
                    servidor
                    ParaEIRA().padding(.top, Tema.Espacio.l)
                }
                .padding(Tema.Espacio.l)
                .animation(Tema.resorte, value: resultado?.aplicados)
                .animation(Tema.resorte, value: error)
                .animation(Tema.resorte, value: sync.proximasJornadas.count)
            }
            .background(Tema.fondo)
            .navigationTitle("Jornada")
            .toolbar { ToolbarItem(placement: .topBarLeading) { SelectorRol() } }
            .sensoryFeedback(.success, trigger: exito)
        }
    }

    private var estado: some View {
        Tarjeta(espacio: Tema.Espacio.l) {
            HStack {
                EstadoSenal(enLinea: sync.enLinea)
                Spacer()
                if let u = sync.ultimaSync {
                    Text("Última: \(u.formatted(.relative(presentation: .named)))")
                        .font(.nota).foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .center, spacing: Tema.Espacio.s) {
                HStack(alignment: .firstTextBaseline, spacing: Tema.Espacio.s) {
                    Text("\(sync.pendientes)")
                        .font(.cifra)
                        .contentTransition(.numericText(value: Double(sync.pendientes)))
                        .animation(Tema.resorte, value: sync.pendientes)
                    Text(sync.pendientes == 1 ? "registro por mandar" : "registros por mandar")
                        .font(.cuerpo).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 0)
                if let estado = estadoMascota {
                    Mascota(estado: estado, tamano: 56)
                        .padding(.vertical, -6) // no agranda el renglón
                        .transition(.opacity.combined(with: .scale(scale: 0.8)))
                }
            }
            .animation(Tema.resorte, value: estadoMascota)
            Button {
                Task { await sincronizar() }
            } label: {
                Label(sync.sincronizando ? "Sincronizando…" : "Sincronizar", systemImage: "arrow.triangle.2.circlepath")
                    .symbolEffect(.rotate, options: .repeating, isActive: sync.sincronizando)
                    .font(.seccion)
                    .frame(maxWidth: .infinity, minHeight: Tema.toque)
            }
            .buttonStyle(.glassProminent)
            .tint(Tema.rosaRelleno)
            .disabled(!sync.enLinea || sync.sincronizando)
        }
    }

    /// La mascota solo aparece cuando tiene algo que decir: sincroniza, no hay señal, salió bien, o aún no hay jornadas.
    private var estadoMascota: Mascota.Estado? {
        if sync.sincronizando || sync.preparandoProximas || preparando { return .buscando }
        if !sync.enLinea { return .sinSenal }
        if celebrando { return .contenta }
        return .reposo   // siempre acompaña: reposa y parpadea
    }

    /// Bajar una comunidad a mano. Si coordinación programó jornadas, queda plegado como respaldo.
    @ViewBuilder private var preparar: some View {
        Group {
            if sync.proximasJornadas.isEmpty {
                Tarjeta {
                    Text("Preparar jornada").font(.seccion)
                    Text("Baja al teléfono las pacientes de la comunidad antes de salir.")
                        .font(.nota).foregroundStyle(.secondary)
                    camposPreparar
                }
            } else {
                Tarjeta {
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: Tema.Espacio.m) { camposPreparar }
                            .padding(.top, Tema.Espacio.s)
                    } label: {
                        Text("Otra comunidad").font(.cuerpo).foregroundStyle(.primary)
                    }
                    .tint(.secondary)
                    .frame(minHeight: Tema.toque)
                }
            }
        }
        .animation(Tema.resorte, value: preparadas)
    }

    @ViewBuilder private var camposPreparar: some View {
        selectorEstado
        HStack(alignment: .bottom, spacing: Tema.Espacio.m) {
            CampoTexto(titulo: "Comunidad", texto: $comunidad)
            Button {
                Task { await prepararJornada() }
            } label: {
                Group {
                    if preparando { ProgressView() } else { Text("Bajar") }
                }
                .font(.seccion)
                .frame(minWidth: 64, minHeight: Tema.toque)
            }
            .buttonStyle(.glass)
            .tint(Tema.rosa)
            .disabled(!sync.enLinea || preparando)
        }
        if let preparadas {
            Label("\(preparadas) pacientes en el teléfono", systemImage: "checkmark.circle.fill")
                .font(.nota).foregroundStyle(Tema.verde)
                .transition(.opacity)
        }
    }

    private var selectorEstado: some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
            Text("Estado").font(.nota).foregroundStyle(.secondary)
            Picker("Estado", selection: $entidad) {
                Text("Sin elegir").tag("")
                Divider()
                ForEach(Entidades.todas.prefix(3), id: \.self) { Text($0).tag($0) }
                Divider()
                ForEach(Entidades.todas.dropFirst(3), id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.menu)
            .tint(entidad.isEmpty ? .secondary : .primary)
            .font(.cuerpo)
            .frame(maxWidth: .infinity, minHeight: Tema.toque, alignment: .leading)
            .padding(.horizontal, Tema.Espacio.xs)
            .background(Tema.campo, in: .rect(cornerRadius: Tema.Radio.campo))
        }
    }

    private func tarjetaResultado(_ r: ResultadoSync) -> some View {
        Tarjeta {
            Text("Última sincronización").font(.seccion)
            HStack(alignment: .top, spacing: Tema.Espacio.m) {
                cifra(r.aplicados, "nuevos")
                cifra(r.repetidos, "ya estaban")
                cifra(r.posiblesDuplicados.count, "a revisar")
            }
        }
        .transition(.opacity)
    }

    private func cifra(_ valor: Int, _ etiqueta: String) -> some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
            Text("\(valor)").font(.seccion).monospacedDigit().contentTransition(.numericText())
            Text(etiqueta).font(.nota).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var servidor: some View {
        Tarjeta {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: Tema.Espacio.s) {
                    TextField("http://IP:8787/api", text: $apiURL)
                        .font(.cuerpo)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL)
                        .padding(.horizontal, Tema.Espacio.m)
                        .frame(minHeight: Tema.toque)
                        .background(Tema.campo, in: .rect(cornerRadius: Tema.Radio.campo))
                    Button("Usar servidor") {
                        if let u = URL(string: apiURL) { sync.api = ClienteAPI(base: u) }
                    }
                    .frame(minHeight: Tema.toque)
                    .tint(Tema.rosa)
                }
                .padding(.top, Tema.Espacio.s)
            } label: {
                Text("Servidor").font(.cuerpo).foregroundStyle(.primary)
            }
            .tint(.secondary)
            .frame(minHeight: Tema.toque)
        }
    }

    private func sincronizar() async {
        error = nil
        do {
            let r = try await sync.sincronizar()
            withAnimation(Tema.resorteLogro) { resultado = r }
            exito += 1
            celebrar()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func celebrar() {
        celebrando = true
        Task {
            try? await Task.sleep(for: .seconds(2.4))
            celebrando = false
        }
    }

    private func prepararJornada() async {
        error = nil; preparando = true
        do {
            let n = try await sync.prepararJornada(comunidad: comunidad.limpio)
            preparadas = n
            exito += 1
            celebrar()
        } catch {
            self.error = error.localizedDescription
        }
        preparando = false
    }
}

/// Control de acceso explicado en una tarjeta. Tocar un rol lo elige (igual que el selector de arriba).
struct QuienVeQue: View {
    @AppStorage("rol") private var rol: Rol = .enfermeria
    @AppStorage("nombre") private var nombre = ""

    var body: some View {
        Tarjeta(espacio: Tema.Espacio.xs) {
            Text("Quién ve qué").font(.seccion).padding(.bottom, Tema.Espacio.xs)
            CampoTexto(titulo: "Tu nombre (va en la bitácora)", texto: $nombre)
                .padding(.bottom, Tema.Espacio.s)
            ForEach(Rol.allCases) { r in
                Button {
                    withAnimation(Tema.resorte) { rol = r }
                } label: {
                    HStack(alignment: .center, spacing: Tema.Espacio.m) {
                        Image(systemName: r.icono).foregroundStyle(Tema.rosa).frame(width: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.nombre).font(.cuerpo.weight(.semibold)).foregroundStyle(.primary)
                            Text(r.permisos).font(.nota).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        if rol == r { Image(systemName: "checkmark").font(.nota.weight(.bold)).foregroundStyle(Tema.rosa) }
                    }
                    .padding(.horizontal, Tema.Espacio.s).padding(.vertical, Tema.Espacio.s)
                    .frame(minHeight: Tema.toque)
                    .background(rol == r ? Tema.rosaSuave : .clear, in: .rect(cornerRadius: Tema.Radio.campo))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(rol == r ? .isSelected : [])
            }
        }
        .sensoryFeedback(.selection, trigger: rol)
    }
}

extension Rol {
    var permisos: String {
        switch self {
        case .enfermeria: "Captura y registra. No ve resultados."
        case .medico: "Ve resultados y agrega estudios."
        case .coordinadora: "Revisa duplicados, conflictos y bitácora."
        }
    }
}
