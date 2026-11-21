import Foundation
import SwiftData

/// Escrituras locales. Cada alta o estudio se guarda junto con su evento pendiente
/// en el mismo `save()`: o quedan los dos o ninguno.
@MainActor
struct Repositorio {
    enum Falla: LocalizedError, Equatable {
        case sinFirma, faltaNombre, faltaComunidad, nacimientoInvalido, edadInvalida, notaLarga
        case sinCambios, campoNoEditable(String), campoVacio(String), motivoLargo, clasificacionLarga
        var errorDescription: String? {
            switch self {
            case .sinFirma: "Sin firma de consentimiento no se puede guardar."
            case .faltaNombre: "Faltan el nombre o el apellido paterno."
            case .faltaComunidad: "Falta la comunidad."
            case .nacimientoInvalido: "La fecha de nacimiento debe ser AAAA-MM-DD."
            case .edadInvalida: "La edad debe estar entre 0 y 120."
            case .notaLarga: "La nota no puede pasar de 500 caracteres."
            case .sinCambios: "No hay cambios que guardar."
            case .campoNoEditable(let c): "El campo «\(c)» no se puede editar."
            case .campoVacio(let c): "El campo «\(c)» no puede quedar vacío."
            case .motivoLargo: "El motivo no puede pasar de 200 caracteres."
            case .clasificacionLarga: "La clasificación no puede pasar de 100 caracteres."
            }
        }
    }

    let contexto: ModelContext
    /// Quién registra (va a `creadaPor` / `registradoPor`).
    var autor: String
    /// Se llama después de cada escritura (el Sincronizador lo usa para contar pendientes).
    var alCambiar: (@MainActor () -> Void)?
    /// Jornada en curso, elegida en «Antes de salir» (AppStorage "comunidad" y "estado"). Va en cada visita nueva.
    var comunidadJornada: String?
    var estadoJornada: String?

    init(contexto: ModelContext, autor: String = Config.dispositivo, alCambiar: (@MainActor () -> Void)? = nil,
         comunidadJornada: String? = UserDefaults.standard.string(forKey: "comunidad"),
         estadoJornada: String? = UserDefaults.standard.string(forKey: "estado")) {
        self.contexto = contexto; self.autor = autor; self.alCambiar = alCambiar
        self.comunidadJornada = comunidadJornada?.limpio.nilSiVacio
        self.estadoJornada = estadoJornada?.limpio.nilSiVacio
    }

    /// «San Martín Peras · noviembre 2026»: comunidad de la jornada (o la de la paciente) y el mes.
    nonisolated static func nombreJornada(comunidad: String, fecha: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_MX")
        f.dateFormat = "LLLL yyyy"
        return "\(comunidad) · \(f.string(from: fecha))"
    }

    /// Visita nueva con la entidad y el nombre de la jornada en curso.
    private func nuevaVisita(_ p: Paciente, fecha: Date, motivo: String?) -> Visita {
        Visita(pacienteId: p.id, fecha: fecha, comunidad: p.comunidad, motivo: motivo, registradaPor: autor,
               estado: estadoJornada,
               jornada: Self.nombreJornada(comunidad: comunidadJornada ?? p.comunidad, fecha: fecha))
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

    /// Guarda el estudio y encola el evento "estudio". Lo liga a la visita de ese día de la paciente
    /// (normalmente hoy); si no hay, la crea y encola también el evento "visita", todo en el mismo `save()`.
    @discardableResult
    func agregarEstudio(_ e: NuevoEstudio, a p: Paciente) throws -> Estudio {
        let nota = e.nota?.limpio.nilSiVacio
        if let nota, nota.count > 500 { throw Falla.notaLarga }
        let clasificacion = e.clasificacion?.limpio.nilSiVacio
        if let clasificacion, clasificacion.count > 100 { throw Falla.clasificacionLarga }

        var registros: [any PersistentModel] = []
        var eventos: [EventoPendiente] = []
        let delDia: Visita
        if let ya = visita(de: p, dia: e.fecha) {
            delDia = ya
        } else {
            delDia = nuevaVisita(p, fecha: e.fecha, motivo: "jornada de tamizaje")
            registros.append(delDia)
            eventos.append(EventoPendiente(tipo: "visita", payload: try JSONEncoder().encode(delDia.dto)))
        }
        let etapa = Etapa.alGuardar(e.tipo, e.resultado)
        let estudio = Estudio(pacienteId: p.id, tipo: e.tipo, fecha: e.fecha, resultado: e.resultado,
                              nota: nota, registradoPor: autor, visitaId: delDia.id,
                              clasificacion: clasificacion, conducta: e.conducta, etapa: etapa,
                              interpretadoPor: etapa == .interpretado ? autor : nil,
                              interpretadoEn: etapa == .interpretado ? .now : nil)
        registros.append(estudio)
        // La visita va antes en la cola (se ordena por `creado`).
        eventos.append(EventoPendiente(tipo: "estudio", payload: try JSONEncoder().encode(estudio.dto),
                                       creado: (eventos.first?.creado ?? .now).addingTimeInterval(0.001)))
        try guardar(registros, eventos)
        return estudio
    }

    /// Registra que la paciente vino hoy y encola el evento "visita". Si ya hay visita de hoy, la devuelve sin duplicar.
    @discardableResult
    func registrarVisita(_ p: Paciente, motivo: String? = nil) throws -> Visita {
        let motivo = motivo?.limpio.nilSiVacio
        if let motivo, motivo.count > 200 { throw Falla.motivoLargo }
        if let ya = visita(de: p, dia: .now) { return ya }
        let v = nuevaVisita(p, fecha: .now, motivo: motivo)
        try guardar([v], [EventoPendiente(tipo: "visita", payload: try JSONEncoder().encode(v.dto))])
        return v
    }

    /// Campos que la API deja corregir después del alta (`CamposEditables` en api/src/index.ts).
    nonisolated static let camposEditables: Set<String> = ["nombre", "apellidoPaterno", "apellidoMaterno", "nacimiento", "edad",
                                               "comunidad", "municipio", "entidadNacimiento", "idEira"]

    /// Corrige datos de la paciente: aplica local y encola "actualizacion" con `versionBase = p.version`.
    /// Manda solo los campos que se pasan (los cambiados). Si en el servidor alguien más ya cambió a la
    /// paciente, no se aplica allá y queda en /conflictos para la coordinadora.
    /// La versión local sube 1 para que una segunda corrección sin señal salga con la base correcta.
    func actualizar(_ p: Paciente, campos: [String: ValorCampo]) throws {
        var limpios: [String: ValorCampo] = [:]
        for (k, v) in campos {
            guard Self.camposEditables.contains(k) else { throw Falla.campoNoEditable(k) }
            switch (k, v) {
            case ("edad", .numero(let n)):
                guard (0...120).contains(n) else { throw Falla.edadInvalida }
                limpios[k] = v
            case ("edad", .texto(let t)):
                guard let n = Int(t.limpio), (0...120).contains(n) else { throw Falla.edadInvalida }
                limpios[k] = .numero(n)
            case (_, .numero(let n)):
                limpios[k] = .texto(String(n))
            case (_, .texto(let t)):
                let t = t.limpio
                guard !t.isEmpty else { throw Falla.campoVacio(k) }   // la API no deja borrar un campo
                if k == "nacimiento", t.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) == nil { throw Falla.nacimientoInvalido }
                limpios[k] = .texto(t)
            }
        }
        guard !limpios.isEmpty else { throw Falla.sinCambios }

        let a = ActualizacionDTO(pacienteId: p.id, campos: limpios, versionBase: p.version, autor: autor)
        let evento = EventoPendiente(tipo: "actualizacion", payload: try JSONEncoder().encode(a))
        let antes = p.instantanea
        for (k, v) in limpios { p.poner(k, v) }
        p.version += 1
        contexto.insert(evento)
        do {
            try contexto.save()
        } catch {
            contexto.delete(evento)
            p.restaurar(antes)
            throw error
        }
        alCambiar?()
    }

