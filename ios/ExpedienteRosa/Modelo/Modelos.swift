import Foundation
import SwiftData

// Datos mínimos: lo justo para reconocer a la paciente y seguir sus estudios.
// Los nombres de campos son los mismos que los esquemas zod de api/src/index.ts.

enum Rol: String, CaseIterable, Identifiable, Codable, Sendable {
    case enfermeria, medico, coordinadora
    var id: String { rawValue }
    var nombre: String {
        switch self {
        case .enfermeria: "Enfermería"
        case .medico: "Médico"
        case .coordinadora: "Coordinadora"
        }
    }
}

enum TipoEstudio: String, CaseIterable, Codable, Sendable {
    case mastografia, ultrasonido, papanicolaou, exploracion
    var nombre: String {
        switch self {
        case .mastografia: "Mastografía"
        case .ultrasonido: "Ultrasonido"
        case .papanicolaou: "Papanicolaou"
        case .exploracion: "Exploración"
        }
    }
}

enum Resultado: String, CaseIterable, Codable, Sendable {
    case pendiente, normal, anormal
}

@Model
final class Paciente {
    @Attribute(.unique) var id: String
    var folio: String
    var nombre: String
    var apellidoPaterno: String
    var apellidoMaterno: String?
    var nacimiento: String?          // "YYYY-MM-DD" si se sabe
    var edad: Int?                   // si solo sabe la edad
    var comunidad: String
    var municipio: String?
    var consentimiento: Date         // cuándo firmó
    var consentimientoFirmado: Data? // trazo de la firma (PencilKit), solo en el teléfono
    var creadaPor: String
    var creada: Date
    var fusionadaEn: String?

    init(id: String = UUID().uuidString, folio: String = Paciente.nuevoFolio(), nombre: String, apellidoPaterno: String,
         apellidoMaterno: String? = nil, nacimiento: String? = nil, edad: Int? = nil, comunidad: String, municipio: String? = nil,
         consentimiento: Date = .now, consentimientoFirmado: Data? = nil, creadaPor: String, creada: Date = .now) {
        self.id = id; self.folio = folio; self.nombre = nombre; self.apellidoPaterno = apellidoPaterno
        self.apellidoMaterno = apellidoMaterno; self.nacimiento = nacimiento; self.edad = edad
        self.comunidad = comunidad; self.municipio = municipio; self.consentimiento = consentimiento
        self.consentimientoFirmado = consentimientoFirmado; self.creadaPor = creadaPor; self.creada = creada
    }

    var nombreCompleto: String { [nombre, apellidoPaterno, apellidoMaterno].compactMap { $0 }.joined(separator: " ") }

    /// Folio corto legible que se genera sin señal: ER-XXXXXX (sin 0/O/1/I para no confundir al dictarlo).
    static func nuevoFolio() -> String {
        let letras = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return "ER-" + String((0..<6).map { _ in letras.randomElement()! })
    }
}

@Model
final class Estudio {
    @Attribute(.unique) var id: String
    var pacienteId: String
    var tipoRaw: String
    var fecha: Date
    var resultadoRaw: String
    var nota: String?
    var registradoPor: String

    var tipo: TipoEstudio { get { TipoEstudio(rawValue: tipoRaw) ?? .exploracion } set { tipoRaw = newValue.rawValue } }
    var resultado: Resultado { get { Resultado(rawValue: resultadoRaw) ?? .pendiente } set { resultadoRaw = newValue.rawValue } }

    init(id: String = UUID().uuidString, pacienteId: String, tipo: TipoEstudio, fecha: Date = .now,
         resultado: Resultado = .pendiente, nota: String? = nil, registradoPor: String) {
        self.id = id; self.pacienteId = pacienteId; self.tipoRaw = tipo.rawValue; self.fecha = fecha
        self.resultadoRaw = resultado.rawValue; self.nota = nota; self.registradoPor = registradoPor
    }
}

/// Cola de lo que falta mandar al servidor. Cada evento tiene una llave única:
/// si el envío se corta y se repite, el servidor (Valkey SET NX) no lo duplica.
@Model
final class EventoPendiente {
    @Attribute(.unique) var llave: String
    var tipo: String        // "alta" | "estudio"
    var payload: Data       // JSON del DTO
    var creado: Date

    init(llave: String = UUID().uuidString, tipo: String, payload: Data, creado: Date = .now) {
        self.llave = llave; self.tipo = tipo; self.payload = payload; self.creado = creado
    }
}

// Entradas que la UI arma antes de guardar.
struct NuevaPaciente: Sendable, Hashable {
    var nombre: String
    var apellidoPaterno: String
    var apellidoMaterno: String?
    var nacimiento: String?
    var edad: Int?
    var comunidad: String
    var municipio: String?
}

struct NuevoEstudio: Sendable, Hashable {
    var tipo: TipoEstudio
    var fecha: Date = .now
    var resultado: Resultado = .pendiente
    var nota: String?
}

enum Esquema {
    static let modelos: [any PersistentModel.Type] = [Paciente.self, Estudio.self, EventoPendiente.self]
}
