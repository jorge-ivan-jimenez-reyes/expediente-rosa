import Foundation

// Reconocer a una paciente que regresa aunque su nombre venga escrito distinto.
// Puerto exacto de api/src/coincidencias.ts: si cambias uno, cambia el otro.
// Este archivo solo usa Foundation (nada de SwiftData) para poder compilarlo y
// probarlo aparte con swiftc. La parte que toca `Paciente` está en Coincidencias+Paciente.swift.

/// Datos mínimos para comparar, igual que `DatosPaciente` en TS.
struct DatosPaciente: Sendable, Hashable {
    var nombre: String
    var apellidoPaterno: String
    var apellidoMaterno: String?
    var nacimiento: String?   // "YYYY-MM-DD"
    var edad: Int?
    var comunidad: String?
}

/// Resultado de comparar dos pacientes: puntaje 0…1 y por qué.
struct ResultadoCoincidencia: Sendable, Hashable {
    var puntaje: Double
    var razones: [String]
}

enum Coincidencias {
    static let UMBRAL_POSIBLE = 0.82

    static let apodos: [String: String] = [
        "ma": "maria", "ma.": "maria", "mari": "maria", "lupe": "guadalupe", "lupita": "guadalupe",
        "chuy": "jesus", "chuya": "jesus", "lucha": "luz", "concha": "concepcion", "conchita": "concepcion",
        "chela": "graciela", "lola": "dolores", "paty": "patricia", "pati": "patricia", "vero": "veronica",
        "rosy": "rosa", "chayo": "rosario", "meche": "mercedes", "nena": "", "juana": "juana", "toña": "antonia",
        "tona": "antonia", "cuca": "refugio", "cata": "catalina", "yola": "yolanda", "mague": "margarita",
    ]
    static let abreviaturas: [String: String] = [
        "hdz": "hernandez", "glz": "gonzalez", "mtz": "martinez", "rdz": "rodriguez",
    ]
    static let particulas: Set<String> = ["de", "del", "la", "las", "los", "y"]

    // MARK: normalizar

    static func normalizar(_ texto: String) -> String {
        // minúsculas → NFD → quitar acentos (U+0300…U+036F) → todo lo que no sea a-z o "." separa palabras.
        let descompuesto = texto.lowercased().decomposedStringWithCanonicalMapping
        var palabras: [String] = []
        var actual = String.UnicodeScalarView()
        for u in descompuesto.unicodeScalars {
            if (0x300...0x36F).contains(u.value) { continue }
            if (u.value >= 0x61 && u.value <= 0x7A) || u == "." {
                actual.append(u)
            } else if !actual.isEmpty {
                palabras.append(String(actual)); actual = String.UnicodeScalarView()
            }
        }
        if !actual.isEmpty { palabras.append(String(actual)) }

        return palabras
            .map { p -> String in
                if let a = apodos[p] { return a }
                return p.hasSuffix(".") ? String(p.dropLast()) : p
            }
            .map { abreviaturas[$0] ?? $0 }
            .filter { !$0.isEmpty && !particulas.contains($0) }
            .joined(separator: " ")
    }

    // MARK: fonética

    /// Errores comunes de captura en español: b/v, s/z/c, y/ll, h muda, j/g.
    /// Mismo orden de reemplazos que la versión TS.
    static func fonetica(_ palabra: String) -> String {
        var s = Array(palabra.unicodeScalars)
        if s.first == "h" { s.removeFirst() }                          // ^h
        s = reemplazarPar(s, "l", "l", con: "y")                         // ll → y
        s = s.map { $0 == "v" ? "b" : $0 == "z" ? "s" : $0 }             // v → b, z → s
        s = antesDeEoI(s, "c", con: "s")                                 // c[ei] → s[ei]
        s = antesDeEoI(s, "g", con: "j")                                 // g[ei] → j[ei]
        s = reemplazarPar(s, "q", "u", con: "k")                         // qu → k
        s = s.map { $0 == "c" ? "k" : $0 }                               // c → k
        var sinRepetir: [Unicode.Scalar] = []                            // (.)\1+ → $1
        for u in s where sinRepetir.last != u { sinRepetir.append(u) }
        var vista = String.UnicodeScalarView(); vista.append(contentsOf: sinRepetir)
        return String(vista)
    }

    private static func reemplazarPar(_ s: [Unicode.Scalar], _ x: Unicode.Scalar, _ y: Unicode.Scalar, con r: Unicode.Scalar) -> [Unicode.Scalar] {
        var out: [Unicode.Scalar] = []; var i = 0
        while i < s.count {
            if s[i] == x, i + 1 < s.count, s[i + 1] == y { out.append(r); i += 2 } else { out.append(s[i]); i += 1 }
        }
        return out
    }

