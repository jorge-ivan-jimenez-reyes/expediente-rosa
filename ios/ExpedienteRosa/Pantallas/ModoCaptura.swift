#if DEBUG
import SwiftUI
import SwiftData
import UIKit

/// Modo captura (solo DEBUG): `-pantalla <nombre>` abre directo esa pantalla con datos
/// FICTICIOS en un ModelContainer en memoria, sin red. Sirve para sacar capturas con
/// `xcrun simctl io … screenshot` sin tocar el simulador.
///
/// Pantallas: buscar, buscar-resultados, alta, expediente, expediente-medico, escanear, jornada, revision,
/// y del Reto 1: editar, estudio, revision-conflictos, revision-seguimiento, bitacora.
@MainActor
enum ModoCaptura {
    static let pantallas = ["buscar", "buscar-resultados", "alta", "expediente", "expediente-medico",
                            "escanear", "jornada", "revision",
                            "editar", "estudio", "revision-conflictos", "revision-seguimiento", "bitacora"]

    /// Lo que vino en `-pantalla` (los argumentos de lanzamiento entran a UserDefaults).
    static var pantalla: String? {
        guard let p = UserDefaults.standard.string(forKey: "pantalla"), pantallas.contains(p) else { return nil }
        return p
    }

    static var pestanaInicial: String {
        switch pantalla {
        case "jornada": "jornada"
        case "revision", "revision-conflictos", "revision-seguimiento", "bitacora": "revision"
        default: "buscar"
        }
    }

    static var rol: Rol {
        switch pantalla {
        case "expediente-medico", "estudio": .medico
        case "revision", "revision-conflictos", "revision-seguimiento", "bitacora": .coordinadora
        default: .enfermeria
        }
    }

    static var seccionRevision: RevisionView.Seccion {
        switch pantalla {
        case "revision-conflictos": .conflictos
        case "revision-seguimiento": .seguimiento
        default: .duplicados
        }
    }

    /// Folio de la paciente que abre `expediente` y `expediente-medico`.
    static let folioExpediente = "SMP-014"

    /// Búsqueda ya escrita para `buscar-resultados`: la misma señora, escrita distinto.
    static let consulta = NuevaPaciente(nombre: "Ma. Guadalupe", apellidoPaterno: "Hdz", apellidoMaterno: "Velasquez",
                                        nacimiento: nil, edad: 51, comunidad: "San Martín Peras", municipio: nil)

    /// Lo que la enfermera ya escribió antes de tocar «Es nueva».
    static let altaInicial = NuevaPaciente(nombre: "Rosa Isela", apellidoPaterno: "Chávez", apellidoMaterno: "Ortiz",
                                           nacimiento: nil, edad: 46, comunidad: "Metlatónoc", municipio: nil)

    static var hojaDemo: (UIImage, HojaLeida)? {
        guard pantalla == "escanear",
              let url = Bundle.main.url(forResource: "hoja1", withExtension: "png"),
              let img = UIImage(contentsOfFile: url.path) else { return nil }
        let hoja = HojaLeida(
            textoCrudo: "JORNADA DE TAMIZAJE · HUEJUQUILLA\nNombre: Felipa Carrillo de la Cruz\nFecha nac.: 03/02/1968\nMastografía: normal\nPapanicolaou: pendiente",
            paciente: NuevaPaciente(nombre: "Felipa", apellidoPaterno: "Carrillo", apellidoMaterno: "de la Cruz",
                                    nacimiento: "1968-02-03", edad: nil, comunidad: "Huejuquilla", municipio: "Huejuquilla el Alto, Jalisco"),
            estudios: [NuevoEstudio(tipo: .mastografia, resultado: .normal), NuevoEstudio(tipo: .papanicolaou, resultado: .pendiente)])
        return (img, hoja)
    }

