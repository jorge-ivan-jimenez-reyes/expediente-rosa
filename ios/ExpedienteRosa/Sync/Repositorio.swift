import Foundation
import SwiftData

/// Escrituras locales. Cada alta o estudio se guarda junto con su evento pendiente
/// en el mismo `save()`: o quedan los dos o ninguno.
@MainActor
struct Repositorio {
    enum Falla: LocalizedError, Equatable {
        case sinFirma, faltaNombre, faltaComunidad, nacimientoInvalido, edadInvalida, notaLarga
        var errorDescription: String? {
            switch self {
            case .sinFirma: "Sin firma de consentimiento no se puede guardar."
            case .faltaNombre: "Faltan el nombre o el apellido paterno."
            case .faltaComunidad: "Falta la comunidad."
            case .nacimientoInvalido: "La fecha de nacimiento debe ser AAAA-MM-DD."
            case .edadInvalida: "La edad debe estar entre 0 y 120."
            case .notaLarga: "La nota no puede pasar de 500 caracteres."
            }
        }
    }

    let contexto: ModelContext
    /// Quién registra (va a `creadaPor` / `registradoPor`).
    var autor: String
    /// Se llama después de cada escritura (el Sincronizador lo usa para contar pendientes).
    var alCambiar: (@MainActor () -> Void)?

    init(contexto: ModelContext, autor: String = Config.dispositivo, alCambiar: (@MainActor () -> Void)? = nil) {
        self.contexto = contexto; self.autor = autor; self.alCambiar = alCambiar
    }

    /// Guarda la paciente y encola el evento "alta". Valida lo mismo que la API para que la cola nunca se atore.
    @discardableResult
    func alta(_ p: NuevaPaciente, firma: Data) throws -> Paciente {
        guard !firma.isEmpty else { throw Falla.sinFirma }
        let nombre = p.nombre.limpio, paterno = p.apellidoPaterno.limpio, comunidad = p.comunidad.limpio
        guard !nombre.isEmpty, !paterno.isEmpty else { throw Falla.faltaNombre }
        guard !comunidad.isEmpty else { throw Falla.faltaComunidad }
        let nacimiento = p.nacimiento?.limpio.nilSiVacio
        if let nacimiento, nacimiento.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) == nil { throw Falla.nacimientoInvalido }
        if let edad = p.edad, !(0...120).contains(edad) { throw Falla.edadInvalida }

        let paciente = Paciente(nombre: nombre, apellidoPaterno: paterno,
                                apellidoMaterno: p.apellidoMaterno?.limpio.nilSiVacio,
                                nacimiento: nacimiento, edad: p.edad, comunidad: comunidad,
                                municipio: p.municipio?.limpio.nilSiVacio,
                                consentimiento: .now, consentimientoFirmado: firma, creadaPor: autor)
        let payload = try JSONEncoder().encode(paciente.dto)
        try guardar(paciente, EventoPendiente(tipo: "alta", payload: payload))
        return paciente
    }

    /// Guarda el estudio y encola el evento "estudio".
    @discardableResult
    func agregarEstudio(_ e: NuevoEstudio, a p: Paciente) throws -> Estudio {
        let nota = e.nota?.limpio.nilSiVacio
        if let nota, nota.count > 500 { throw Falla.notaLarga }
        let estudio = Estudio(pacienteId: p.id, tipo: e.tipo, fecha: e.fecha, resultado: e.resultado,
                              nota: nota, registradoPor: autor)
        let payload = try JSONEncoder().encode(estudio.dto)
        try guardar(estudio, EventoPendiente(tipo: "estudio", payload: payload))
        return estudio
    }

    /// Estudios de la paciente, el más reciente primero.
    func historial(de p: Paciente) -> [Estudio] {
        let id = p.id
        let d = FetchDescriptor<Estudio>(predicate: #Predicate { $0.pacienteId == id },
                                         sortBy: [SortDescriptor(\.fecha, order: .reverse)])
        return (try? contexto.fetch(d)) ?? []
    }

    /// Pacientes en el teléfono (sin las fusionadas), para pasarlas a `Coincidencias.buscar`.
    func pacientes(comunidad: String? = nil) -> [Paciente] {
        let d = FetchDescriptor<Paciente>(predicate: #Predicate { $0.fusionadaEn == nil },
                                          sortBy: [SortDescriptor(\.apellidoPaterno), SortDescriptor(\.nombre)])
        let todas = (try? contexto.fetch(d)) ?? []
        guard let c = comunidad?.limpio.lowercased(), !c.isEmpty else { return todas }
        return todas.filter { $0.comunidad.lowercased() == c }
    }

    private func guardar(_ registro: any PersistentModel, _ evento: EventoPendiente) throws {
        contexto.insert(registro)
        contexto.insert(evento)
        do {
            try contexto.save()
        } catch {
            contexto.delete(evento)
            contexto.delete(registro)
            throw error
        }
        alCambiar?()
    }
}

extension String {
    var limpio: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var nilSiVacio: String? { isEmpty ? nil : self }
}
