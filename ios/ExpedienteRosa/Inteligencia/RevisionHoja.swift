import Foundation

/// Revisión determinista de lo que devuelve el modelo contra el texto que leyó Vision.
/// El modelo del teléfono (~3B) a veces corta nombres, voltea DD/MM, inventa un apellido o
/// pone "normal" a un estudio ANORMAL. Aquí: lo que no está en el papel se descarta y lo que
/// se puede leer con reglas (edad, fecha de nacimiento, resultado del renglón) se corrige.
/// La enfermera revisa siempre antes de guardar; esto solo reduce lo que tiene que corregir.
enum RevisionHoja {
    static func revisar(_ g: HojaGenerada, texto: String) -> (NuevaPaciente, [NuevoEstudio]) {
        let lineas = texto.split(whereSeparator: \.isNewline).map { plegar(String($0)) }
        let todo = plegar(texto)
        return (paciente(g.paciente, todo: todo), g.estudios.map { estudio($0, lineas: lineas, todo: todo) })
    }

    // MARK: Paciente

    static func paciente(_ g: PacienteGenerada, todo: String) -> NuevaPaciente {
        var nombre = TextoIA.limpio(g.nombre)
        var paterno = TextoIA.limpio(g.apellidoPaterno)
        var materno = TextoIA.opcional(g.apellidoMaterno)

        // "Rosa Isela Vásquez": todo lo que va antes del paterno es nombre de pila; lo de después, materno.
        var palabras = TextoIA.limpio(g.nombreTalCual).split(separator: " ").map(String.init)
        if let etiqueta = palabras.lastIndex(where: { $0.hasSuffix(":") }) { palabras.removeSubrange(...etiqueta) }  // "Nombre:"
        if !paterno.isEmpty, let i = palabras.firstIndex(where: { plegar($0) == plegar(paterno) }), i >= 1 {
            nombre = palabras[..<i].joined(separator: " ")
            let resto = palabras[(i + 1)...]
            materno = resto.isEmpty ? nil : resto.joined(separator: " ")
        }
        if let m = materno, plegar(m) == plegar(paterno) { materno = nil }

        // Nada que no esté escrito en la hoja.
        if !aparece(nombre, en: todo) { nombre = "" }
        if !aparece(paterno, en: todo) { paterno = "" }
        if let m = materno, !aparece(m, en: todo) { materno = nil }
        var comunidad = TextoIA.limpio(g.comunidad)
        if !aparece(comunidad, en: todo) { comunidad = "" }
        var municipio = TextoIA.opcional(g.municipio).map(sinEstado)
        if let m = municipio, !aparece(m, en: todo) { municipio = nil }

        let edadLeida = primerGrupo(#/edad\s*:?\s*(\d{1,3})/#, en: todo).flatMap { Int($0) }
        let edad = edadLeida ?? g.edad.flatMap { e in todo.contains(String(e)) && (0...120).contains(e) ? e : nil }

        let nacLeido = primerGrupo(#/(?:f\.?\s*(?:de\s*)?nac[a-z]*\.?|nacimiento|nacio)\s*:?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/#, en: todo)
        let nacimiento = (nacLeido ?? TextoIA.opcional(g.nacimiento).flatMap { fechaEscrita($0, en: todo) })
            .flatMap(FechasIA.normalizar)

        return NuevaPaciente(nombre: nombre, apellidoPaterno: paterno, apellidoMaterno: materno,
                             nacimiento: nacimiento, edad: edad, comunidad: comunidad, municipio: municipio)
    }

    // MARK: Estudios

    static let claves: [TipoEstudio: [String]] = [
        .mastografia: ["mastograf", "mamograf"],
        .ultrasonido: ["ultrason", "usg", "ecograf"],
        .papanicolaou: ["papanicol", "pap ", "citolog"],
        .exploracion: ["exploracion", "explor."],
    ]

    static func estudio(_ g: EstudioGenerado, lineas: [String], todo: String) -> NuevoEstudio {
        let tipo = g.tipo.tipo
        let fechaModelo = TextoIA.opcional(g.fecha).flatMap { fechaEscrita($0, en: todo) }

        // Renglones que hablan de este tipo de estudio (más el siguiente, donde suele seguir la nota).
        let deEsteTipo = lineas.indices.filter { i in claves[tipo, default: []].contains { lineas[i].contains($0) } }
        let fechaComoTexto = fechaModelo.map { f in FechasIA.componentes(f).map { String(format: "%02d/%02d/%04d", $0.2, $0.1, $0.0) } ?? f }
        let elegido = deEsteTipo.first { i in fechaComoTexto.map { lineas[i].contains($0) } ?? false } ?? deEsteTipo.first
        let contexto = elegido.map { i in lineas[i] + " " + (i + 1 < lineas.count ? lineas[i + 1] : "") } ?? ""

        var resultado = g.resultado.resultado
        if contexto.contains("anormal") || contexto.contains("sospech") || contexto.contains("positiv")
            || contexto.contains(#/bi-?rads\s*[45]/#) {
            resultado = .anormal
        } else if contexto.contains(#/\bnormal\b/#) {
            resultado = .normal
        } else if contexto.contains("pendiente") {
            resultado = .pendiente
        }

        // Fecha: la que copió el modelo si está en la hoja; si no, la del renglón; si no, la primera de la hoja.
        let fechaRenglon = elegido.flatMap { primerGrupo(#/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/#, en: lineas[$0]) }
        let fechaHoja = primerGrupo(#/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/#, en: todo)
        let fecha = (fechaModelo ?? fechaRenglon ?? fechaHoja).flatMap(FechasIA.fecha) ?? .now

        return NuevoEstudio(tipo: tipo, fecha: fecha, resultado: resultado, nota: nota(g.nota))
    }

    /// Quita notas que solo repiten tipo y resultado, o que son la firma del personal.
    static func nota(_ n: String?) -> String? {
        guard let n = TextoIA.opcional(n) else { return nil }
        let p = plegar(n)
        if p.contains(#/\b(dra?|enf|registro)\b\.?/#) { return nil }
        var resto = p
        for palabra in ["mastografia", "ultrasonido", "papanicolaou", "exploracion", "clinica", "de mama", "anormal", "normal", "pendiente"] {
            resto = resto.replacingOccurrences(of: palabra, with: "")
        }
        return resto.contains(where: { $0.isLetter || $0.isNumber }) ? n : nil
    }

    // MARK: Apoyo

    static func plegar(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_MX")).lowercased()
    }

    /// Todas las palabras del valor aparecen en la hoja (sin acentos ni mayúsculas).
    static func aparece(_ valor: String, en todo: String) -> Bool {
        let palabras = plegar(valor).split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        return !palabras.isEmpty && palabras.allSatisfy { todo.contains($0) }
    }

    /// "Huejuquilla el Alto, Jal." → "Huejuquilla el Alto".
    static func sinEstado(_ s: String) -> String {
        guard let coma = s.lastIndex(of: ","), s[s.index(after: coma)...].trimmingCharacters(in: .whitespaces).count <= 6 else { return s }
        return TextoIA.limpio(String(s[..<coma]))
    }

    /// La fecha del modelo solo vale si sus tres números están en la hoja; se devuelve como está en la hoja.
    static func fechaEscrita(_ f: String, en todo: String) -> String? {
        guard let (a, m, d) = FechasIA.componentes(f) else { return nil }
        let candidatos = [String(format: "%02d/%02d/%04d", d, m, a), String(format: "%d/%d/%04d", d, m, a),
                          String(format: "%02d-%02d-%04d", d, m, a), String(format: "%04d-%02d-%02d", a, m, d)]
        if let escrita = candidatos.first(where: { todo.contains($0) }) { return escrita }
        // El modelo volteó día y mes: si la versión volteada sí está en la hoja, se usa esa.
        let volteada = String(format: "%02d/%02d/%04d", m, d, a)
        return d <= 12 && todo.contains(volteada) ? volteada : nil
    }

    static func primerGrupo(_ r: Regex<(Substring, Substring)>, en s: String) -> String? {
        s.firstMatch(of: r).map { String($0.1) }
    }
}
