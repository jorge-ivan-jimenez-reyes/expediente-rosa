import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Lo que se pudo leer del estudio de hoy, de la hoja de diagnóstico o de un dictado.
struct EstudioLeido: Sendable, Hashable {
    var tipo: TipoEstudio?
    var clasificacion: String?   // "BI-RADS 4" o "Bethesda: LSIL", como las opciones de la pantalla
    var nota: String?
    var referida = false
    var textoCrudo = ""
}

/// Reglas fijas, sin modelo: BI-RADS, Bethesda, referencia y notas. Lo que no está escrito no se llena.
/// Funciona sin Apple Intelligence porque solo usa Vision. El médico revisa siempre antes de guardar.
enum LecturaEstudio {
    static func desdeTexto(_ texto: String) -> EstudioLeido {
        let t = RevisionHoja.plegar(texto)
        var r = EstudioLeido(textoCrudo: texto)

        // BI-RADS escrito («BI-RADS 4»); se ignora la leyenda impresa «0. Estudio no concluyente…».
        if let b = RevisionHoja.primerGrupo(#/bi-?rads\s*(\d)(?!\s*\.\s*[a-z]*\s*(?:estudio|est\b))/#, en: t), let n = Int(b), (0...5).contains(n) {
            r.clasificacion = "BI-RADS \(n)"
        } else if t.contains("papanicol") || t.contains("citolog") || t.contains("bethesda") {
            // El formato de citología imprime toda la lista Bethesda: ahí no se adivina, lo captura el médico.
            let traeLeyenda = t.contains("categoria del diagnostico") || t.contains("otro hallazgo")
            r.clasificacion = traeLeyenda ? nil : bethesda(t).map { "Bethesda: \($0)" }
        }

        // Tipo: el formato de revisión mamaria es de mama; en un dictado, la primera palabra de estudio que aparezca.
        if t.contains("citologia cervical") || t.contains("reporte de citologia") {
            r.tipo = .papanicolaou
        } else if t.contains("revision mamaria") || t.contains("evaluacion diagnostica") || t.contains("conducta a seguir") {
            r.tipo = .mastografia
        } else {
            let claves: [(String, TipoEstudio)] = [("mastograf", .mastografia), ("mamograf", .mastografia), ("ultrason", .ultrasonido),
                                                    ("papanicol", .papanicolaou), ("citolog", .papanicolaou), ("explor", .exploracion)]
            r.tipo = claves.compactMap { c in t.range(of: c.0).map { ($0.lowerBound, c.1) } }.min { $0.0 < $1.0 }?.1
        }

        r.referida = t.contains("referi") || t.contains("reenvi") || t.contains("se refiere")
        r.nota = notas(texto)
        return r
    }

    /// Renglones escritos después de «Notas:», hasta el pie de página.
    static func notas(_ texto: String) -> String? {
        let lineas = texto.split(whereSeparator: \.isNewline).map { String($0).trimmingCharacters(in: .whitespaces) }
        // «Notas:» puede quedar tapada por lo escrito: entonces se toma lo que sigue a «Motivo de referencia».
        guard let i = lineas.firstIndex(where: { RevisionHoja.plegar($0).hasPrefix("notas") })
                ?? lineas.firstIndex(where: { RevisionHoja.plegar($0).contains("motivo de referencia") }) else { return nil }
        var partes: [String] = []
        let enMismo = RevisionHoja.plegar(lineas[i]).hasPrefix("notas")
            ? lineas[i].drop(while: { $0 != ":" }).dropFirst().trimmingCharacters(in: .whitespaces) : ""
        if !enMismo.isEmpty { partes.append(enMismo) }
        for l in lineas[(i + 1)...] {
            let p = RevisionHoja.plegar(l)
            if p.hasPrefix("contacto") || p.contains("eiraac") || p.contains("sello") { break }
            if !l.isEmpty { partes.append(l) }
        }
        let n = partes.joined(separator: " ")
        return n.isEmpty ? nil : String(n.prefix(500))
    }

    static func bethesda(_ t: String) -> String? {
        if t.contains("hsil") || t.contains("alto grado") { return "HSIL" }
        if t.contains("lsil") || t.contains("bajo grado") { return "LSIL" }
        if t.contains("asc-h") || t.contains("asch") { return "ASC-H" }
        if t.contains("asc-us") || t.contains("ascus") { return "ASC-US" }
        if t.contains("agc") { return "AGC" }
        if t.contains("nilm") || t.contains("negativ") { return "NILM" }
        return nil
    }

    #if canImport(UIKit)
    /// Foto de la hoja de diagnóstico → estudio de hoy.
    static func leer(_ imagen: UIImage) async throws -> EstudioLeido {
        let texto: String
        if let cg = imagen.cgImage {
            texto = try await LectorTexto.leer(cg, orientacion: imagen.imageOrientation.orientacionCG)
        } else if let dibujada = imagen.cgParaVision {
            texto = try await LectorTexto.leer(dibujada, orientacion: .up)
        } else {
            throw ErrorInteligencia.imagenIlegible
        }
        var r = desdeTexto(texto)
        if r.tipo == nil { r.tipo = .mastografia }
        return r
    }
    #endif
}