    static var paresDemo: [ParDuplicado] {
        func dto(_ id: String, _ folio: String, _ n: String, _ p: String, _ m: String?, nac: String?, edad: Int?, _ c: String) -> PacienteDTO {
            PacienteDTO(id: id, folio: folio, nombre: n, apellidoPaterno: p, apellidoMaterno: m, nacimiento: nac, edad: edad,
                        comunidad: c, municipio: nil, consentimiento: "2026-11-18T09:12:00-06:00", creadaPor: "enf-1",
                        creada: "2026-11-18T09:12:00-06:00", estudios: nil)
        }
        return [
            ParDuplicado(llave: "duplicado:a1|b1", puntaje: 1.0,
                         razones: "nombre parecido, apellido paterno parecido, misma fecha de nacimiento, misma comunidad",
                         a: dto("a1", "MET-007", "Rosalba", "Quintero", "Ibarra", nac: "1971-09-23", edad: nil, "Metlatónoc"),
                         b: dto("b1", "MET-031", "Rosalva", "Quinteros", "Ybarra", nac: "1971-09-23", edad: nil, "Metlatónoc")),
            ParDuplicado(llave: "duplicado:a2|b2", puntaje: 0.86,
                         razones: "nombre parecido, apellido paterno parecido, misma edad (±1 año)",
                         a: dto("a2", "JUX-002", "Ma. del Carmen", "López", "Hdz", nac: nil, edad: 52, "San Martín Peras"),
                         b: dto("b2", "JUX-019", "María del Carmen", "López", "Hernández", nac: "1974-06-12", edad: nil, "San Martín Peras")),
        ]
    }

    private static func corta(_ id: String, _ folio: String, _ n: String, _ p: String, _ m: String?, _ c: String) -> PacienteCorta {
        PacienteCorta(id: id, folio: folio, nombre: n, apellidoPaterno: p, apellidoMaterno: m, comunidad: c)
    }

    private static func iso(dias: Int, horas: Int = 0) -> String {
        ISO.texto(Date.now.addingTimeInterval(TimeInterval(-dias * 86_400 - horas * 3_600)))
    }

    static var conflictosDemo: [ConflictoDTO] {
        [
            ConflictoDTO(id: "c1", pacienteId: "p1", autor: "enf-tux-2", dispositivo: "ios-7f3a", creado: iso(dias: 0, horas: 2),
                         motivo: "version-distinta", versionBase: 1, versionActual: 2,
                         campos: [.init(campo: "nacimiento", propuesto: "1975-11-05", actual: "1975-05-11", alRecibir: "1975-05-11")],
                         paciente: corta("p1", folioExpediente, "María Guadalupe", "Hernández", "Velázquez", "San Martín Peras")),
            ConflictoDTO(id: "c2", pacienteId: "p2", autor: "enf-met-1", dispositivo: "ios-21bc", creado: iso(dias: 1),
                         motivo: "version-distinta", versionBase: 1, versionActual: 3,
                         campos: [.init(campo: "apellidoMaterno", propuesto: "Ybarra", actual: "Ibarra", alRecibir: "Ibarra"),
                                  .init(campo: "edad", propuesto: 56, actual: 55, alRecibir: 55)],
                         paciente: corta("p2", "MET-007", "Rosalba", "Quintero", "Ibarra", "Metlatónoc")),
        ]
    }

    static var seguimientoDemo: [SeguimientoDTO] {
        func fila(_ id: String, _ tipo: TipoEstudio, _ motivo: String, dias: Int, _ p: PacienteCorta) -> SeguimientoDTO {
            SeguimientoDTO(estudioId: id, tipo: tipo.rawValue, fecha: iso(dias: 30), motivo: motivo,
                           fechaLimite: iso(dias: -dias), vencido: dias < 0, diasRestantes: dias, paciente: p)
        }
        return [
            fila("s1", .ultrasonido, "BI-RADS 3", dias: -70, corta("p1", folioExpediente, "María Guadalupe", "Hernández", "Velázquez", "San Martín Peras")),
            fila("s2", .mastografia, "BI-RADS 4", dias: -5, corta("p3", "MET-012", "Eulalia", "García", "Luna", "Metlatónoc")),
            fila("s3", .papanicolaou, "Bethesda anormal", dias: 3, corta("p4", "HUE-010", "Juana", "Bautista", nil, "Huejuquilla")),
            fila("s4", .mastografia, "resultado anormal", dias: 12, corta("p5", "JUX-001", "María del Carmen", "López", "Hernández", "San Martín Peras")),
        ]
    }

