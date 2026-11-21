import Foundation

/// Errores de red y sincronización, con texto listo para mostrar en la UI.
enum ErrorSync: LocalizedError, Equatable {
    case sinSenal                    // NWPathMonitor dice que no hay red (o se simula)
    case sinServidor(String)         // hay red pero el servidor no contesta
    case rechazado(Int, String)      // el servidor contestó con error HTTP
    case respuestaIncompleta         // el servidor no confirmó todos los eventos del lote
    case enCurso                     // ya hay una sincronización corriendo
    case parInvalido                 // el par de duplicados no trae las dos pacientes

    var errorDescription: String? {
        switch self {
        case .sinSenal: "Sin señal. Lo capturado queda guardado en el teléfono."
        case .sinServidor(let d): "No se pudo llegar al servidor: \(d)"
        case .rechazado(let c, let d): "El servidor rechazó el envío (\(c)): \(d)"
        case .respuestaIncompleta: "El servidor no confirmó todos los registros; se reintenta después."
        case .enCurso: "Ya se está sincronizando."
        case .parInvalido: "El par de duplicados está incompleto."
        }
    }
}

/// Cliente HTTP de la API (api/src/index.ts). Sin estado: se puede usar desde cualquier hilo.
struct ClienteAPI: Sendable {
    var base: URL
    var sesion: URLSession
    var espera: TimeInterval

    init(base: URL = Config.apiURL, sesion: URLSession = .shared, espera: TimeInterval = 15) {
        self.base = base; self.sesion = sesion; self.espera = espera
    }

    /// true si la API y Valkey contestan.
    func salud() async -> Bool {
        struct Salud: Decodable { var ok: Bool }
        return (try? await pedir(Salud.self, ruta: "salud"))?.ok ?? false
    }

    /// POST /api/sync. Máximo 500 eventos por llamada (el Sincronizador manda de 100 en 100).
    func sincronizar(_ peticion: SyncPeticion) async throws -> ResultadoSync {
        try await pedir(ResultadoSync.self, ruta: "sync", metodo: "POST", cuerpo: peticion)
    }

    /// GET /api/pacientes?comunidad= (con sus estudios).
    func pacientes(comunidad: String?) async throws -> [PacienteDTO] {
        var q: [URLQueryItem] = []
        if let comunidad, !comunidad.isEmpty { q.append(URLQueryItem(name: "comunidad", value: comunidad)) }
        return try await pedir([PacienteDTO].self, ruta: "pacientes", consulta: q)
    }

    /// GET /api/duplicados: cola de la coordinadora, el puntaje más alto primero.
    func duplicados() async throws -> [ParDuplicado] {
        try await pedir([ParDuplicado].self, ruta: "duplicados")
    }

    /// POST /api/duplicados/resolver. unir = true pasa los estudios de b a a; false las marca como distintas.
    func resolver(_ par: ParDuplicado, unir: Bool) async throws {
        guard let (a, b) = Self.ids(de: par) else { throw ErrorSync.parInvalido }
        struct Cuerpo: Encodable { var a: String; var b: String; var decision: String }
        struct Ok: Decodable { var ok: Bool }
        _ = try await pedir(Ok.self, ruta: "duplicados/resolver", metodo: "POST",
                            cuerpo: Cuerpo(a: a, b: b, decision: unir ? "unir" : "separar"))
    }

    // MARK: - Reto 1

    /// GET /api/bitacora: quién, qué, cuándo (sin datos clínicos), el más nuevo primero. limite 1–500.
    func bitacora(limite: Int = 50, pacienteId: String? = nil) async throws -> [EntradaBitacora] {
        var q = [URLQueryItem(name: "limite", value: String(min(max(limite, 1), 500)))]
        if let pacienteId { q.append(URLQueryItem(name: "pacienteId", value: pacienteId)) }
        return try await pedir([EntradaBitacora].self, ruta: "bitacora", consulta: q)
    }

    /// GET /api/seguimiento: estudios por atender, vencidos primero.
    func seguimiento(comunidad: String? = nil) async throws -> [SeguimientoDTO] {
        var q: [URLQueryItem] = []
        if let comunidad, !comunidad.isEmpty { q.append(URLQueryItem(name: "comunidad", value: comunidad)) }
        return try await pedir([SeguimientoDTO].self, ruta: "seguimiento", consulta: q)
    }

    /// GET /api/conflictos: correcciones que no se aplicaron, más viejas primero.
    func conflictos() async throws -> [ConflictoDTO] {
        try await pedir([ConflictoDTO].self, ruta: "conflictos")
    }

    /// POST /api/conflictos/:id/resolver. Devuelve la versión nueva de la paciente si se aceptó.
    @discardableResult
    func resolverConflicto(id: String, aceptar: Bool, autor: String? = nil) async throws -> Int? {
        struct Cuerpo: Encodable { var decision: String; var autor: String? }
        struct Respuesta: Decodable { var ok: Bool; var version: Int? }
        let r = try await pedir(Respuesta.self, ruta: "conflictos/\(id)/resolver", metodo: "POST",
                                cuerpo: Cuerpo(decision: aceptar ? "aceptar" : "rechazar", autor: autor))
        return r.version
    }

    /// Ids del par: de las fichas, o de la llave "duplicado:<id1>|<id2>" si alguna ficha no vino.
    static func ids(de par: ParDuplicado) -> (String, String)? {
        if let a = par.a?.id, let b = par.b?.id { return (a, b) }
        guard par.llave.hasPrefix("duplicado:") else { return nil }
        let partes = par.llave.dropFirst("duplicado:".count).split(separator: "|").map(String.init)
        return partes.count == 2 ? (partes[0], partes[1]) : nil
    }

    // MARK: - HTTP

    private func pedir<T: Decodable>(_ tipo: T.Type, ruta: String, metodo: String = "GET",
                                     consulta: [URLQueryItem] = [], cuerpo: (any Encodable)? = nil) async throws -> T {
        var url = base.appending(path: ruta)
        if !consulta.isEmpty { url.append(queryItems: consulta) }
        var req = URLRequest(url: url, timeoutInterval: espera)
        req.httpMethod = metodo
        if let cuerpo {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(cuerpo)
        }
        let datos: Data, respuesta: URLResponse
        do {
            (datos, respuesta) = try await sesion.data(for: req)
        } catch let e as URLError {
            throw ErrorSync.sinServidor(e.localizedDescription)
        }
        let codigo = (respuesta as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(codigo) else {
            throw ErrorSync.rechazado(codigo, String(decoding: datos.prefix(300), as: UTF8.self))
        }
        return try JSONDecoder().decode(T.self, from: datos)
    }
}

/// Lee las fechas que manda el servidor: ISO 8601 con o sin milisegundos, o solo "YYYY-MM-DD".
enum Fechas {
    static func leer(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        if let d = try? Date.ISO8601FormatStyle().parse(s) { return d }
        if let d = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(s) { return d }
        // Solo día: se toma en la zona del teléfono para que no se muestre un día antes.
        if let d = try? Date.ISO8601FormatStyle(timeZone: .current).year().month().day().parse(s) { return d }
        return nil
    }
}
