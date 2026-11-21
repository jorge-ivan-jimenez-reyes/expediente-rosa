import Foundation
import FoundationModels

// Tipos que el modelo del teléfono llena (Foundation Models, guided generation).
// Son internos de este carril: la UI recibe NuevaPaciente / NuevoEstudio (Modelo/).

@Generable
enum TipoGenerado {
    case mastografia, ultrasonido, papanicolaou, exploracion

    var tipo: TipoEstudio {
        switch self {
        case .mastografia: .mastografia
        case .ultrasonido: .ultrasonido
        case .papanicolaou: .papanicolaou
        case .exploracion: .exploracion
        }
    }
}

@Generable
enum ResultadoGenerado {
    case pendiente, normal, anormal

    var resultado: Resultado {
        switch self {
        case .pendiente: .pendiente
        case .normal: .normal
        case .anormal: .anormal
        }
    }
}

@Generable(description: "La paciente anotada en una hoja de registro de tamizaje")
struct PacienteGenerada {
    // El orden importa: el modelo genera las propiedades en este orden. Copiar primero el renglón
    // completo del nombre evita que corte nombres compuestos (María Guadalupe) o pierda el materno.
    @Guide(description: "El nombre completo copiado tal cual de la hoja, con todos sus nombres y apellidos")
    var nombreTalCual: String
    @Guide(description: "Todos los nombres de pila, incluidos los compuestos como 'Ana Luisa' o 'Petra Ma.'")
    var nombre: String
    @Guide(description: "Apellido paterno: el primer apellido, que va después de los nombres de pila")
    var apellidoPaterno: String
    @Guide(description: "Apellido materno: el segundo apellido, la última palabra si hay dos apellidos; nulo si solo hay uno")
    var apellidoMaterno: String?
    @Guide(description: "Fecha de nacimiento copiada tal como está escrita, día/mes/año (en la hoja puede decir 'F. nac.'); nulo si no aparece")
    var nacimiento: String?
    @Guide(description: "Edad en años si la hoja la escribe (por ejemplo 'Edad: 52'); nulo si no aparece")
    var edad: Int?
    @Guide(description: "Comunidad o localidad donde vive")
    var comunidad: String
    @Guide(description: "Municipio (en la hoja puede decir 'Mpio.'), sin la abreviatura del estado; nulo si no aparece")
    var municipio: String?
}

@Generable(description: "Un estudio de tamizaje anotado en la hoja")
struct EstudioGenerado {
    @Guide(description: "Tipo de estudio: mastografia, ultrasonido (de mama), papanicolaou (citología) o exploracion (exploración clínica de mama)")
    var tipo: TipoGenerado
    @Guide(description: "Fecha del estudio copiada tal como está escrita en su renglón, día/mes/año; nulo si no aparece")
    var fecha: String?
    @Guide(description: "Resultado: normal, anormal (sospechoso, BI-RADS 4 o 5, lesión, positivo) o pendiente si no hay resultado")
    var resultado: ResultadoGenerado
    @Guide(description: "Lo escrito junto a este estudio en la hoja (BI-RADS, hallazgo, indicación de regreso); nunca firmas ni nombres del personal; nulo si no hay")
    var nota: String?
}

@Generable(description: "Contenido de una hoja de registro en papel de una jornada de tamizaje")
struct HojaGenerada {
    @Guide(description: "La paciente de la hoja")
    var paciente: PacienteGenerada
    @Guide(description: "Estudios anotados en la hoja, en el orden en que aparecen", .maximumCount(12))
    var estudios: [EstudioGenerado]
}

@Generable(description: "Un estudio dictado por el médico")
struct EstudioDictado {
    @Guide(description: "Tipo de estudio: mastografia, ultrasonido, papanicolaou o exploracion")
    var tipo: TipoGenerado
    @Guide(description: "Resultado: normal, anormal o pendiente si todavía no hay resultado")
    var resultado: ResultadoGenerado
    @Guide(description: "El resto de lo dictado, breve (por ejemplo 'regresa en un año'); nulo si no dijo nada más")
    var nota: String?
}

// MARK: - Conversión a los tipos de la app

/// Limpieza de lo que devuelve el modelo (nombre propio para no chocar con otros carriles).
enum TextoIA {
    static func limpio(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
    static func opcional(_ s: String?) -> String? {
        guard let s else { return nil }
        let t = limpio(s)
        return t.isEmpty || ["nulo", "null", "n/a", "-", "ninguno", "ninguna"].contains(t.lowercased()) ? nil : t
    }
}

/// Fechas de las hojas: el modelo las da como AAAA-MM-DD, pero a veces copia "15/03/2024" tal cual.
enum FechasIA {
    static func componentes(_ texto: String) -> (Int, Int, Int)? {
        let partes = TextoIA.limpio(texto).split(whereSeparator: { "-/. ".contains($0) }).compactMap { Int($0) }
        guard partes.count == 3 else { return nil }
        let (a, m, d) = partes[0] > 31 ? (partes[0], partes[1], partes[2]) : (partes[2], partes[1], partes[0])
        guard (1900...2100).contains(a), (1...12).contains(m), (1...31).contains(d) else { return nil }
        return (a, m, d)
    }

    /// "AAAA-MM-DD" o nil.
    static func normalizar(_ texto: String) -> String? {
        guard let (a, m, d) = componentes(texto) else { return nil }
        return String(format: "%04d-%02d-%02d", a, m, d)
    }

    static func fecha(_ texto: String) -> Date? {
        guard let (a, m, d) = componentes(texto) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        return cal.date(from: DateComponents(year: a, month: m, day: d, hour: 12))
    }

    static func texto(_ fecha: Date) -> String {
        let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: fecha)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
