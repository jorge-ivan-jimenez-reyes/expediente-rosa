import SwiftUI
import PencilKit

/// Alta con consentimiento firmado. Sin firma no se guarda (LFPDPPP 2025: datos de
/// salud piden consentimiento expreso y por escrito).
struct AltaView: View {
    var inicial: NuevaPaciente
    var alGuardar: (Paciente) -> Void

    @Environment(Sincronizador.self) private var sync
    @Environment(\.dismiss) private var cerrar
    @State private var nombre = ""
    @State private var paterno = ""
    @State private var materno = ""
    @State private var comunidad = ""
    @State private var municipio = ""
    @State private var sabeFecha = false
    @State private var nacimiento = Calendar.current.date(byAdding: .year, value: -40, to: .now)!
    @State private var edad = 40
    @State private var lienzo = PKCanvasView()
    @State private var hayFirma = false
    @State private var guardada = false
    @State private var error: String?
    @State private var avisos = 0

    private var faltan: [String] {
        var f: [String] = []
        if nombre.limpio.isEmpty { f.append("nombre") }
        if paterno.limpio.isEmpty { f.append("apellido paterno") }
        if comunidad.limpio.isEmpty { f.append("comunidad") }
        if !hayFirma { f.append("firma") }
        return f
    }
    private var listo: Bool { faltan.isEmpty }

