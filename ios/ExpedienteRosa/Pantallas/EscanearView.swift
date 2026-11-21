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
                VStack(spacing: 16) {
                    selector
                    if let imagen {
                        Image(uiImage: imagen)
                            .resizable().scaledToFit()
                            .clipShape(.rect(cornerRadius: 18))
                            .overlay { if leyendo { Barrido() } }
                            .shadow(color: .black.opacity(0.1), radius: 10, y: 4)
                            .transition(.scale(scale: 0.95).combined(with: .opacity))
                    }
                    if let hoja { resultado(hoja) }
                    if let error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Tema.rojo) }
                }
                .padding(16)
                .animation(Tema.resorte, value: hoja)
                .animation(Tema.resorte, value: imagen)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Escanear hoja")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { cerrar() } } }
            .onChange(of: foto) { _, nueva in Task { await cargar(nueva) } }
            .onAppear { Inteligencia.precalentar() }
        }
    }

    private var selector: some View {
        Tarjeta {
            Text("Toma o elige la foto de una hoja de registro").font(.headline)
            HStack(spacing: 10) {
                PhotosPicker(selection: $foto, matching: .images) {
                    Label("Elegir foto", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent).tint(Tema.rosa)
                Menu {
                    ForEach(1...3, id: \.self) { i in
                        Button("Hoja de ejemplo \(i)") { usarEjemplo(i) }
                    }
                } label: {
                    Label("Ejemplo", systemImage: "doc.text").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
            }
            if !Inteligencia.disponible {
                Text("Sin Apple Intelligence: se muestra el texto leído y tú llenas los campos.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func resultado(_ h: HojaLeida) -> some View {
        VStack(spacing: 16) {
            if let p = h.paciente {
                Tarjeta {
                    Label("Leído en el teléfono, revisa antes de guardar", systemImage: "apple.intelligence")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Tema.rosaProfundo)
                    fila("Nombre", [p.nombre, p.apellidoPaterno, p.apellidoMaterno].compactMap { $0 }.joined(separator: " "))
                    fila("Nacimiento / edad", p.nacimiento ?? p.edad.map { "\($0) años" } ?? "—")
                    fila("Comunidad", [p.comunidad, p.municipio].compactMap { $0 }.joined(separator: ", "))
                    if !h.estudios.isEmpty {
                        Divider()
                        ForEach(Array(h.estudios.enumerated()), id: \.offset) { _, e in
                            HStack {
                                Image(systemName: Tema.icono(e.tipo)).foregroundStyle(Tema.rosa)
                                Text(e.tipo.nombre)
                                Spacer()
                                Chip(texto: e.resultado.nombre, color: Tema.color(e.resultado))
                            }
                            .font(.subheadline)
                        }
                    }
                    Button {
                        alConfirmar(p)
                    } label: {
                        Label("Usar estos datos para el alta", systemImage: "person.badge.plus").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent).tint(Tema.rosa)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            Tarjeta {
                DisclosureGroup("Texto leído de la hoja") {
                    Text(h.textoCrudo.isEmpty ? "(no se leyó texto)" : h.textoCrudo)
                        .font(.footnote.monospaced())
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .tint(Tema.rosa)
            }
        }
    }

    private func fila(_ etiqueta: String, _ valor: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(etiqueta).font(.caption).foregroundStyle(.secondary).frame(width: 120, alignment: .leading)
            Text(valor).font(.subheadline.weight(.medium))
        }
    }

    private func usarEjemplo(_ i: Int) {
        guard let url = Bundle.main.url(forResource: "hoja\(i)", withExtension: "png"),
              let img = UIImage(contentsOfFile: url.path) else { error = "No encontré la hoja de ejemplo."; return }
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

/// Barra que recorre la hoja mientras se lee.
struct Barrido: View {
    @State private var arriba = true
    var body: some View {
        GeometryReader { g in
            LinearGradient(colors: [.clear, Tema.rosa.opacity(0.35), .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: 80)
                .offset(y: arriba ? -80 : g.size.height)
                .onAppear { withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) { arriba = false } }
        }
        .clipShape(.rect(cornerRadius: 18))
        .allowsHitTesting(false)
    }
}
