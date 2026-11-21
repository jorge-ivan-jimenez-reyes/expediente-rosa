import SwiftUI
import UIKit

// Sistema de diseño de Expediente Rosa (tabla completa en docs/diseno/sistema.md).
// Herramienta de trabajo: fondo agrupado del sistema, una sola tinta de acento (rosa),
// colores de estado solo para resultados. Sin degradados ni sombras propias: lo que
// flota (barras, botones) usa el vidrio de iOS 26.

enum Tema {
    // MARK: Color (claro / oscuro, contraste AA verificado)

    /// Texto, íconos y controles en rosa. 5.9:1 sobre blanco · 6.0:1 sobre #1C1C1E.
    static let rosa = dinamico(0xC4006A, 0xFF5FA8)
    /// Fondo de botones principales (texto blanco encima: 5.9:1 claro · 4.8:1 oscuro).
    static let rosaRelleno = dinamico(0xC4006A, 0xD61F7E)
    /// Fondo suave para marcar algo seleccionado o la línea de la IA.
    static let rosaSuave = dinamico(0xFCE4EF, 0x3D1029)

    static let verde = dinamico(0x1B7A43, 0x4CD787)
    static let ambar = dinamico(0x9A5700, 0xFFB340)
    static let rojo = dinamico(0xC42B2B, 0xFF7070)

    /// Neutros: los del sistema, para que el modo oscuro y el alto contraste salgan solos.
    static let fondo = Color(.systemGroupedBackground)
    static let superficie = Color(.secondarySystemGroupedBackground)
    static let campo = Color(.tertiarySystemGroupedBackground)
    static let linea = Color(.separator)

    // MARK: Espaciado (escala de 4)

    enum Espacio {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    // MARK: Radios

    enum Radio {
        static let campo: CGFloat = 12
        static let tarjeta: CGFloat = 20
    }

    /// Alto mínimo de cualquier cosa que se toque.
    static let toque: CGFloat = 44

    // MARK: Movimiento

    /// Por defecto: resorte críticamente amortiguado, sin rebote.
    static let resorte = Animation.spring(response: 0.35, dampingFraction: 1.0)
    /// Solo al lograr algo (guardar la alta, sincronizar).
    static let resorteLogro = Animation.spring(response: 0.45, dampingFraction: 0.75)

    // MARK: Estados

    static func color(_ r: Resultado) -> Color {
        switch r {
        case .normal: verde
        case .anormal: rojo
        case .pendiente: ambar
        }
    }

    static func icono(_ r: Resultado) -> String {
        switch r {
        case .normal: "checkmark.circle.fill"
        case .anormal: "exclamationmark.triangle.fill"
        case .pendiente: "clock.fill"
        }
    }

    static func icono(_ t: TipoEstudio) -> String {
        switch t {
        case .mastografia: "circle.circle"
        case .ultrasonido: "waveform"
        case .papanicolaou: "testtube.2"
        case .exploracion: "hand.raised"
        }
    }

    private static func dinamico(_ claro: UInt32, _ oscuro: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: oscuro) : UIColor(hex: claro) })
    }
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

// MARK: Tipografía: 5 estilos, todos SF con Dynamic Type