    /// Visitas de la paciente, la más reciente primero.
    func visitas(de p: Paciente) -> [Visita] {
        let id = p.id
        let d = FetchDescriptor<Visita>(predicate: #Predicate { $0.pacienteId == id },
                                        sortBy: [SortDescriptor(\.fecha, order: .reverse)])
        return (try? contexto.fetch(d)) ?? []
    }

    /// Visita de la paciente en el mismo día (calendario del teléfono).
    func visita(de p: Paciente, dia: Date) -> Visita? {
        let cal = Calendar.current
        let inicio = cal.startOfDay(for: dia)
        guard let fin = cal.date(byAdding: .day, value: 1, to: inicio) else { return nil }
        let id = p.id
        let d = FetchDescriptor<Visita>(predicate: #Predicate { $0.pacienteId == id && $0.fecha >= inicio && $0.fecha < fin },
                                        sortBy: [SortDescriptor(\.fecha)])
        return try? contexto.fetch(d).first
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
        try guardar([registro], [evento])
    }

    private func guardar(_ registros: [any PersistentModel], _ eventos: [EventoPendiente]) throws {
        for r in registros { contexto.insert(r) }
        for e in eventos { contexto.insert(e) }
        do {
            try contexto.save()
        } catch {
            for e in eventos { contexto.delete(e) }
            for r in registros { contexto.delete(r) }
            throw error
        }
        alCambiar?()
    }
}

extension String {
    var limpio: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var nilSiVacio: String? { isEmpty ? nil : self }
}

/// Leer y escribir los campos editables por nombre (los mismos de la API).
extension Paciente {
    typealias Instantanea = [String: ValorCampo?]

    func valor(_ campo: String) -> ValorCampo? {
        switch campo {
        case "nombre": .texto(nombre)
        case "apellidoPaterno": .texto(apellidoPaterno)
        case "apellidoMaterno": apellidoMaterno.map(ValorCampo.texto)
        case "nacimiento": nacimiento.map(ValorCampo.texto)
        case "edad": edad.map(ValorCampo.numero)
        case "comunidad": .texto(comunidad)
        case "municipio": municipio.map(ValorCampo.texto)
        case "entidadNacimiento": entidadNacimiento.map(ValorCampo.texto)
        case "idEira": idEira.map(ValorCampo.texto)
        default: nil
        }
    }

    func poner(_ campo: String, _ v: ValorCampo?) {
        let t = v?.description
        switch campo {
        case "nombre": if let t { nombre = t }
        case "apellidoPaterno": if let t { apellidoPaterno = t }
        case "apellidoMaterno": apellidoMaterno = t
        case "nacimiento": nacimiento = t
        case "edad": if case .numero(let n)? = v { edad = n } else { edad = t.flatMap { Int($0) } }
        case "comunidad": if let t { comunidad = t }
        case "municipio": municipio = t
        case "entidadNacimiento": entidadNacimiento = t
        case "idEira": idEira = t
        default: break
        }
    }

    var instantanea: Instantanea {
        var d: Instantanea = ["version": .numero(version)]
        for c in Repositorio.camposEditables { d[c] = .some(valor(c)) }
        return d
    }

    func restaurar(_ i: Instantanea) {
        for c in Repositorio.camposEditables { poner(c, i[c] ?? nil) }
        if case .numero(let v)?? = i["version"] { version = v }
    }
}
