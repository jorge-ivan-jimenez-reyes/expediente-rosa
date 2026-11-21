import CoreGraphics
import Foundation
import ImageIO
import Vision

/// OCR en el teléfono con Vision (sin red). Devuelve el texto por renglones, de arriba abajo,
/// para que el modelo vea "Nombre: ... Edad: ..." en el mismo renglón como en el papel.
enum LectorTexto {
    /// Palabras de las hojas de EIRA que el corrector de Vision no conoce.
    static let palabrasPropias = ["mastografía", "mastografia", "papanicolaou", "ultrasonido", "BI-RADS",
                                  "exploración", "tamizaje", "comunidad", "municipio", "folio", "EIRA"]

    static func leer(_ imagen: CGImage, orientacion: CGImagePropertyOrientation? = nil) async throws -> String {
        var peticion = RecognizeTextRequest()
        peticion.recognitionLevel = .accurate
        peticion.usesLanguageCorrection = true
        peticion.customWords = palabrasPropias
        peticion.recognitionLanguages = idiomas(soportados: peticion.supportedRecognitionLanguages)

        let observaciones = try await peticion.perform(on: imagen, orientation: orientacion)
        return renglones(observaciones.compactMap { obs -> Fragmento? in
            guard let texto = obs.topCandidates(1).first?.string, !texto.isEmpty else { return nil }
            let caja = obs.boundingBox.cgRect   // normalizada, origen abajo-izquierda
            return Fragmento(texto: texto, x: caja.minX, y: caja.midY, alto: caja.height)
        })
    }

    /// es-MX si Vision lo trae; si no, el español que tenga.
    static func idiomas(soportados: [Locale.Language]) -> [Locale.Language] {
        let preferidos = ["es-MX", "es-419", "es-ES"].map(Locale.Language.init(identifier:))
        let elegidos = preferidos.filter { p in soportados.contains { $0.maximalIdentifier == p.maximalIdentifier } }
        if !elegidos.isEmpty { return elegidos }
        let espanol = soportados.filter { $0.languageCode == .spanish }
        return espanol.isEmpty ? [Locale.Language(identifier: "es-ES")] : espanol
    }

    struct Fragmento { var texto: String; var x: CGFloat; var y: CGFloat; var alto: CGFloat }

    /// Agrupa fragmentos con la misma altura en un renglón y los ordena de izquierda a derecha.
    static func renglones(_ fragmentos: [Fragmento]) -> String {
        var grupos: [[Fragmento]] = []
        for f in fragmentos.sorted(by: { $0.y > $1.y }) {
            if let ultimo = grupos.last?.first, abs(ultimo.y - f.y) < max(ultimo.alto, f.alto) * 0.5 {
                grupos[grupos.count - 1].append(f)
            } else {
                grupos.append([f])
            }
        }
        return grupos
            .map { $0.sorted { $0.x < $1.x }.map(\.texto).joined(separator: "   ") }
            .joined(separator: "\n")
    }
}

#if canImport(UIKit)
import UIKit

extension UIImage.Orientation {
    var orientacionCG: CGImagePropertyOrientation {
        switch self {
        case .up: .up
        case .down: .down
        case .left: .left
        case .right: .right
        case .upMirrored: .upMirrored
        case .downMirrored: .downMirrored
        case .leftMirrored: .leftMirrored
        case .rightMirrored: .rightMirrored
        @unknown default: .up
        }
    }
}

extension UIImage {
    /// CGImage para Vision; si la imagen viene de CIImage, la dibuja.
    var cgParaVision: CGImage? {
        if let cgImage { return cgImage }
        let formato = UIGraphicsImageRendererFormat()
        formato.scale = scale
        return UIGraphicsImageRenderer(size: size, format: formato).image { _ in draw(at: .zero) }.cgImage
    }
}
#endif
