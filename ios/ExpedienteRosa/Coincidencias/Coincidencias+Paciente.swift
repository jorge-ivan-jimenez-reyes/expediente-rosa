import Foundation

// Lo que usa la UI: buscar a una paciente que regresa entre las que ya están en el teléfono.
// Hace lo mismo que buscarCandidatas() en api/src/index.ts: bloque → comparar → umbral → orden.

/// Una posible coincidencia para mostrar en Buscar.
struct Candidata: Identifiable {
    let paciente: Paciente
    let puntaje: Double
    let razones: [String]
    var id: String { paciente.id }
}

extension DatosPaciente {
    init(_ p: NuevaPaciente) {
        self.init(nombre: p.nombre, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno,
                  nacimiento: p.nacimiento, edad: p.edad, comunidad: p.comunidad)
    }
    init(_ p: Paciente) {
        self.init(nombre: p.nombre, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno,
                  nacimiento: p.nacimiento, edad: p.edad, comunidad: p.comunidad)
    }
}

extension Coincidencias {
    /// Candidatas con puntaje ≥ `umbral` (0.82 por omisión), de mayor a menor.
    /// Solo compara contra pacientes que comparten alguna llave de bloque y que no fueron fusionadas en otra.
    static func buscar(_ q: NuevaPaciente, en pacientes: [Paciente], umbral: Double = UMBRAL_POSIBLE) -> [Candidata] {
        let datos = DatosPaciente(q)
        let llaves = Set(llavesBloque(datos))
        return pacientes
            .filter { $0.fusionadaEn == nil }
            .compactMap { p -> Candidata? in
                let otra = DatosPaciente(p)
                guard !llaves.isDisjoint(with: llavesBloque(otra)) else { return nil }
                let r = comparar(datos, otra)
                return r.puntaje >= umbral ? Candidata(paciente: p, puntaje: r.puntaje, razones: r.razones) : nil
            }
            .sorted { $0.puntaje > $1.puntaje }
    }
}