extension Font {
    /// Cifra principal de una pantalla (pendientes por mandar).
    static let cifra = Font.system(.largeTitle, design: .rounded).weight(.bold).monospacedDigit()
    /// Nombre de la paciente en su expediente.
    static let titulo = Font.title2.weight(.bold)
    /// Títulos de sección y nombres en filas.
    static let seccion = Font.headline
    /// Texto y campos.
    static let cuerpo = Font.body
    /// Datos secundarios, etiquetas y la única ayuda por pantalla.
    static let nota = Font.footnote
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

/// Grupo de contenido sobre el fondo agrupado. Plano, sin sombra; nunca uno dentro de otro.
struct Tarjeta<Contenido: View>: View {
    var espacio: CGFloat = Tema.Espacio.m
    @ViewBuilder var contenido: Contenido
    var body: some View {
        VStack(alignment: .leading, spacing: espacio) { contenido }
            .padding(Tema.Espacio.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tema.superficie, in: .rect(cornerRadius: Tema.Radio.tarjeta))
    }
}

/// Etiqueta de estado (resultado de un estudio).
struct Chip: View {
    var texto: String
    var icono: String? = nil
    var color: Color = Tema.rosa
    var body: some View {
        HStack(spacing: Tema.Espacio.xs) {
            if let icono { Image(systemName: icono).imageScale(.small) }
            Text(texto)
        }
        .font(.nota.weight(.semibold))
        .padding(.horizontal, Tema.Espacio.s).padding(.vertical, Tema.Espacio.xs)
        .foregroundStyle(color)
        .background(color.opacity(0.14), in: .capsule)
    }
}

/// Puntaje de coincidencia: anillo que se llena hasta el valor.
struct AnilloPuntaje: View {
    var puntaje: Double
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @State private var visible = 0.0
    var body: some View {
        ZStack {
            Circle().stroke(Tema.rosa.opacity(0.18), lineWidth: 4)
            Circle()
                .trim(from: 0, to: visible)
                .stroke(Tema.rosa, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int((puntaje * 100).rounded()))")
                .font(.nota.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(Tema.rosa)
        }
        .frame(width: Tema.toque, height: Tema.toque)
        .onAppear {
            if sinMovimiento { visible = puntaje } else { withAnimation(Tema.resorte.delay(0.1)) { visible = puntaje } }
        }
        .accessibilityElement()
        .accessibilityLabel("Coincide \(Int((puntaje * 100).rounded())) por ciento")
    }
}

/// Estado de señal, en vidrio porque flota sobre el contenido.
struct EstadoSenal: View {
    var enLinea: Bool
    var body: some View {
        Label(enLinea ? "En línea" : "Sin señal",
              systemImage: enLinea ? "antenna.radiowaves.left.and.right" : "antenna.radiowaves.left.and.right.slash")
            .contentTransition(.symbolEffect(.replace))
            .font(.nota.weight(.semibold))
            .foregroundStyle(enLinea ? Tema.verde : Tema.ambar)
            .padding(.horizontal, Tema.Espacio.m).padding(.vertical, Tema.Espacio.s)
            .glassEffect(.regular.tint((enLinea ? Tema.verde : Tema.ambar).opacity(0.12)), in: .capsule)
            .animation(Tema.resorte, value: enLinea)
    }
}

/// Texto que escribió el modelo del teléfono. Es el único lugar con la marca de IA.
struct LineaIA: View {
    var texto: String?
    var cargando: Bool
    var esperando = "Pensando…"
    var body: some View {
        if cargando || texto != nil {
            HStack(alignment: .firstTextBaseline, spacing: Tema.Espacio.s) {
                Image(systemName: "apple.intelligence")
                    .foregroundStyle(Tema.rosa)
                    .symbolEffect(.pulse, isActive: cargando)
                    .accessibilityLabel("Escrito por la IA del teléfono")
                if let texto {
                    Text(texto).foregroundStyle(.primary).transition(.opacity)
                } else {
                    Text(esperando).foregroundStyle(.secondary)
                }
            }
            .font(.nota)
            .frame(maxWidth: .infinity, alignment: .leading)
            .animation(Tema.resorte, value: texto)
        }
    }
}

/// Campo con su etiqueta arriba (la etiqueta no desaparece al escribir).
struct CampoTexto: View {
    var titulo: String
    @Binding var texto: String
    var teclado: UIKeyboardType = .default
    var body: some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
            Text(titulo).font(.nota).foregroundStyle(.secondary)
            TextField("", text: $texto)
                .font(.cuerpo)
                .keyboardType(teclado)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .padding(.horizontal, Tema.Espacio.m)
                .frame(minHeight: Tema.toque)
                .background(Tema.campo, in: .rect(cornerRadius: Tema.Radio.campo))
                .accessibilityLabel(titulo)
        }
    }
}

/// Dos o más campos en renglón; con letra muy grande se apilan.
struct Renglon<Contenido: View>: View {
    @Environment(\.dynamicTypeSize) private var tamano
    @ViewBuilder var contenido: Contenido
    var body: some View {
        let layout = tamano > .xLarge ? AnyLayout(VStackLayout(alignment: .leading, spacing: Tema.Espacio.m))
                                       : AnyLayout(HStackLayout(alignment: .top, spacing: Tema.Espacio.m))
        layout { contenido }
    }
}

/// Botón principal de la pantalla: ancho completo, rosa, abajo al alcance del pulgar.
struct BotonPrincipal: View {
    var titulo: String
    var icono: String
    var accion: () -> Void
    var body: some View {
        Button(action: accion) {
            Label(titulo, systemImage: icono)
                .font(.seccion)
                .frame(maxWidth: .infinity, minHeight: Tema.toque)
        }
        .buttonStyle(.glassProminent)
        .tint(Tema.rosaRelleno)
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
