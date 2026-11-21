import Foundation
import Network
import Observation
import SwiftData

/// Estado de señal y envío de la cola de eventos a `POST /api/sync`.
///
/// Uso en la app:
/// ```swift
/// @State var sync = Sincronizador(contexto: modelContext)
/// try sync.repositorio.alta(nueva, firma: datosFirma)
/// let r = try await sync.sincronizar()
/// ```
@MainActor
@Observable
final class Sincronizador {
    static let tamanoLote = 100

    /// Hay red y no se está simulando «sin señal».
    var enLinea: Bool { redDisponible && !simularSinSenal }
    /// Eventos guardados en el teléfono que el servidor aún no confirma.
    private(set) var pendientes: Int = 0
    private(set) var ultimaSync: Date?
    private(set) var sincronizando = false
    /// Último error de sincronización, para mostrarlo en Inicio. nil si la última salió bien.
    private(set) var ultimoError: String?
    /// Eventos que el servidor rechazó (400) en la última sincronización; se quedan guardados.
    private(set) var rechazados: Int = 0

    /// Para la demo: corta la «señal» sin tocar el modo avión del teléfono.
    var simularSinSenal = false {
        didSet { if oldValue && !simularSinSenal { senalVolvio() } }
    }
    /// Si es true, al volver la señal se sincroniza solo.
    var sincronizarAlVolver = true
    /// Si es true, al volver la señal se bajan solas las jornadas programadas.
    var prepararAlVolver = true

    /// Jornadas que coordinación programó (la última lista que bajó el teléfono), por fecha.
    private(set) var jornadas: [JornadaDTO] = []
    /// Por id de jornada: cuándo se bajaron sus pacientes y cuántas.
    private(set) var preparacion: [String: PreparacionJornada] = [:]
    private(set) var preparandoProximas = false
    /// Último error al bajar las jornadas programadas. nil si salió bien.
    private(set) var errorJornadas: String?
    /// Las de hoy en adelante. Vacío también si la API no tiene `/jornadas`.
    var proximasJornadas: [JornadaDTO] {
        let hoy = Calendar.current.startOfDay(for: .now)
        return jornadas.filter { ($0.dia ?? hoy) >= hoy }
    }
    /// El que usa la app en primer plano; la tarea en segundo plano lo reutiliza si existe.
    static weak var principal: Sincronizador?
    static let llaveJornadas = "jornadas_programadas"
    @ObservationIgnored private var persistirJornadas = true

    var api: ClienteAPI
    let contexto: ModelContext
    var autor: String

    private var redDisponible = true
    @ObservationIgnored private let monitor: NWPathMonitor?

    init(contexto: ModelContext, api: ClienteAPI = ClienteAPI(), autor: String = Config.dispositivo, vigilarRed: Bool = true) {
        self.contexto = contexto
        self.api = api
        self.autor = autor
        self.monitor = vigilarRed ? NWPathMonitor() : nil
        actualizarPendientes()
        cargarJornadas()
        monitor?.pathUpdateHandler = { [weak self] path in
            let hay = path.status == .satisfied
            Task { @MainActor in self?.cambioDeRed(hay) }
        }
        monitor?.start(queue: DispatchQueue(label: "org.eira.expedienterosa.red"))
    }

    deinit { monitor?.cancel() }

    /// Repositorio que avisa al Sincronizador en cada escritura (para que `pendientes` se mueva solo).
    var repositorio: Repositorio {
        Repositorio(contexto: contexto, autor: autor, alCambiar: { [weak self] in self?.actualizarPendientes() })
    }

    func actualizarPendientes() {
        pendientes = (try? contexto.fetchCount(FetchDescriptor<EventoPendiente>())) ?? 0
    }

    // MARK: - Enviar la cola

