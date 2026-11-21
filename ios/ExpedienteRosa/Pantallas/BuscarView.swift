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
                VStack(spacing: 16) {
                    formulario
                    resultados
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
                .animation(Tema.resorte, value: candidatas.map(\.id))
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Buscar paciente")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { SelectorRol() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { escanear = true } label: { Label("Escanear hoja", systemImage: "doc.viewfinder") }
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
        }
    }

    private var formulario: some View {
        Tarjeta {
            HStack {
                Text("¿Ya vino antes?").font(.headline)
                Spacer()
                Text("\(pacientes.count) en el teléfono")
                    .font(.caption).foregroundStyle(.secondary)
                    .contentTransition(.numericText(value: Double(pacientes.count)))
            }
            HStack(spacing: 10) {
                CampoTexto(titulo: "Nombre(s)", texto: $nombre)
            }
            HStack(spacing: 10) {
                CampoTexto(titulo: "Apellido paterno", texto: $paterno)
                CampoTexto(titulo: "Apellido materno", texto: $materno)
            }
            HStack(spacing: 10) {
                CampoTexto(titulo: "Edad", texto: $edad, teclado: .numberPad).frame(width: 90)
                CampoTexto(titulo: "Comunidad", texto: $comunidad)
            }
        }
        .padding(.top, 8)
    }

    @ViewBuilder private var resultados: some View {
        if hayConsulta {
            if candidatas.isEmpty {
                Tarjeta {
                    Label("No hay coincidencias en el teléfono", systemImage: "person.crop.circle.badge.questionmark")
                        .foregroundStyle(.secondary)
                    botonNueva
                }
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Posibles coincidencias").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        .padding(.leading, 4)
                    ForEach(Array(candidatas.enumerated()), id: \.element.id) { i, c in
                        FilaCandidata(candidata: c, explicacion: i == 0 ? explicacion : nil, explicando: i == 0 && explicando) {
                            ruta = [c.paciente]
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    botonNueva.padding(.top, 4)
                }
            }
        } else {
            VStack(spacing: 10) {
                Image(systemName: "person.text.rectangle")
                    .font(.system(size: 44)).foregroundStyle(Tema.rosa.opacity(0.6))
                    .symbolEffect(.breathe, options: .repeating)
                Text("Escribe nombre y apellido para buscar.\nFunciona sin señal.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 40)
        }
    }

    private var botonNueva: some View {
        Button {
            alta = consulta
        } label: {
            Label("Es nueva: dar de alta", systemImage: "person.badge.plus")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        }
        .buttonStyle(.glassProminent)
        .tint(Tema.rosa)
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
}

struct FilaCandidata: View {
    var candidata: Candidata
    var explicacion: String?
    var explicando: Bool
    var esElla: () -> Void

    var body: some View {
        Tarjeta(relleno: 14) {
            HStack(spacing: 12) {
                AnilloPuntaje(puntaje: candidata.puntaje)
                VStack(alignment: .leading, spacing: 2) {
                    Text(candidata.paciente.nombreCompleto).font(.headline)
                    Text(candidata.paciente.subtitulo).font(.subheadline).foregroundStyle(.secondary)
                    Text(candidata.paciente.folio).font(.caption.monospaced()).foregroundStyle(.tertiary)
                }
                Spacer(minLength: 0)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(candidata.razones, id: \.self) { Chip(texto: $0, icono: "checkmark") }
                }
            }
            LineaIA(texto: explicacion, cargando: explicando)
            Button(action: esElla) {
                Label("Es ella: abrir expediente", systemImage: "arrow.right.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            .tint(Tema.rosa)
        }
    }
}

extension NuevaPaciente: Identifiable {
    public var id: String { [nombre, apellidoPaterno, apellidoMaterno ?? "", comunidad].joined(separator: "|") }
}
