import SwiftUI

/// La mascota de Expediente Rosa: el expediente del logo con cara. Decorativa (oculta a VoiceOver).
///
/// Va en pocos lugares y chica (≤ 64 pt): estados vacíos, «Guardada», sincronizar, sin señal y
/// leyendo una hoja. Nunca junto a resultados clínicos ni en momentos delicados.
/// La geometría es la del logo (`docs/diseno/logo.svg`, 624 × 560 unidades) y la misma de
/// `docs/diseno/mascota.svg`, que usa el panel. Si cambias una, cambia la otra.
struct Mascota: View {
    enum Estado: String, CaseIterable, Identifiable {
        /// Respira y parpadea cada 3–5 s.
        case reposo
        /// Salta poquito y saluda con la mano.
        case saluda
        /// Rebota al lograr algo (guardar, sincronizar).
        case contenta
        /// Mira de lado a lado: sincroniza o lee una hoja.
        case buscando
        /// Ojos tranquilos y una nube: no hay señal, todo sigue guardado.
        case sinSenal
        var id: String { rawValue }
    }

    var estado: Estado = .reposo
    /// Lado del cuadro que ocupa. El expediente mide el 80 % de ancho; el resto es aire para la mano, la nube y el salto.
    var tamano: CGFloat = 56
    /// Para fondos rosa (el arranque): hoja de atrás blanca translúcida, como el logo.
    var sobreRosa = false

    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @State private var inicio = Date.now
    @State private var ojosCerrados = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 60, paused: sinMovimiento)) { reloj in
            let pose = Pose(estado: estado,
                            t: reloj.date.timeIntervalSinceReferenceDate,
                            e: max(0, reloj.date.timeIntervalSince(inicio)),
                            quieta: sinMovimiento)
            Canvas { ctx, lienzo in
                Dibujo(pose: pose, parpadeo: ojosCerrados, sobreRosa: sobreRosa).pintar(&ctx, lienzo)
            }
            // El lienzo es más grande que el cuadro para que la mano, la nube y el salto no se corten.
            .frame(width: tamano * Dibujo.holgura, height: tamano * Dibujo.holgura)
        }
        .frame(width: tamano, height: tamano)
        .accessibilityHidden(true)
        .onChange(of: estado) { inicio = .now }
        .task {
            // Parpadeo al azar cada 3–5 s. Es un cambio de expresión: también con «Reducir movimiento».
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Double.random(in: 3...5)))
                ojosCerrados = true
                try? await Task.sleep(for: .milliseconds(130))
                ojosCerrados = false
            }
        }
    }
}

// MARK: - Pose: todo lo que se mueve, calculado del tiempo

/// Valores de un cuadro. `e` es el tiempo desde que entró al estado; `t`, el reloj continuo.
private struct Pose {
    var estado: Mascota.Estado
    /// Escala del cuerpo (desde el pie) y salto, en unidades del logo.
    var escalaX: CGFloat = 1, escalaY: CGFloat = 1, salto: CGFloat = 0
    /// Inclinación del cuerpo en grados.
    var giro: Double = 0
    /// Mano: 0 escondida detrás de la hoja, 1 arriba. `ola`: grados extra del saludo.
    var mano: Double = 0, ola: Double = 0
    /// Hacia dónde miran los ojos, −1…1.
    var mirada: CGFloat = 0
    /// Nube flotando, en unidades.
    var nube: CGFloat = 0

    init(estado: Mascota.Estado, t: Double, e: Double, quieta: Bool) {
        self.estado = estado
        if quieta {
            // Solo expresión: la mano arriba al saludar, los ojos a un lado al buscar (cambian cada 2 s).
            if estado == .saluda { mano = 1 }
            if estado == .buscando { mirada = Int(t / 2) % 2 == 0 ? 0.8 : -0.8 }
            return
        }
        switch estado {
        case .reposo:
            respirar(t, periodo: 3.4, cuanto: 0.022)
        case .sinSenal:
            respirar(t, periodo: 4.4, cuanto: 0.018)
            nube = 9 * CGFloat(sin(t * 2 * .pi / 3.2))
        case .buscando:
            respirar(t, periodo: 3.0, cuanto: 0.018)
            // Seno recortado: se detiene un momento en cada lado, como quien busca.
            let s = sin(e * 2 * .pi / 2.0)
            mirada = CGFloat(max(-1, min(1, s * 1.7)))
            giro = Double(mirada) * 1.5
        case .saluda:
            let c = e.truncatingRemainder(dividingBy: 3.2)
            brinco(c, alto: 58, aire: 0.40)
            // La mano sale de detrás de la hoja con un resorte, saluda dos veces y se guarda.
            if c > 0.14 {
                let d = c - 0.14
                mano = max(0, 1 - exp(-d * 9) * cos(d * 11))
            }
            if c > 0.34 && c < 1.14 {
                let p = (c - 0.34) / 0.8
                ola = 17 * sin(p * 2 * .pi * 2) * sin(p * .pi)
            }
            if c > 1.2 { mano *= max(0, 1 - (c - 1.2) / 0.32) }
            if c > 1.5 { respirar(t, periodo: 3.4, cuanto: 0.022) }
        case .contenta:
            let c = e.truncatingRemainder(dividingBy: 2.8)
            brinco(c, alto: 72, aire: 0.34)
            if c > 1.2 { respirar(t, periodo: 3.4, cuanto: 0.022) }
        }
    }