    static func bitacoraDemo(_ pacientes: [Paciente]) -> [EntradaBitacora] {
        let id = { (folio: String) in pacientes.first { $0.folio == folio }?.id }
        func e(_ n: Int, _ tipo: String, _ autor: String, _ folio: String, minutos: Int, campos: [String]? = nil) -> EntradaBitacora {
            EntradaBitacora(id: "\(n)", cuando: ISO.texto(.now.addingTimeInterval(TimeInterval(-minutos * 60))), tipo: tipo,
                            autor: autor, dispositivo: nil, pacienteId: id(folio), campos: campos)
        }
        return [
            e(1, "conflicto-rechazar", "coordinadora", "MET-007", minutos: 4, campos: ["apellidoMaterno"]),
            e(2, "conflicto", "enf-tux-2", folioExpediente, minutos: 18, campos: ["nacimiento"]),
            e(3, "actualizacion", "enf-jux", folioExpediente, minutos: 26, campos: ["idEira", "entidadNacimiento"]),
            e(4, "estudio", "med-jux", folioExpediente, minutos: 31),
            e(5, "visita", "enf-jux", folioExpediente, minutos: 40),
            e(6, "duplicado-unir", "coordinadora", "JUX-001", minutos: 55),
            e(7, "alta", "enf-jux", "HUE-010", minutos: 62),
        ]
    }

