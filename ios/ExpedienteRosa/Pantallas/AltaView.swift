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

    private var listo: Bool {
        !nombre.limpio.isEmpty && !paterno.limpio.isEmpty && !comunidad.limpio.isEmpty && hayFirma
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Tarjeta {
                        Text("Datos mínimos").font(.headline)
                        CampoTexto(titulo: "Nombre(s)", texto: $nombre)
                        HStack(spacing: 10) {
                            CampoTexto(titulo: "Apellido paterno", texto: $paterno)
                            CampoTexto(titulo: "Apellido materno", texto: $materno)
                        }
                        HStack(spacing: 10) {
                            CampoTexto(titulo: "Comunidad", texto: $comunidad)
                            CampoTexto(titulo: "Municipio", texto: $municipio)
                        }
                        Toggle("Sabe su fecha de nacimiento", isOn: $sabeFecha.animation(Tema.resorte))
                            .tint(Tema.rosa)
                        if sabeFecha {
                            DatePicker("Nacimiento", selection: $nacimiento, in: ...Date.now, displayedComponents: .date)
                                .transition(.opacity.combined(with: .move(edge: .top)))
                        } else {
                            Stepper("Edad: \(edad) años", value: $edad, in: 12...110)
                                .transition(.opacity.combined(with: .move(edge: .top)))
                        }
                        Text("No pedimos dirección, teléfono ni CURP.")
                            .font(.caption).foregroundStyle(.secondary)
                    }

                    Tarjeta {
                        Label("Consentimiento", systemImage: "hand.raised.square")
                            .font(.headline).foregroundStyle(Tema.rosaProfundo)
                        Text(Consentimiento.texto)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        ZStack(alignment: .bottomLeading) {
                            LienzoFirma(lienzo: $lienzo, hayFirma: $hayFirma)
                                .frame(height: 150)
                                .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 14))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 14)
                                        .strokeBorder(hayFirma ? Tema.rosa : .secondary.opacity(0.3), style: StrokeStyle(lineWidth: 1.5, dash: hayFirma ? [] : [6]))
                                }
                            if !hayFirma {
                                Text("Firma de la paciente").font(.caption).foregroundStyle(.tertiary).padding(12)
                                    .allowsHitTesting(false)
                            }
                        }
                        .animation(Tema.resorte, value: hayFirma)
                        if hayFirma {
                            Button("Borrar firma", systemImage: "arrow.uturn.backward") {
                                lienzo.drawing = PKDrawing(); hayFirma = false
                            }
                            .font(.footnote).tint(.secondary)
                        }
                    }

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Tema.rojo).font(.footnote)
                    }
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Nueva paciente")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { cerrar() } }
            }
            .safeAreaInset(edge: .bottom) {
                Button(action: guardar) {
                    Label(listo ? "Guardar en el teléfono" : "Faltan datos o firma", systemImage: "checkmark.seal.fill")
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                }
                .buttonStyle(.glassProminent)
                .tint(Tema.rosa)
                .disabled(!listo)
                .padding(.horizontal, 16).padding(.bottom, 8)
            }
            .overlay { if guardada { Guardada() } }
            .sensoryFeedback(.success, trigger: guardada)
        }
        .onAppear(perform: precargar)
    }

    private func precargar() {
        nombre = inicial.nombre; paterno = inicial.apellidoPaterno; materno = inicial.apellidoMaterno ?? ""
        comunidad = inicial.comunidad; municipio = inicial.municipio ?? ""
        if let n = inicial.nacimiento, let f = FechasIA.fecha(n) { sabeFecha = true; nacimiento = f }
        if let e = inicial.edad { edad = e }
    }

    private func guardar() {
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
        lienzo.tool = PKInkingTool(.pen, color: UIColor(Tema.rosaProfundo), width: 3)
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

/// Confirmación al guardar: el sello aparece con un pequeño rebote.
struct Guardada: View {
    @State private var aparece = false
    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(Tema.degradado)
                    .symbolEffect(.bounce, value: aparece)
                    .scaleEffect(aparece ? 1 : 0.5)
                Text("Guardada en el teléfono").font(.title3.weight(.semibold))
                Text("Se sincroniza cuando haya señal").font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .transition(.opacity)
        .onAppear { withAnimation(Tema.resorteLogro) { aparece = true } }
    }
}