    /// Manda la cola en lotes de 100, del más viejo al más nuevo. Solo borra lo que el servidor confirmó
    /// (aplicado o repetido). Si se corta a la mitad, lo no confirmado se queda para el siguiente intento,
    /// y la llave de cada evento evita que el servidor lo aplique dos veces.
    @discardableResult
    func sincronizar() async throws -> ResultadoSync {
        guard enLinea else { throw fallo(.sinSenal) }
        guard !sincronizando else { throw ErrorSync.enCurso }
        sincronizando = true
        defer { sincronizando = false; actualizarPendientes() }

        var total = ResultadoSync(aplicados: 0, repetidos: 0, posiblesDuplicados: [])
        var saltar: [String] = []   // llaves rechazadas en esta vuelta: se conservan pero no se reintentan ahora
        do {
            while true {
                let lote = try siguienteLote(sin: saltar)
                if lote.isEmpty { break }
                var listos: [(EventoPendiente, EventoDTO)] = []
                for ev in lote {
                    if let dto = Self.dto(de: ev) { listos.append((ev, dto)) } else { saltar.append(ev.llave) }
                }
                if listos.isEmpty { continue }
                do {
                    let r = try await enviar(listos.map(\.1))
                    guard r.aplicados + r.repetidos == listos.count else { throw ErrorSync.respuestaIncompleta }
                    try confirmar(listos.map(\.0))
                    sumar(r, a: &total)
                } catch ErrorSync.rechazado(400, _) {
                    // Algún evento no pasó la validación del servidor: se mandan uno por uno para no atorar a los demás.
                    for (ev, dto) in listos {
                        do {
                            let r = try await enviar([dto])
                            try confirmar([ev])
                            sumar(r, a: &total)
                        } catch ErrorSync.rechazado(400, _) {
                            saltar.append(ev.llave)
                        }
                    }
                }
            }
        } catch {
            ultimoError = error.localizedDescription
            throw error
        }
        rechazados = saltar.count
        ultimaSync = .now
        ultimoError = saltar.isEmpty ? nil : "\(saltar.count) registro(s) rechazados por el servidor; siguen guardados."
        return total
    }

    // MARK: - Preparar jornada

    /// Baja las pacientes de la comunidad (con sus estudios y visitas) a SwiftData. No duplica: si ya existen, las actualiza.
    /// Devuelve cuántas pacientes trajo el servidor.
    @discardableResult
    func prepararJornada(comunidad: String) async throws -> Int {
        guard enLinea else { throw fallo(.sinSenal) }
        do {
            let n = try await bajar(comunidad: comunidad)
            ultimoError = nil
            return n
        } catch {
            ultimoError = error.localizedDescription
            throw error
        }
    }

    private func bajar(comunidad: String) async throws -> Int {
        let lista = try await api.pacientes(comunidad: comunidad)
        try importar(lista)
        return lista.count
    }

    // MARK: - Jornadas programadas

    /// Pide a la API las jornadas de los próximos `dias` y baja las pacientes de cada comunidad
    /// (una sola vez por comunidad). Guarda la lista y cuándo se preparó cada una en UserDefaults.
    /// No lanza: sin señal no hace nada; si la API no tiene `/jornadas` (404) deja la lista vacía.
    /// Devuelve true si todas quedaron listas.
    @discardableResult
    func prepararProximas(dias: Int = 30) async -> Bool {
        guard enLinea, !preparandoProximas else { return false }
        preparandoProximas = true
        defer { preparandoProximas = false }
        let lista: [JornadaDTO]
        do {
            lista = try await api.jornadas(dias: dias)
        } catch ErrorSync.rechazado(404, _) {
            jornadas = []; preparacion = [:]; errorJornadas = nil
            guardarJornadas()
            return false
        } catch {
            errorJornadas = error.localizedDescription
            return false
        }
        jornadas = lista.sorted { ($0.fecha, $0.comunidad) < ($1.fecha, $1.comunidad) }
        let ids = Set(lista.map(\.id))
        preparacion = preparacion.filter { ids.contains($0.key) }
        guardarJornadas()

        var porComunidad: [String: Int] = [:]
        var fallo: Error?
        for j in jornadas {
            if Task.isCancelled { break }
            do {
                let llave = j.comunidad.trimmingCharacters(in: .whitespaces).lowercased()
                let n: Int
                if let ya = porComunidad[llave] { n = ya } else {
                    n = try await bajar(comunidad: j.comunidad)
                    porComunidad[llave] = n
                }
                preparacion[j.id] = PreparacionJornada(en: .now, pacientes: n)
                guardarJornadas()
            } catch {
                fallo = error
            }
        }
        errorJornadas = fallo?.localizedDescription
        return fallo == nil && !Task.isCancelled
    }

    /// Lee la lista guardada (sirve sin señal: la brigada ve a dónde va aunque no haya red).
    func cargarJornadas() {
        guard let datos = UserDefaults.standard.data(forKey: Self.llaveJornadas),
              let g = try? JSONDecoder().decode(JornadasGuardadas.self, from: datos) else { return }
        jornadas = g.lista
        preparacion = g.preparacion
    }

