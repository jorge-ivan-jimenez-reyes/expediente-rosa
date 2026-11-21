import SwiftUI
import PhotosUI

/// Hojas de papel de jornadas pasadas → expediente. Vision lee, Foundation Models
/// ordena, la enfermera revisa. Nada sale del teléfono.
struct EscanearView: View {
    var alConfirmar: (NuevaPaciente) -> Void

    @Environment(\.dismiss) private var cerrar
    @State private var foto: PhotosPickerItem?
    @State private var imagen: UIImage?
    @State private var leyendo = false
    @State private var hoja: HojaLeida?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Tema.Espacio.l) {
                    selector
                    if let hoja { resultado(hoja) }
                    if let imagen {
                        Image(uiImage: imagen)
                            .resizable().scaledToFit()
                            .frame(maxWidth: .infinity, maxHeight: 320)
                            .clipShape(.rect(cornerRadius: Tema.Radio.campo))
                            .overlay { if leyendo { Barrido() } }
                            .accessibilityLabel("Foto de la hoja")
                            .transition(.opacity)
                    }
                    if let hoja { textoLeido(hoja) }
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill").font(.nota).foregroundStyle(Tema.rojo)
                    }
                }
                .padding(Tema.Espacio.l)
                .animation(Tema.resorte, value: hoja)
                .animation(Tema.resorte, value: imagen)
            }
            .background(Tema.fondo)
            .navigationTitle("Escanear hoja")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { cerrar() } } }
            .safeAreaInset(edge: .bottom) {
                if let p = hoja?.paciente {
                    BotonPrincipal(titulo: "Dar de alta", icono: "person.badge.plus") { alConfirmar(p) }
                        .padding(.horizontal, Tema.Espacio.l).padding(.bottom, Tema.Espacio.s)
                }
            }
            .onChange(of: foto) { _, nueva in Task { await cargar(nueva) } }
            .onAppear {
                Inteligencia.precalentar()
                #if DEBUG
                if let (img, h) = ModoCaptura.hojaDemo { imagen = img; hoja = h }
                #endif
            }
        }
    }

    private var selector: some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.s) {
            Renglon {
                PhotosPicker(selection: $foto, matching: .images) {
                    Label("Elegir foto", systemImage: "photo").frame(maxWidth: .infinity, minHeight: Tema.toque)
                }
                .buttonStyle(.glass)
                Menu {
                    // Primero las hojas reales de EIRA, llenadas con datos ficticios.
                    Button("Revisión mamaria (EIRA)") { usarEjemplo("eira-mamaria-1", "jpg") }
                    Button("Citología (EIRA)") { usarEjemplo("eira-citologia", "jpg") }
                    ForEach(1...3, id: \.self) { i in
                        Button("Hoja \(i)") { usarEjemplo("hoja\(i)", "png") }
                    }
                } label: {
                    Label("Usar ejemplo", systemImage: "doc.text").frame(maxWidth: .infinity, minHeight: Tema.toque)
                }
                .buttonStyle(.glass)
            }
            .tint(Tema.rosa)
            .font(.seccion)
            if !Inteligencia.disponible {
                Text("Este teléfono no tiene IA: llena los datos a mano con el texto leído.")
                    .font(.nota).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func resultado(_ h: HojaLeida) -> some View {
        if let p = h.paciente {
            Tarjeta {
                Label("Revisa lo leído", systemImage: "apple.intelligence")
                    .font(.seccion)
                    .labelStyle(EtiquetaIA())
                VStack(alignment: .leading, spacing: Tema.Espacio.s) {
                    fila("Nombre", [p.nombre, p.apellidoPaterno, p.apellidoMaterno].compactMap { $0 }.joined(separator: " "))
                    fila("Nacimiento", p.nacimiento.flatMap(FechasIA.fecha).map { $0.formatted(.dateTime.day().month(.abbreviated).year()) }
                         ?? p.edad.map { "\($0) años" } ?? "—")
                    fila("Comunidad", p.comunidad.isEmpty ? "—" : p.comunidad)
                }
                if !h.estudios.isEmpty {
                    Divider()
                    ForEach(Array(h.estudios.enumerated()), id: \.offset) { _, e in
                        HStack {
                            Text(e.tipo.nombre).font(.cuerpo)
                            Spacer()
                            Chip(texto: e.resultado.nombre, icono: Tema.icono(e.resultado), color: Tema.color(e.resultado))
                        }
                    }
                }
            }
            .transition(.opacity)
        }
    }

    private func textoLeido(_ h: HojaLeida) -> some View {
        Tarjeta {
            DisclosureGroup {
                Text(h.textoCrudo.isEmpty ? "No se leyó texto." : h.textoCrudo)
                    .font(.nota.monospaced())
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(.top, Tema.Espacio.s)
            } label: {
                Text("Texto de la hoja").font(.cuerpo).foregroundStyle(.primary)
            }
            .tint(Tema.rosa)
            .frame(minHeight: Tema.toque)
        }
    }

    private func fila(_ etiqueta: String, _ valor: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: Tema.Espacio.m) {
                Text(etiqueta).font(.nota).foregroundStyle(.secondary).frame(width: 96, alignment: .leading)
                Text(valor).font(.cuerpo)
            }
            VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                Text(etiqueta).font(.nota).foregroundStyle(.secondary)
                Text(valor).font(.cuerpo)
            }
        }
    }

    private func usarEjemplo(_ nombre: String, _ formato: String) {
        guard let url = Bundle.main.url(forResource: nombre, withExtension: formato),
              let img = UIImage(contentsOfFile: url.path) else { error = "No se encontró la hoja de ejemplo."; return }
        Task { await leer(img) }
    }

    private func cargar(_ item: PhotosPickerItem?) async {
        guard let item, let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) else { return }
        await leer(img)
    }

    private func leer(_ img: UIImage) async {
        error = nil; hoja = nil
        withAnimation(Tema.resorte) { imagen = img }
        leyendo = true
        do { hoja = try await Inteligencia.leerHoja(img) } catch { self.error = error.localizedDescription }
        leyendo = false
    }
}

/// Ícono de IA en rosa, texto en color normal.
struct EtiquetaIA: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: Tema.Espacio.s) {
            configuration.icon.foregroundStyle(Tema.rosa)
            configuration.title
        }
    }
}

/// Barra que recorre la hoja mientras se lee. Con «Reducir movimiento» solo parpadea suave.
struct Barrido: View {
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @State private var arriba = true
    var body: some View {
        GeometryReader { g in
            if sinMovimiento {
                Tema.rosa.opacity(arriba ? 0.08 : 0.2)
                    .onAppear { withAnimation(.easeInOut(duration: 1).repeatForever()) { arriba = false } }
            } else {
                Rectangle().fill(Tema.rosa.opacity(0.25))
                    .frame(height: 3)
                    .offset(y: arriba ? 0 : g.size.height - 3)
                    .onAppear { withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) { arriba = false } }
            }
        }
        .clipShape(.rect(cornerRadius: Tema.Radio.campo))
        .allowsHitTesting(false)
    }
}