    private mutating func respirar(_ t: Double, periodo: Double, cuanto: Double) {
        let s = sin(t * 2 * .pi / periodo)
        escalaY = 1 + CGFloat(cuanto * s)
        escalaX = 1 - CGFloat(cuanto * 0.4 * s)
    }

    /// Agacharse, saltar y caer con un resorte amortiguado (aplasta y se recupera).
    private mutating func brinco(_ c: Double, alto: CGFloat, aire: Double) {
        let agache = 0.12
        if c < agache {
            let p = sin(c / agache * .pi / 2)
            escalaY = 1 - 0.07 * p; escalaX = 1 + 0.045 * p
        } else if c < agache + aire {
            let p = (c - agache) / aire
            salto = -alto * CGFloat(4 * p * (1 - p))
            escalaY = 1 + 0.035 * CGFloat(sin(p * .pi)); escalaX = 1 - 0.02 * CGFloat(sin(p * .pi))
        } else {
            let d = c - agache - aire
            let a = 0.075 * exp(-d * 8) * cos(d * 21)
            escalaY = 1 - a; escalaX = 1 + a * 0.6
        }
    }
}

// MARK: - Dibujo (unidades del logo: 624 × 560)

private struct Dibujo {
    var pose: Pose
    var parpadeo: Bool
    var sobreRosa: Bool

    /// Rosa de la marca para la cara: siempre va sobre la hoja blanca.
    static let tinta = Color(red: 0xC4 / 255, green: 0, blue: 0x6A / 255)
    static let mejilla = Color(red: 1, green: 0x6F / 255, blue: 0xAE / 255)

    /// Cuánto más grande que el cuadro es el lienzo.
    static let holgura: CGFloat = 1.4

    func pintar(_ ctx: inout GraphicsContext, _ lienzo: CGSize) {
        let lado = min(lienzo.width, lienzo.height) / Self.holgura
        let s = lado * 0.8 / 624
        // El expediente queda centrado: el arranque lo empalma con la imagen del logo.
        ctx.translateBy(x: (lienzo.width - 624 * s) / 2, y: (lienzo.height - 560 * s) / 2)
        ctx.scaleBy(x: s, y: s)

        let atras: Color = sobreRosa ? .white.opacity(0.5) : Tema.rosa
        let borde: Color? = sobreRosa ? nil : Tema.rosa
        let linea = StrokeStyle(lineWidth: 22, lineCap: .round, lineJoin: .round)

        // Nube (no se mueve con el cuerpo: flota sola).
        if pose.estado == .sinSenal {
            var c = ctx
            c.translateBy(x: 0, y: pose.nube)
            c.fill(Self.nube(centro: CGPoint(x: 572, y: -18)), with: .color(sobreRosa ? .white.opacity(0.85) : Color(.systemGray2)))
        }

        // Cuerpo: respira y salta desde el pie.
        var cuerpo = ctx
        cuerpo.translateBy(x: 312, y: 560 + pose.salto)
        cuerpo.rotate(by: .degrees(pose.giro))
        cuerpo.scaleBy(x: pose.escalaX, y: pose.escalaY)
        cuerpo.translateBy(x: -312, y: -560)

        cuerpo.fill(Self.hojaAtras, with: .color(atras))

        // Mano: detrás de la hoja de enfrente, gira desde el borde derecho.
        if pose.mano > 0.01 {
            var m = cuerpo
            m.translateBy(x: 600, y: 396)
            m.rotate(by: .degrees(200 - 150 * pose.mano + pose.ola))
            // Manita llena (rosa sobre fondo claro, blanca sobre rosa): con contorno parecía el asa de una taza.
            let mano = Path(roundedRect: CGRect(x: -38, y: -150, width: 76, height: 162), cornerRadius: 38)
            m.fill(mano, with: .color(sobreRosa ? .white : Tema.rosa))
        }

        // Con borde, la hoja se mete medio trazo para que su orilla exterior coincida con la de atrás.
        let frente = borde == nil
            ? Path(roundedRect: CGRect(x: 0, y: 120, width: 624, height: 440), cornerRadius: 56)
            : Path(roundedRect: CGRect(x: 9, y: 129, width: 606, height: 422), cornerRadius: 47)
        cuerpo.fill(frente, with: .color(.white))
        if let borde { cuerpo.stroke(frente, with: .color(borde), lineWidth: 18) }

        cara(&cuerpo, linea)
    }