    /// Contenedor en memoria con pacientes ficticias. Tres altas pasan por el Repositorio
    /// para que haya pendientes por mandar.
    static func contenedor() -> ModelContainer {
        let c = try! ModelContainer(for: Schema(Esquema.modelos),
                                    configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let hace = { (dias: Int) in Calendar.current.date(byAdding: .day, value: -dias, to: .now)! }

        let lupe = Paciente(folio: folioExpediente, nombre: "María Guadalupe", apellidoPaterno: "Hernández",
                            apellidoMaterno: "Velázquez", nacimiento: "1975-05-11", comunidad: "San Martín Peras",
                            municipio: "San Martín Peras, Oaxaca", consentimiento: hace(620), creadaPor: "enf-jux", creada: hace(620))
        if pantalla != "editar" { lupe.idEira = "EIRA-0142"; lupe.entidadNacimiento = "Oaxaca"; lupe.version = 2 }
        ctx.insert(lupe)
        // Tres visitas; los estudios cuelgan de su visita. La de hace 2 días es de esta jornada.
        func visita(_ dias: Int, _ comunidad: String) -> Visita {
            Visita(pacienteId: lupe.id, fecha: hace(dias), comunidad: comunidad, motivo: "jornada de tamizaje", registradaPor: "enf-jux",
                   estado: "Oaxaca", jornada: Repositorio.nombreJornada(comunidad: comunidad, fecha: hace(dias)))
        }
        let v1 = visita(620, "San Martín Peras"), v2 = visita(252, "Juxtlahuaca"), v3 = visita(2, "San Martín Peras")
        v1.estado = nil; v1.jornada = nil   // la primera es de antes de que hubiera etapas y jornadas
        ctx.insert(v1); ctx.insert(v2); ctx.insert(v3)
        // Etapas: hoy en laboratorio y tomado; la visita pasada, interpretado por la patóloga (falta avisar) y avisada.
        let estudios: [(TipoEstudio, Visita, Resultado, String?, String?, Conducta?, Etapa?, String?)] = [
            (.papanicolaou, v3, .pendiente, nil, nil, nil, .enLaboratorio, nil),
            (.mastografia, v3, .pendiente, nil, nil, nil, .tomado, nil),
            (.ultrasonido, v2, .anormal, "Nódulo de 8 mm en mama izquierda.", "BI-RADS 3", .evaluacion6Meses, .avisado, "med-jux"),
            (.papanicolaou, v2, .normal, nil, "Bethesda: NILM", .rutina1Anio, .interpretado, "Dra. Elena Ruiz"),
            (.mastografia, v1, .normal, nil, "BI-RADS 1", .rutina1Anio, nil, nil),
        ]
        for (t, v, r, n, c, cd, et, por) in estudios {
            ctx.insert(Estudio(pacienteId: lupe.id, tipo: t, fecha: v.fecha, resultado: r, nota: n, registradoPor: "med-jux",
                               visitaId: v.id, clasificacion: c, conducta: cd, etapa: et, interpretadoPor: por,
                               interpretadoEn: por == nil ? nil : v.fecha.addingTimeInterval(9 * 86_400)))
        }

        let otras: [(String, String, String, String?, Int, String, String)] = [
            ("JUX-001", "María del Carmen", "López", "Hernández", 52, "San Martín Peras", "1974-06-12"),
            ("JUX-008", "Guadalupe", "Hernández", "Cruz", 23, "San Martín Peras", "2003-01-30"),
            ("MET-007", "Rosalba", "Quintero", "Ibarra", 55, "Metlatónoc", "1971-09-23"),
            ("MET-012", "Eulalia", "García", "Luna", 67, "Metlatónoc", "1959-04-02"),
            ("HUE-003", "Felipa", "Carrillo", "de la Cruz", 58, "Huejuquilla", "1968-02-03"),
            ("HUE-010", "Juana", "Bautista", nil, 44, "Huejuquilla", "1982-08-15"),
        ]
        for (folio, n, p, m, _, com, nac) in otras {
            let x = Paciente(folio: folio, nombre: n, apellidoPaterno: p, apellidoMaterno: m, nacimiento: nac,
                             comunidad: com, consentimiento: hace(300), creadaPor: "enf-1", creada: hace(300))
            ctx.insert(x)
            ctx.insert(Estudio(pacienteId: x.id, tipo: .mastografia, fecha: hace(300), resultado: .normal, registradoPor: "med-1"))
        }
        try? ctx.save()

        // Altas de hoy, guardadas sin señal: quedan en la cola.
        let repo = Repositorio(contexto: ctx, autor: "ios-captura")
        let firma = Data([1, 2, 3])
        _ = try? repo.alta(NuevaPaciente(nombre: "Antonia", apellidoPaterno: "Ramírez", apellidoMaterno: "Solís",
                                         nacimiento: nil, edad: 49, comunidad: "San Martín Peras", municipio: nil), firma: firma)
        _ = try? repo.alta(NuevaPaciente(nombre: "Leticia", apellidoPaterno: "Morales", apellidoMaterno: nil,
                                         nacimiento: "1980-03-19", edad: nil, comunidad: "San Martín Peras", municipio: nil), firma: firma)
        _ = try? repo.alta(NuevaPaciente(nombre: "Ofelia", apellidoPaterno: "Santiago", apellidoMaterno: "Pérez",
                                         nacimiento: nil, edad: 61, comunidad: "San Martín Peras", municipio: nil), firma: firma)
        return c
    }
}

/// Raíz del modo captura: mismo árbol que la app, con datos en memoria.
struct RaizCaptura: View {
    @State private var contenedor: ModelContainer
    @State private var sync: Sincronizador

    init() {
        // Rol y comunidad van al dominio de argumentos (volátil): no pisan lo que eligió quien usa el teléfono.
        let d = UserDefaults.standard
        var args = d.volatileDomain(forName: UserDefaults.argumentDomain)
        args["rol"] = ModoCaptura.rol.rawValue
        args["comunidad"] = "San Martín Peras"
        args["estado"] = "Oaxaca"
        d.setVolatileDomain(args, forName: UserDefaults.argumentDomain)
        let c = ModoCaptura.contenedor()
        // Servidor inexistente: el modo captura nunca toca la red.
        let s = Sincronizador(contexto: c.mainContext, api: ClienteAPI(base: URL(string: "http://127.0.0.1:1/api")!),
                              autor: "ios-captura", vigilarRed: false)
        if ModoCaptura.pantalla == "jornada" { s.sincronizarAlVolver = false; s.simularSinSenal = true }
        _contenedor = State(initialValue: c)
        _sync = State(initialValue: s)
    }

    var body: some View {
        Pestanas(pestana: ModoCaptura.pestanaInicial)
            .environment(sync)
            .modelContainer(contenedor)
    }
}
#endif
