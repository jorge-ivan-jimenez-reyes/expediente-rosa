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
}

struct EstudioDTO: Codable, Sendable, Hashable {
    var id: String
    var pacienteId: String
    var tipo: String
    var fecha: String
    var resultado: String
    var nota: String?
    var registradoPor: String
}

struct EventoDTO: Codable, Sendable {
    var llave: String
    var tipo: String
    var paciente: PacienteDTO?
    var estudio: EstudioDTO?
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
                    consentimiento: ISO.texto(consentimiento), creadaPor: creadaPor, creada: ISO.texto(creada), estudios: nil)
    }
}

extension Estudio {
    var dto: EstudioDTO {
        EstudioDTO(id: id, pacienteId: pacienteId, tipo: tipoRaw, fecha: ISO.texto(fecha), resultado: resultadoRaw,
                   nota: nota, registradoPor: registradoPor)
    }
}