    private static func antesDeEoI(_ s: [Unicode.Scalar], _ x: Unicode.Scalar, con r: Unicode.Scalar) -> [Unicode.Scalar] {
        var out = s
        for i in s.indices where s[i] == x && i + 1 < s.count && (s[i + 1] == "e" || s[i + 1] == "i") { out[i] = r }
        return out
    }

    // MARK: Jaro-Winkler

    /// Igual que la versión TS, sobre unidades UTF-16 como los strings de JavaScript.
    static func jaroWinkler(_ sa: String, _ sb: String) -> Double {
        if sa == sb { return 1 }
        let a = Array(sa.utf16), b = Array(sb.utf16)
        if a.isEmpty || b.isEmpty { return 0 }
        let rango = max(0, max(a.count, b.count) / 2 - 1)
        var ma = [Bool](repeating: false, count: a.count), mb = [Bool](repeating: false, count: b.count)
        var m = 0
        for i in 0..<a.count {
            var j = max(0, i - rango)
            while j < min(b.count, i + rango + 1) {
                if !mb[j] && a[i] == b[j] { ma[i] = true; mb[j] = true; m += 1; break }
                j += 1
            }
        }
        if m == 0 { return 0 }
        var t = 0, k = 0
        for i in 0..<a.count where ma[i] {
            while !mb[k] { k += 1 }
            if a[i] != b[k] { t += 1 }
            k += 1
        }
        let md = Double(m)
        let jaro = (md / Double(a.count) + md / Double(b.count) + (md - Double(t) / 2) / md) / 3
        var p = 0
        while p < 4 && p < a.count && p < b.count && a[p] == b[p] { p += 1 }
        return jaro + Double(p) * 0.1 * (1 - jaro)
    }

    // MARK: año, llaves de bloque y comparar

    /// Año de nacimiento: de la fecha si la hay, si no de la edad. `nil` donde TS da un valor falso (undefined, NaN, 0).
    static func anio(_ p: DatosPaciente, hoy: Int = Calendar.current.component(.year, from: Date())) -> Int? {
        let y: Int?
        if let n = p.nacimiento, !n.isEmpty {
            y = Int(String(n.prefix(4)).trimmingCharacters(in: .whitespaces))
        } else if let e = p.edad {
            y = hoy - e
        } else {
            y = nil
        }
        return y == 0 ? nil : y
    }

    private static func primera(_ s: String) -> String {
        String(s.split(separator: " ", omittingEmptySubsequences: false).first ?? "")
    }

    /// Llaves de bloque: solo se compara contra pacientes que comparten alguna.
    static func llavesBloque(_ p: DatosPaciente) -> [String] {
        let ap = fonetica(primera(normalizar(p.apellidoPaterno)))
        let am = fonetica(primera(normalizar(p.apellidoMaterno ?? "")))
        let y = anio(p)
        var llaves = ["ap:\(ap.prefix(4))"]
        if !am.isEmpty { llaves.append("am:\(am.prefix(4))") }
        if let y { llaves.append("ap-anio:\(ap.prefix(3)):\(y)") }
        return llaves
    }

    static func comparar(_ a: DatosPaciente, _ b: DatosPaciente) -> ResultadoCoincidencia {
        var razones: [String] = []
        func f(_ s: String?) -> String {
            normalizar(s ?? "").split(separator: " ", omittingEmptySubsequences: false).map { fonetica(String($0)) }.joined(separator: " ")
        }
        let sNombre = jaroWinkler(f(a.nombre), f(b.nombre))
        let sPat = jaroWinkler(f(a.apellidoPaterno), f(b.apellidoPaterno))
        // Si a alguna le falta el apellido materno, no se adivina: se reparte su peso.
        var puntaje: Double
        if let amA = a.apellidoMaterno, !amA.isEmpty, let amB = b.apellidoMaterno, !amB.isEmpty {
            puntaje = sNombre * 0.35 + sPat * 0.35 + jaroWinkler(f(amA), f(amB)) * 0.15
        } else {
            puntaje = ((sNombre + sPat) / 2) * 0.85
        }
        if sNombre > 0.9 { razones.append("nombre parecido") }
        if sPat > 0.9 { razones.append("apellido paterno parecido") }

        let ya = anio(a), yb = anio(b)
        if let na = a.nacimiento, !na.isEmpty, let nb = b.nacimiento, !nb.isEmpty, na == nb {
            puntaje += 0.15; razones.append("misma fecha de nacimiento")
        } else if let ya, let yb, abs(ya - yb) <= 1 {
            puntaje += 0.1; razones.append("misma edad (±1 año)")
        } else if ya != nil && yb != nil {
            puntaje -= 0.15
        }

        if let ca = a.comunidad, !ca.isEmpty, let cb = b.comunidad, !cb.isEmpty, normalizar(ca) == normalizar(cb) {
            puntaje += 0.05; razones.append("misma comunidad")
        }
        return ResultadoCoincidencia(puntaje: max(0, min(1, puntaje)), razones: razones)
    }
}