    private func guardarJornadas() {
        guard persistirJornadas,
              let datos = try? JSONEncoder().encode(JornadasGuardadas(lista: jornadas, preparacion: preparacion)) else { return }
        UserDefaults.standard.set(datos, forKey: Self.llaveJornadas)
    }

    private struct JornadasGuardadas: Codable {
        var lista: [JornadaDTO]
        var preparacion: [String: PreparacionJornada]
    }

    #if DEBUG
    /// Modo captura: pone jornadas ficticias sin tocar lo guardado en el teléfono.
    func usarJornadasDemo(_ lista: [JornadaDTO], preparacion: [String: PreparacionJornada]) {
        persistirJornadas = false
        prepararAlVolver = false
        jornadas = lista
        self.preparacion = preparacion
    }
    #endif

    /// Mete al teléfono las pacientes del servidor. Público para poder probarlo sin red.
    func importar(_ lista: [PacienteDTO]) throws {
        let ids = lista.map(\.id)
        let existentes = try contexto.fetch(FetchDescriptor<Paciente>(predicate: #Predicate { ids.contains($0.id) }))
        var porId = Dictionary(existentes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        let estudiosDTO = lista.flatMap { $0.estudios ?? [] }
        let idsEstudio = estudiosDTO.map(\.id)
        let estudiosLocales = try contexto.fetch(FetchDescriptor<Estudio>(predicate: #Predicate { idsEstudio.contains($0.id) }))
        var estudioPorId = Dictionary(estudiosLocales.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        let visitasDTO = lista.flatMap { $0.visitas ?? [] }
        let idsVisita = visitasDTO.map(\.id)
        let visitasLocales = try contexto.fetch(FetchDescriptor<Visita>(predicate: #Predicate { idsVisita.contains($0.id) }))
        var visitaPorId = Dictionary(visitasLocales.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        // Pacientes con correcciones sin mandar: sus datos y su versión locales se respetan hasta sincronizar.
        let conCambios = Set(try contexto.fetch(FetchDescriptor<EventoPendiente>(predicate: #Predicate { $0.tipo == "actualizacion" }))
            .compactMap { try? JSONDecoder().decode(ActualizacionDTO.self, from: $0.payload).pacienteId })

        for d in lista {
            let p: Paciente
            if let ya = porId[d.id] {
                p = ya
            } else {
                p = Paciente(id: d.id, nombre: d.nombre, apellidoPaterno: d.apellidoPaterno, comunidad: d.comunidad, creadaPor: d.creadaPor)
                contexto.insert(p)
                porId[d.id] = p
            }
            // Lo que manda el servidor gana; la firma (solo en el teléfono) no se toca.
            p.folio = d.folio
            if !conCambios.contains(d.id) {
                p.nombre = d.nombre
                p.apellidoPaterno = d.apellidoPaterno
                p.apellidoMaterno = d.apellidoMaterno
                p.nacimiento = d.nacimiento
                p.edad = d.edad
                p.comunidad = d.comunidad
                p.municipio = d.municipio
                p.entidadNacimiento = d.entidadNacimiento
                p.idEira = d.idEira
                p.version = d.version ?? 1
            }
            p.creadaPor = d.creadaPor
            if let f = Fechas.leer(d.consentimiento) { p.consentimiento = f }
            if let f = Fechas.leer(d.creada) { p.creada = f }

            for e in d.estudios ?? [] {
                let tipo = TipoEstudio(rawValue: e.tipo) ?? .exploracion
                let resultado = Resultado(rawValue: e.resultado) ?? .pendiente
                let fecha = Fechas.leer(e.fecha) ?? .now
                let conducta = e.conducta.flatMap(Conducta.init(rawValue:))
                let etapa = e.etapa.flatMap(Etapa.init(rawValue:))
                if let ya = estudioPorId[e.id] {
                    ya.pacienteId = e.pacienteId; ya.tipo = tipo; ya.resultado = resultado
                    ya.fecha = fecha; ya.nota = e.nota; ya.registradoPor = e.registradoPor
                    ya.visitaId = e.visitaId; ya.clasificacion = e.clasificacion; ya.conducta = conducta
                    // Etapa: la del servidor gana si viene (el patólogo la mueve en el panel); si no, se queda la local.
                    if let etapa { ya.etapa = etapa }
                    if let por = e.interpretadoPor { ya.interpretadoPor = por }
                    if let en = Fechas.leer(e.interpretadoEn) { ya.interpretadoEn = en }
                } else {
                    let nuevo = Estudio(id: e.id, pacienteId: e.pacienteId, tipo: tipo, fecha: fecha,
                                        resultado: resultado, nota: e.nota, registradoPor: e.registradoPor,
                                        visitaId: e.visitaId, clasificacion: e.clasificacion, conducta: conducta,
                                        etapa: etapa, interpretadoPor: e.interpretadoPor,
                                        interpretadoEn: Fechas.leer(e.interpretadoEn))
                    contexto.insert(nuevo)
                    estudioPorId[e.id] = nuevo
                }
            }

            for v in d.visitas ?? [] {
                let fecha = Fechas.leer(v.fecha) ?? .now
                if let ya = visitaPorId[v.id] {
                    ya.pacienteId = v.pacienteId; ya.fecha = fecha; ya.comunidad = v.comunidad
                    ya.motivo = v.motivo; ya.registradaPor = v.registradaPor
                    if let estado = v.estado { ya.estado = estado }
                    if let jornada = v.jornada { ya.jornada = jornada }
                } else {
                    let nueva = Visita(id: v.id, pacienteId: v.pacienteId, fecha: fecha, comunidad: v.comunidad,
                                       motivo: v.motivo, registradaPor: v.registradaPor, estado: v.estado, jornada: v.jornada)
                    contexto.insert(nueva)
                    visitaPorId[v.id] = nueva
                }
            }
        }
        try contexto.save()
    }

    // MARK: - Internos

    private func cambioDeRed(_ hay: Bool) {
        let antes = redDisponible
        redDisponible = hay
        if !antes && hay && !simularSinSenal { senalVolvio() }
    }

    private func senalVolvio() {
        actualizarPendientes()
        if prepararAlVolver { Task { await self.prepararProximas() } }
        guard sincronizarAlVolver, pendientes > 0, !sincronizando else { return }
        Task { try? await self.sincronizar() }
    }

    private func fallo(_ e: ErrorSync) -> ErrorSync {
        ultimoError = e.localizedDescription
        return e
    }

    private func siguienteLote(sin saltar: [String]) throws -> [EventoPendiente] {
        var d = FetchDescriptor<EventoPendiente>(predicate: #Predicate { !saltar.contains($0.llave) },
                                                 sortBy: [SortDescriptor(\.creado)])
        d.fetchLimit = Self.tamanoLote
        return try contexto.fetch(d)
    }

    private func enviar(_ eventos: [EventoDTO]) async throws -> ResultadoSync {
        try await api.sincronizar(SyncPeticion(dispositivo: autor, eventos: eventos))
    }

    private func confirmar(_ eventos: [EventoPendiente]) throws {
        for ev in eventos { contexto.delete(ev) }
        try contexto.save()
    }

    private func sumar(_ r: ResultadoSync, a total: inout ResultadoSync) {
        total.aplicados += r.aplicados
        total.repetidos += r.repetidos
        total.posiblesDuplicados += r.posiblesDuplicados
        if let c = r.conflictos, !c.isEmpty { total.conflictos = (total.conflictos ?? []) + c }
    }

    /// Evento guardado → lo que espera la API. nil si el payload está dañado.
    static func dto(de ev: EventoPendiente) -> EventoDTO? {
        let dec = JSONDecoder()
        switch ev.tipo {
        case "alta":
            guard let p = try? dec.decode(PacienteDTO.self, from: ev.payload) else { return nil }
            return EventoDTO(llave: ev.llave, tipo: "alta", paciente: p, estudio: nil)
        case "estudio":
            guard let e = try? dec.decode(EstudioDTO.self, from: ev.payload) else { return nil }
            return EventoDTO(llave: ev.llave, tipo: "estudio", paciente: nil, estudio: e)
        case "visita":
            guard let v = try? dec.decode(VisitaDTO.self, from: ev.payload) else { return nil }
            return EventoDTO(llave: ev.llave, tipo: "visita", paciente: nil, estudio: nil, visita: v)
        case "actualizacion":
            guard let a = try? dec.decode(ActualizacionDTO.self, from: ev.payload) else { return nil }
            return EventoDTO(llave: ev.llave, tipo: "actualizacion", paciente: nil, estudio: nil, actualizacion: a)
        default:
            return nil
        }
    }
}
