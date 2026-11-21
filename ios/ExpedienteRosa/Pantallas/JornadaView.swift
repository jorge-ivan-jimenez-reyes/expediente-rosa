import SwiftUI

/// Estado de la jornada: señal, lo que falta por mandar, preparar antes de salir.
struct JornadaView: View {
    @Environment(Sincronizador.self) private var sync
    @AppStorage("comunidad") private var comunidad = ""
    @AppStorage("api_url") private var apiURL = Config.apiURL.absoluteString
    @State private var resultado: ResultadoSync?
    @State private var preparadas: Int?
    @State private var error: String?
    @State private var preparando = false
    @State private var exito = 0

    var body: some View {
        @Bindable var sync = sync
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    estado
                    Tarjeta {
                        Toggle(isOn: $sync.simularSinSenal.animation(Tema.resorte)) {
                            Label("Simular sin señal", systemImage: "airplane")
                        }
                        .tint(Tema.ambar)
                        Text("Para la demo: lo capturado se queda en el teléfono hasta apagarlo.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    preparar
                    if let resultado { tarjetaResultado(resultado) }
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(Tema.rojo)
                            .transition(.opacity)
                    }
                    servidor
                }
                .padding(16)
                .animation(Tema.resorte, value: resultado?.aplicados)
                .animation(Tema.resorte, value: error)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Jornada")
            .toolbar { ToolbarItem(placement: .topBarLeading) { SelectorRol() } }
            .sensoryFeedback(.success, trigger: exito)
        }
    }

    private var estado: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                EstadoSenal(enLinea: sync.enLinea)
                Spacer()
                if let u = sync.ultimaSync {
                    Text("Última: \(u.formatted(.relative(presentation: .named)))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(sync.pendientes)")
                    .font(.system(size: 56, weight: .bold, design: .rounded))
                    .foregroundStyle(Tema.degradado)
                    .contentTransition(.numericText(value: Double(sync.pendientes)))
                    .animation(Tema.resorte, value: sync.pendientes)
                Text(sync.pendientes == 1 ? "registro por mandar" : "registros por mandar")
                    .foregroundStyle(.secondary)
            }
            Button {
                Task { await sincronizar() }
            } label: {
                Label(sync.sincronizando ? "Sincronizando…" : "Sincronizar", systemImage: "arrow.triangle.2.circlepath")
                    .symbolEffect(.rotate, options: .repeating, isActive: sync.sincronizando)
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
            }
            .buttonStyle(.glassProminent)
            .tint(Tema.rosa)
            .disabled(!sync.enLinea || sync.sincronizando)
        }
        .padding(18)
        .background(.background, in: .rect(cornerRadius: 24))
        .shadow(color: .black.opacity(0.06), radius: 12, y: 4)
    }

    private var preparar: some View {
        Tarjeta {
            Label("Antes de salir", systemImage: "suitcase.rolling").font(.headline)
            Text("Baja al teléfono las pacientes de la comunidad para reconocerlas sin señal.")
                .font(.footnote).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                CampoTexto(titulo: "Comunidad", texto: $comunidad)
                Button {
                    Task { await prepararJornada() }
                } label: {
                    if preparando { ProgressView() } else { Image(systemName: "arrow.down.circle.fill").font(.title2) }
                }
                .buttonStyle(.glass)
                .tint(Tema.rosa)
                .disabled(!sync.enLinea || preparando)
                .padding(.top, 18)
            }
            if let preparadas {
                Label("\(preparadas) pacientes listas en el teléfono", systemImage: "checkmark.circle.fill")
                    .font(.footnote).foregroundStyle(Tema.verde)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(Tema.resorte, value: preparadas)
    }

    private func tarjetaResultado(_ r: ResultadoSync) -> some View {
        Tarjeta {
            Text("Última sincronización").font(.headline)
            HStack(spacing: 12) {
                cifra("\(r.aplicados)", "nuevos", Tema.verde)
                cifra("\(r.repetidos)", "ya estaban", .secondary)
                cifra("\(r.posiblesDuplicados.count)", "posibles duplicados", Tema.rosa)
            }
            if !r.posiblesDuplicados.isEmpty {
                Label("La coordinadora los revisa en la pestaña Revisión", systemImage: "person.2.badge.gearshape")
                    .font(.footnote).foregroundStyle(Tema.rosaProfundo)
            }
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func cifra(_ valor: String, _ etiqueta: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(valor).font(.title2.weight(.bold)).foregroundStyle(color).contentTransition(.numericText())
            Text(etiqueta).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var servidor: some View {
        Tarjeta {
            DisclosureGroup("Servidor") {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("http://IP:8787/api", text: $apiURL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL)
                        .padding(10).background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 10))
                    Button("Usar este servidor") {
                        if let u = URL(string: apiURL) { sync.api = ClienteAPI(base: u) }
                    }
                    .tint(Tema.rosa)
                }
                .padding(.top, 8)
            }
            .tint(.secondary)
        }
    }

    private func sincronizar() async {
        error = nil
        do {
            let r = try await sync.sincronizar()
            withAnimation(Tema.resorteLogro) { resultado = r }
            exito += 1
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func prepararJornada() async {
        error = nil; preparando = true
        do {
            let n = try await sync.prepararJornada(comunidad: comunidad.limpio)
            preparadas = n
            exito += 1
        } catch {
            self.error = error.localizedDescription
        }
        preparando = false
    }
}