    private func cara(_ ctx: inout GraphicsContext, _ linea: StrokeStyle) {
        let tinta = GraphicsContext.Shading.color(Self.tinta)
        let dx = pose.mirada * 34
        let ojoY: CGFloat = 318
        let ojos = [CGFloat(204), 420].map { $0 + dx }

        // Mejillas
        for x in [CGFloat(118), 506] {
            ctx.fill(Path(ellipseIn: CGRect(x: x - 48, y: 382, width: 96, height: 54)), with: .color(Self.mejilla.opacity(0.42)))
        }

        // Ojos
        switch pose.estado {
        case .contenta:
            // Felices: dos arcos hacia arriba.
            for x in ojos {
                var p = Path()
                p.move(to: CGPoint(x: x - 38, y: ojoY + 16))
                p.addQuadCurve(to: CGPoint(x: x + 38, y: ojoY + 16), control: CGPoint(x: x, y: ojoY - 40))
                ctx.stroke(p, with: tinta, style: linea)
            }
        case .sinSenal:
            // Tranquilos: cerrados, curva suave hacia abajo.
            for x in ojos {
                var p = Path()
                p.move(to: CGPoint(x: x - 36, y: ojoY - 2))
                p.addQuadCurve(to: CGPoint(x: x + 36, y: ojoY - 2), control: CGPoint(x: x, y: ojoY + 30))
                ctx.stroke(p, with: tinta, style: linea)
            }
        default:
            let alto: CGFloat = parpadeo ? 12 : 96
            for x in ojos {
                ctx.fill(Path(roundedRect: CGRect(x: x - 32, y: ojoY - alto / 2, width: 64, height: alto), cornerRadius: min(32, alto / 2)),
                         with: tinta)
            }
        }

        // Boca
        let bx = 312 + dx * 0.6
        switch pose.estado {
        case .saluda, .contenta:
            // Sonrisa abierta.
            let ancho: CGFloat = pose.estado == .contenta ? 88 : 74
            var p = Path()
            p.move(to: CGPoint(x: bx - ancho / 2, y: 390))
            p.addQuadCurve(to: CGPoint(x: bx + ancho / 2, y: 390), control: CGPoint(x: bx, y: 390 + ancho * 0.8))
            p.closeSubpath()
            ctx.fill(p, with: tinta)
            ctx.stroke(p, with: tinta, style: StrokeStyle(lineWidth: 12, lineCap: .round, lineJoin: .round))
        default:
            let ancho: CGFloat = pose.estado == .buscando ? 40 : 60
            let hondo: CGFloat = pose.estado == .buscando ? 12 : 26
            var p = Path()
            p.move(to: CGPoint(x: bx - ancho / 2, y: 396))
            p.addQuadCurve(to: CGPoint(x: bx + ancho / 2, y: 396), control: CGPoint(x: bx, y: 396 + hondo))
            ctx.stroke(p, with: tinta, style: linea)
        }
    }

    /// Hoja de atrás con la pestaña, igual que el logo.
    static let hojaAtras: Path = {
        var p = Path()
        p.move(to: CGPoint(x: 56, y: 0))
        p.addLine(to: CGPoint(x: 220, y: 0))
        p.addQuadCurve(to: CGPoint(x: 258, y: 20), control: CGPoint(x: 244, y: 0))
        p.addLine(to: CGPoint(x: 290, y: 68))
        p.addLine(to: CGPoint(x: 568, y: 68))
        p.addQuadCurve(to: CGPoint(x: 624, y: 124), control: CGPoint(x: 624, y: 68))
        p.addLine(to: CGPoint(x: 624, y: 368))
        p.addLine(to: CGPoint(x: 0, y: 368))
        p.addLine(to: CGPoint(x: 0, y: 56))
        p.addQuadCurve(to: CGPoint(x: 56, y: 0), control: CGPoint(x: 0, y: 0))
        p.closeSubpath()
        return p
    }()

    /// Nubecita: tres círculos sobre una base redonda.
    static func nube(centro c: CGPoint) -> Path {
        var p = Path()
        p.addEllipse(in: CGRect(x: c.x - 92, y: c.y - 22, width: 76, height: 76))
        p.addEllipse(in: CGRect(x: c.x - 46, y: c.y - 62, width: 100, height: 100))
        p.addEllipse(in: CGRect(x: c.x + 20, y: c.y - 24, width: 72, height: 72))
        p.addRoundedRect(in: CGRect(x: c.x - 92, y: c.y + 10, width: 184, height: 44), cornerSize: CGSize(width: 22, height: 22))
        // 1.3 × alrededor del centro: a 56 pt tiene que leerse.
        return p.applying(CGAffineTransform(translationX: c.x, y: c.y).scaledBy(x: 1.3, y: 1.3).translatedBy(x: -c.x, y: -c.y))
    }
}

#Preview("Estados") {
    HStack(spacing: 12) {
        ForEach(Mascota.Estado.allCases) { Mascota(estado: $0, tamano: 64) }
    }
    .padding()
}
