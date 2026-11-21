#if DEBUG
import SwiftUI
import SwiftData
import UIKit

/// Modo captura (solo DEBUG): `-pantalla <nombre>` abre directo esa pantalla con datos
/// FICTICIOS en un ModelContainer en memoria, sin red. Sirve para sacar capturas con
/// `xcrun simctl io … screenshot` sin tocar el simulador.
///
/// Pantallas: buscar, buscar-resultados, alta, expediente, expediente-medico, escanear, jornada, revision.
@MainActor
enum ModoCaptura {
    static let pantallas = ["buscar", "buscar-resultados", "alta", "expediente", "expediente-medico",
                            "escanear", "jornada", "revision"]

    /// Lo que vino en `-pantalla` (los argumentos de lanzamiento entran a UserDefaults).
    static var pantalla: String? {
        guard let p = UserDefaults.standard.string(forKey: "pantalla"), pantallas.contains(p) else { return nil }
        return p
    }

    static var pestanaInicial: String {
        switch pantalla {
        case "jornada": "jornada"
        case "revision": "revision"
        default: "buscar"
        }
    }

    static var rol: Rol {
        switch pantalla {
        case "expediente-medico": .medico
        case "revision": .coordinadora
        default: .enfermeria
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

    static var paresDemo: [ParDuplicado]? {
        guard pantalla == "revision" else { return nil }
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

    /// Contenedor en memoria con pacientes ficticias. Tres altas pasan por el Repositorio
    /// para que haya pendientes por mandar.
    static func contenedor() -> ModelContainer {
        let c = try! ModelContainer(for: Paciente.self, Estudio.self, EventoPendiente.self,
                                    configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let hace = { (dias: Int) in Calendar.current.date(byAdding: .day, value: -dias, to: .now)! }

        let lupe = Paciente(folio: folioExpediente, nombre: "María Guadalupe", apellidoPaterno: "Hernández",
                            apellidoMaterno: "Velázquez", nacimiento: "1975-05-11", comunidad: "San Martín Peras",
                            municipio: "San Martín Peras, Oaxaca", consentimiento: hace(620), creadaPor: "enf-jux", creada: hace(620))
        ctx.insert(lupe)
        let estudios: [(TipoEstudio, Int, Resultado, String?)] = [
            (.ultrasonido, 252, .anormal, "Nódulo de 8 mm en mama izquierda. Control en 6 meses."),
            (.papanicolaou, 252, .pendiente, nil),
            (.mastografia, 620, .normal, nil),
        ]
        for (t, d, r, n) in estudios {
            ctx.insert(Estudio(pacienteId: lupe.id, tipo: t, fecha: hace(d), resultado: r, nota: n, registradoPor: "med-jux"))
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
