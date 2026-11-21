import XCTest
import SwiftData
@testable import ExpedienteRosa

/// Carril A. Las pruebas con servidor necesitan `docker compose up` + la API en localhost:8787; si no está, se saltan.
@MainActor
final class SyncTests: XCTestCase {
    let caida = ClienteAPI(base: URL(string: "http://127.0.0.1:1/api")!, espera: 3)
    let real = ClienteAPI(base: URL(string: "http://localhost:8787/api")!)
    let firma = Data("trazo-ficticio".utf8)

    private func nuevoContexto() throws -> ModelContext {
        let c = try ModelContainer(for: Schema(Esquema.modelos), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        addTeardownBlock { _ = c }   // retiene el contenedor mientras dura la prueba
        return c.mainContext
    }

    // A1
    func testAltaGuardaPacienteYEventoJuntos() throws {
        let ctx = try nuevoContexto()
        let sync = Sincronizador(contexto: ctx, api: caida, vigilarRed: false)
        let p = try sync.repositorio.alta(NuevaPaciente(nombre: "Herminia", apellidoPaterno: "Zacarías", edad: 47, comunidad: "Prueba"), firma: firma)
        XCTAssertEqual(try ctx.fetchCount(FetchDescriptor<Paciente>()), 1)
        XCTAssertEqual(sync.pendientes, 1)
        let ev = try XCTUnwrap(try ctx.fetch(FetchDescriptor<EventoPendiente>()).first)
        XCTAssertEqual(ev.tipo, "alta")
        XCTAssertEqual(Sincronizador.dto(de: ev)?.paciente?.id, p.id)
        XCTAssertEqual(p.consentimientoFirmado, firma)
    }

    func testAltaSinFirmaNoGuardaNada() throws {
        let ctx = try nuevoContexto()
        let repo = Repositorio(contexto: ctx)
        XCTAssertThrowsError(try repo.alta(NuevaPaciente(nombre: "A", apellidoPaterno: "B", comunidad: "C"), firma: Data()))
        XCTAssertThrowsError(try repo.alta(NuevaPaciente(nombre: "A", apellidoPaterno: "B", nacimiento: "2/3/79", comunidad: "C"), firma: firma))
        XCTAssertEqual(try ctx.fetchCount(FetchDescriptor<Paciente>()), 0)
        XCTAssertEqual(try ctx.fetchCount(FetchDescriptor<EventoPendiente>()), 0)
    }

    func testHistorialMasRecientePrimero() throws {
        let ctx = try nuevoContexto()
        let repo = Repositorio(contexto: ctx)
        let p = try repo.alta(NuevaPaciente(nombre: "Herminia", apellidoPaterno: "Zacarías", comunidad: "Prueba"), firma: firma)
        try repo.agregarEstudio(NuevoEstudio(tipo: .papanicolaou, fecha: .now.addingTimeInterval(-86_400 * 365), resultado: .normal), a: p)
        try repo.agregarEstudio(NuevoEstudio(tipo: .mastografia, resultado: .pendiente), a: p)
        XCTAssertEqual(repo.historial(de: p).map(\.tipo), [.mastografia, .papanicolaou])
    }

    // A3 sin red: importar dos veces no duplica y no pisa la firma
    func testImportarNoDuplica() throws {
        let ctx = try nuevoContexto()
        let sync = Sincronizador(contexto: ctx, api: caida, vigilarRed: false)
        let est = EstudioDTO(id: "e-1", pacienteId: "p-prueba-001", tipo: "mastografia", fecha: "2025-05-10", resultado: "normal", nota: nil, registradoPor: "med")
        let dto = PacienteDTO(id: "p-prueba-001", folio: "ER-AAAAAA", nombre: "Herminia", apellidoPaterno: "Zacarías", apellidoMaterno: nil,
                              nacimiento: "1979-03-02", edad: nil, comunidad: "Prueba", municipio: nil,
                              consentimiento: "2026-11-21T10:00:00.000Z", creadaPor: "enf", creada: "2026-11-21T10:00:00Z", estudios: [est])
        try sync.importar([dto])
        try sync.importar([dto])
        XCTAssertEqual(try ctx.fetchCount(FetchDescriptor<Paciente>()), 1)
        XCTAssertEqual(try ctx.fetchCount(FetchDescriptor<Estudio>()), 1)
        XCTAssertNotNil(Fechas.leer("2025-05-10"))
    }

    // A5: 3 altas sin servidor → se levanta → sincronizar → Valkey tiene 3 → repetir no duplica
    func testTresAltasSinSenalLuegoSincroniza() async throws {
        let arriba = await real.salud()
        try XCTSkipUnless(arriba, "API local no está arriba")
        let ctx = try nuevoContexto()
        let sync = Sincronizador(contexto: ctx, api: caida, autor: "enf-xctest", vigilarRed: false)
        let comunidad = "Prueba-XCTest"
        var ids: [String] = []
        for (n, a) in [("Herminia", "Zacarías"), ("Leocadia", "Xolalpa"), ("Petra", "Ocotlán")] {
            ids.append(try sync.repositorio.alta(NuevaPaciente(nombre: n, apellidoPaterno: a, edad: 40, comunidad: comunidad), firma: firma).id)
        }
        XCTAssertEqual(sync.pendientes, 3)
        do { try await sync.sincronizar(); XCTFail("con servidor caído debía fallar") } catch {}
        XCTAssertEqual(sync.pendientes, 3, "no se borra nada si el servidor no confirmó")

        let copias = try ctx.fetch(FetchDescriptor<EventoPendiente>()).map { ($0.llave, $0.tipo, $0.payload) }
        sync.api = real
        let r = try await sync.sincronizar()
        XCTAssertEqual(r.aplicados, 3)
        XCTAssertEqual(sync.pendientes, 0)
        let enServidor = try await real.pacientes(comunidad: comunidad).map(\.id)
        XCTAssertTrue(Set(ids).isSubset(of: Set(enServidor)))

        // El teléfono perdió la respuesta y reenvía lo mismo.
        for (l, t, p) in copias { ctx.insert(EventoPendiente(llave: l, tipo: t, payload: p)) }
        try ctx.save(); sync.actualizarPendientes()
        let r2 = try await sync.sincronizar()
        XCTAssertEqual(r2.aplicados, 0)
        XCTAssertEqual(r2.repetidos, 3)
        let despues = try await real.pacientes(comunidad: comunidad).filter { ids.contains($0.id) }
        XCTAssertEqual(despues.count, 3)
    }
}
