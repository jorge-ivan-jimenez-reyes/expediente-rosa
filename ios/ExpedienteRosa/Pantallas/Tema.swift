import SwiftUI

// Identidad visual: rosa de EIRA sobre blanco, vidrio de iOS 26 para lo que flota,
// resortes críticamente amortiguados por defecto (sin rebote) y rebote solo en
// momentos de logro (guardar, sincronizar).

enum Tema {
    static let rosa = Color(red: 0.86, green: 0.15, blue: 0.47)        // #DB2777
    static let rosaSuave = Color(red: 0.99, green: 0.91, blue: 0.95)   // #FCE7F3
    static let rosaProfundo = Color(red: 0.62, green: 0.07, blue: 0.33)
    static let verde = Color(red: 0.06, green: 0.6, blue: 0.4)
    static let ambar = Color(red: 0.85, green: 0.47, blue: 0.02)
    static let rojo = Color(red: 0.86, green: 0.15, blue: 0.15)

    static let degradado = LinearGradient(colors: [rosa, rosaProfundo], startPoint: .topLeading, endPoint: .bottomTrailing)

    static let resorte = Animation.spring(response: 0.4, dampingFraction: 1.0)
    static let resorteLogro = Animation.spring(response: 0.45, dampingFraction: 0.7)

    static func color(_ r: Resultado) -> Color {
        switch r {
        case .normal: verde
        case .anormal: rojo
        case .pendiente: ambar
        }
    }

    static func icono(_ t: TipoEstudio) -> String {
        switch t {
        case .mastografia: "heart.text.square"
        case .ultrasonido: "waveform.path.ecg"
        case .papanicolaou: "testtube.2"
        case .exploracion: "hand.raised"
        }
    }
}

extension Resultado {
    var nombre: String {
        switch self {
        case .pendiente: "Pendiente"
        case .normal: "Normal"
        case .anormal: "Anormal"
        }
    }
}

// MARK: - Componentes

struct Tarjeta<Contenido: View>: View {
    var relleno: CGFloat = 16
    @ViewBuilder var contenido: Contenido
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { contenido }
            .padding(relleno)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: .rect(cornerRadius: 22))
            .shadow(color: .black.opacity(0.06), radius: 12, y: 4)
    }
}

struct Chip: View {
    var texto: String
    var icono: String? = nil
    var color: Color = Tema.rosa
    var body: some View {
        Label {
            Text(texto)
        } icon: {
            if let icono { Image(systemName: icono) }
        }
        .labelStyle(.titleAndIcon)
        .font(.caption.weight(.medium))
        .padding(.horizontal, 10).padding(.vertical, 5)
        .foregroundStyle(color)
        .background(color.opacity(0.12), in: .capsule)
    }
}

/// Anillo que se llena hasta el puntaje de coincidencia.
struct AnilloPuntaje: View {
    var puntaje: Double
    @State private var visible = 0.0
    var body: some View {
        ZStack {
            Circle().stroke(Tema.rosa.opacity(0.15), lineWidth: 5)
            Circle()
                .trim(from: 0, to: visible)
                .stroke(Tema.rosa, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int((puntaje * 100).rounded()))")
                .font(.system(.subheadline, design: .rounded).weight(.bold))
                .monospacedDigit()
                .foregroundStyle(Tema.rosaProfundo)
        }
        .frame(width: 46, height: 46)
        .onAppear { withAnimation(.spring(response: 0.8, dampingFraction: 1).delay(0.1)) { visible = puntaje } }
        .accessibilityLabel("Coincidencia \(Int(puntaje * 100)) por ciento")
    }
}

/// Píldora de estado de señal, con vidrio.
struct EstadoSenal: View {
    var enLinea: Bool
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: enLinea ? "antenna.radiowaves.left.and.right" : "antenna.radiowaves.left.and.right.slash")
                .symbolEffect(.variableColor.iterative, options: .repeating, isActive: enLinea)
                .contentTransition(.symbolEffect(.replace))
            Text(enLinea ? "En línea" : "Sin señal")
                .contentTransition(.opacity)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(enLinea ? Tema.verde : Tema.ambar)
        .padding(.horizontal, 12).padding(.vertical, 7)
        .glassEffect(.regular.tint((enLinea ? Tema.verde : Tema.ambar).opacity(0.12)), in: .capsule)
        .animation(Tema.resorte, value: enLinea)
    }
}

/// Línea generada por el modelo del teléfono, con su marca.
struct LineaIA: View {
    var texto: String?
    var cargando: Bool
    var body: some View {
        if cargando || texto != nil {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "apple.intelligence")
                    .foregroundStyle(Tema.rosa)
                    .symbolEffect(.pulse, isActive: cargando)
                if let texto {
                    Text(texto).transition(.opacity.combined(with: .move(edge: .bottom)))
                } else {
                    Text("Analizando en el teléfono…").foregroundStyle(.secondary)
                }
            }
            .font(.footnote)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tema.rosaSuave.opacity(0.7), in: .rect(cornerRadius: 12))
            .animation(Tema.resorte, value: texto)
        }
    }
}

struct CampoTexto: View {
    var titulo: String
    @Binding var texto: String
    var teclado: UIKeyboardType = .default
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(titulo).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            TextField(titulo, text: $texto)
                .keyboardType(teclado)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
        }
    }
}

extension Paciente {
    var edadActual: Int? {
        if let n = nacimiento, let y = Int(n.prefix(4)) { return Calendar.current.component(.year, from: .now) - y }
        return edad
    }
    var subtitulo: String {
        [edadActual.map { "\($0) años" }, comunidad].compactMap { $0 }.joined(separator: " · ")
    }
}
