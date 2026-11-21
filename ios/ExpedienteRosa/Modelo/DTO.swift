import Foundation

// Lo que viaja a la API. Mismos nombres y formatos que api/src/index.ts.

struct PacienteDTO: Codable, Sendable, Hashable {
    var id: String
    var folio: String
    var nombre: String
    var apellidoPaterno: String
    var apellidoMaterno: String?
    var nacimiento: String?
    var edad: Int?
    var comunidad: String
    var municipio: String?
    var consentimiento: String   // ISO 8601
    var creadaPor: String
    var creada: String           // ISO 8601
    var estudios: [EstudioDTO]?  // solo viene en GET /pacientes
    // Reto 1
    var entidadNacimiento: String? = nil
    var idEira: String? = nil
    var version: Int? = nil       // la pone el servidor; no se manda en el alta
    var visitas: [VisitaDTO]? = nil  // solo viene en GET /pacientes
}

struct EstudioDTO: Codable, Sendable, Hashable {
    var id: String
    var pacienteId: String
    var tipo: String
    var fecha: String
    var resultado: String
    var nota: String?
    var registradoPor: String
    // Reto 1
    var visitaId: String? = nil
    var clasificacion: String? = nil
    var conducta: String? = nil   // rutina-1-anio | mastografia-tamizaje | imagen-complementaria | evaluacion-6-meses | referencia
}

struct VisitaDTO: Codable, Sendable, Hashable {
    var id: String
    var pacienteId: String
    var fecha: String             // ISO 8601
    var comunidad: String
    var motivo: String?
    var registradaPor: String
}

/// Valor de un campo editable de la paciente: texto o número (edad).
enum ValorCampo: Codable, Sendable, Hashable, ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, CustomStringConvertible {
    case texto(String)
    case numero(Int)

    init(stringLiteral v: String) { self = .texto(v) }
    init(integerLiteral v: Int) { self = .numero(v) }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) { self = .numero(n) }
        else if let d = try? c.decode(Double.self) { self = .numero(Int(d)) }
        else { self = .texto(try c.decode(String.self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .texto(let s): try c.encode(s)
        case .numero(let n): try c.encode(n)
        }
    }
    var description: String {
        switch self {
        case .texto(let s): s
        case .numero(let n): String(n)
        }
    }
}

struct ActualizacionDTO: Codable, Sendable, Hashable {
    var pacienteId: String
    var campos: [String: ValorCampo]
    var versionBase: Int
    var autor: String
}

struct EventoDTO: Codable, Sendable {
    var llave: String
    var tipo: String
    var paciente: PacienteDTO?
    var estudio: EstudioDTO?
    var visita: VisitaDTO? = nil
    var actualizacion: ActualizacionDTO? = nil
}

struct SyncPeticion: Codable, Sendable {
    var dispositivo: String
    var eventos: [EventoDTO]
}

struct ResultadoSync: Codable, Sendable {
    struct Posible: Codable, Sendable, Hashable { var pacienteId: String; var con: String; var puntaje: Double; var razones: [String] }
    var aplicados: Int
    var repetidos: Int
    var posiblesDuplicados: [Posible]
    /// Reto 1: actualizaciones que no se aplicaron (quedan en /conflictos para la coordinadora).
    struct Conflicto: Codable, Sendable, Hashable { var pacienteId: String; var campos: [String] }
    var conflictos: [Conflicto]? = nil
}

/// Datos mínimos de la paciente en seguimiento y conflictos.
struct PacienteCorta: Codable, Sendable, Hashable {
    var id: String
    var folio: String
    var nombre: String
    var apellidoPaterno: String
    var apellidoMaterno: String?
    var comunidad: String
    var nombreCompleto: String { [nombre, apellidoPaterno, apellidoMaterno].compactMap { $0 }.joined(separator: " ") }
}

/// GET /api/conflictos
struct ConflictoDTO: Codable, Sendable, Identifiable, Hashable {
    struct Campo: Codable, Sendable, Hashable {
        var campo: String
        var propuesto: ValorCampo?
        var actual: ValorCampo?
        var alRecibir: ValorCampo?
    }
    var id: String
    var pacienteId: String
    var autor: String
    var dispositivo: String?
    var creado: String
    var motivo: String           // version-distinta | paciente-no-existe
    var versionBase: Int
    var versionActual: Int?
    var campos: [Campo]
    var paciente: PacienteCorta?
}

/// GET /api/seguimiento
struct SeguimientoDTO: Codable, Sendable, Identifiable, Hashable {
    var estudioId: String
    var tipo: String
    var fecha: String
    var motivo: String?
    var fechaLimite: String
    var vencido: Bool
    var diasRestantes: Int
    var paciente: PacienteCorta
    var id: String { estudioId }
}

/// GET /api/bitacora: quién, qué, cuándo. Sin datos clínicos.
struct EntradaBitacora: Codable, Sendable, Identifiable, Hashable {
    var id: String
    var cuando: String
    var tipo: String
    var autor: String?
    var dispositivo: String?
    var pacienteId: String?
    var otraPacienteId: String?
    var estudioId: String?
    var visitaId: String?
    var conflictoId: String?
    var campos: [String]?
    var version: Int?
}

struct ParDuplicado: Codable, Sendable, Identifiable, Hashable {
    var llave: String
    var puntaje: Double
    var razones: String
    var a: PacienteDTO?
    var b: PacienteDTO?
    var id: String { llave }
}

enum ISO {
    nonisolated(unsafe) static let formato: ISO8601DateFormatter = ISO8601DateFormatter()
    static func texto(_ d: Date) -> String { formato.string(from: d) }
    static func fecha(_ s: String) -> Date? { formato.date(from: s) }
}

extension Paciente {
    var dto: PacienteDTO {
        PacienteDTO(id: id, folio: folio, nombre: nombre, apellidoPaterno: apellidoPaterno, apellidoMaterno: apellidoMaterno,
                    nacimiento: nacimiento, edad: edad, comunidad: comunidad, municipio: municipio,
                    consentimiento: ISO.texto(consentimiento), creadaPor: creadaPor, creada: ISO.texto(creada), estudios: nil,
                    entidadNacimiento: entidadNacimiento, idEira: idEira)
    }
}

extension Estudio {
    var dto: EstudioDTO {
        EstudioDTO(id: id, pacienteId: pacienteId, tipo: tipoRaw, fecha: ISO.texto(fecha), resultado: resultadoRaw,
                   nota: nota, registradoPor: registradoPor, visitaId: visitaId, clasificacion: clasificacion,
                   conducta: conductaRaw)
    }
}

extension Visita {
    var dto: VisitaDTO {
        VisitaDTO(id: id, pacienteId: pacienteId, fecha: ISO.texto(fecha), comunidad: comunidad, motivo: motivo,
                  registradaPor: registradaPor)
    }
}