    var body: some View {
        NavigationStack {
          ScrollViewReader { lector in
            ScrollView {
                VStack(spacing: Tema.Espacio.l) {
                    Tarjeta {
                        CampoTexto(titulo: "Nombre", texto: $nombre)
                        Renglon {
                            CampoTexto(titulo: "Apellido paterno", texto: $paterno)
                            CampoTexto(titulo: "Apellido materno", texto: $materno)
                        }
                        Renglon {
                            CampoTexto(titulo: "Comunidad", texto: $comunidad)
                            CampoTexto(titulo: "Municipio", texto: $municipio)
                        }
                        Toggle("Sabe su fecha de nacimiento", isOn: $sabeFecha.animation(Tema.resorte))
                            .font(.cuerpo)
                            .tint(Tema.rosaRelleno)
                            .frame(minHeight: Tema.toque)
                        if sabeFecha {
                            DatePicker("Nacimiento", selection: $nacimiento, in: ...Date.now, displayedComponents: .date)
                                .font(.cuerpo)
                                .frame(minHeight: Tema.toque)
                        } else {
                            Stepper("Edad: \(edad) años", value: $edad, in: 12...110)
                                .font(.cuerpo)
                                .frame(minHeight: Tema.toque)
                        }
                    }
                    .id("datos")

                    Tarjeta {
                        Text("Consentimiento").font(.seccion)
                        Text(Consentimiento.texto)
                            .font(.cuerpo)
                            .foregroundStyle(.secondary)
                        firma
                    }
                    .id("firma")

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.nota).foregroundStyle(Tema.rojo)
                    }
                }
                .padding(Tema.Espacio.l)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Tema.fondo)
            .navigationTitle("Nueva paciente")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { cerrar() } }
            }
            .safeAreaInset(edge: .bottom) {
                // Mientras falte algo, el botón dice qué y al tocarlo lleva ahí (la firma queda
                // abajo del pliegue). Sin firma nunca se guarda: `guardar()` solo corre si `listo`.
                Group {
                    if listo {
                        BotonPrincipal(titulo: "Guardar", icono: "checkmark", accion: guardar)
                    } else {
                        Button { irAFalta(lector) } label: {
                            Label("Falta: \(faltan.joined(separator: ", "))", systemImage: faltan == ["firma"] ? "signature" : "arrow.down")
                                .font(.seccion)
                                .frame(maxWidth: .infinity, minHeight: Tema.toque)
                        }
                        .buttonStyle(.glass)
                        .tint(Tema.rosa)
                    }
                }
                .padding(.horizontal, Tema.Espacio.l).padding(.bottom, Tema.Espacio.s)
                .animation(Tema.resorte, value: faltan)
                .sensoryFeedback(.warning, trigger: avisos)
            }
            .overlay { if guardada { Guardada() } }
            .sensoryFeedback(.success, trigger: guardada)
          }
        }
        .onAppear(perform: precargar)
    }

    private var firma: some View {
        VStack(alignment: .trailing, spacing: Tema.Espacio.s) {
            ZStack(alignment: .bottomLeading) {
                LienzoFirma(lienzo: $lienzo, hayFirma: $hayFirma)
                    .frame(height: 160)
                    .background(Tema.campo, in: .rect(cornerRadius: Tema.Radio.campo))
                    .overlay {
                        RoundedRectangle(cornerRadius: Tema.Radio.campo)
                            .strokeBorder(hayFirma ? Tema.rosa : Color.secondary.opacity(0.5),
                                          style: StrokeStyle(lineWidth: 1.5, dash: hayFirma ? [] : [6]))
                    }
                if !hayFirma {
                    Text("Firma de la paciente")
                        .font(.nota).foregroundStyle(.secondary)
                        .padding(Tema.Espacio.m)
                        .allowsHitTesting(false)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(hayFirma ? "Firma capturada" : "Espacio para la firma de la paciente")
            if hayFirma {
                Button("Borrar firma", systemImage: "arrow.uturn.backward") {
                    lienzo.drawing = PKDrawing(); hayFirma = false
                }
                .font(.nota)
                .frame(minHeight: Tema.toque)
                .tint(Tema.rosa)
            }
        }
        .animation(Tema.resorte, value: hayFirma)
    }

    private func irAFalta(_ lector: ScrollViewProxy) {
        avisos += 1
        let destino = faltan.contains("firma") && faltan.count == 1 ? "firma" : "datos"
        withAnimation(Tema.resorte) { lector.scrollTo(destino, anchor: destino == "firma" ? .bottom : .top) }
    }

    private func precargar() {
        nombre = inicial.nombre; paterno = inicial.apellidoPaterno; materno = inicial.apellidoMaterno ?? ""
        comunidad = inicial.comunidad; municipio = inicial.municipio ?? ""
        if let n = inicial.nacimiento, let f = FechasIA.fecha(n) { sabeFecha = true; nacimiento = f }
        if let e = inicial.edad { edad = e }
    }

    private func guardar() {
        guard listo else { return }
        let p = NuevaPaciente(
            nombre: nombre.limpio, apellidoPaterno: paterno.limpio, apellidoMaterno: materno.limpio.nilSiVacio,
            nacimiento: sabeFecha ? FechasIA.texto(nacimiento) : nil, edad: sabeFecha ? nil : edad,
            comunidad: comunidad.limpio, municipio: municipio.limpio.nilSiVacio)
        do {
            let nueva = try sync.repositorio.alta(p, firma: lienzo.drawing.dataRepresentation())
            withAnimation(Tema.resorteLogro) { guardada = true }
            Task {
                try? await Task.sleep(for: .milliseconds(900))
                alGuardar(nueva)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

enum Consentimiento {
    static let texto = """
    Acepto que EIRA Movimiento Rosa registre mi nombre, edad, comunidad y los estudios que me hagan, \
    para reconocerme en mis siguientes visitas y darme seguimiento. Mis datos no se comparten con nadie \
    fuera del programa. Puedo pedir verlos, corregirlos o borrarlos cuando quiera.
    """
}

/// Lienzo de PencilKit para la firma con el dedo.
struct LienzoFirma: UIViewRepresentable {
    @Binding var lienzo: PKCanvasView
    @Binding var hayFirma: Bool

    func makeUIView(context: Context) -> PKCanvasView {
        lienzo.drawingPolicy = .anyInput
        lienzo.tool = PKInkingTool(.pen, color: .label, width: 3)
        lienzo.backgroundColor = .clear
        lienzo.delegate = context.coordinator
        return lienzo
    }
    func updateUIView(_ uiView: PKCanvasView, context: Context) {}
    func makeCoordinator() -> Coordinador { Coordinador(hayFirma: $hayFirma) }

    final class Coordinador: NSObject, PKCanvasViewDelegate {
        var hayFirma: Binding<Bool>
        init(hayFirma: Binding<Bool>) { self.hayFirma = hayFirma }
        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            let firmo = !canvasView.drawing.strokes.isEmpty
            if hayFirma.wrappedValue != firmo { hayFirma.wrappedValue = firmo }
        }
    }
}

/// Confirmación al guardar. Es un logro: aquí sí hay rebote.
struct Guardada: View {
    @State private var aparece = false
    var body: some View {
        ZStack {
            Rectangle().fill(.regularMaterial).ignoresSafeArea()
            VStack(spacing: Tema.Espacio.m) {
                Mascota(estado: .contenta, tamano: 64)
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.white, Tema.verde)
                            .symbolEffect(.bounce, value: aparece)
                            .offset(x: 4, y: -2)
                    }
                    .scaleEffect(aparece ? 1 : 0.6)
                Text("Guardada").font(.titulo)
                Text("Se manda cuando haya señal").font(.cuerpo).foregroundStyle(.secondary)
            }
        }
        .transition(.opacity)
        .onAppear { withAnimation(Tema.resorteLogro) { aparece = true } }
    }
}
