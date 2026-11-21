import XCTest
@testable import ExpedienteRosa

// Mismos casos que api/test/coincidencias.test.ts. Los puntajes esperados salen de la versión TS.
final class CoincidenciasTests: XCTestCase {
    private typealias D = DatosPaciente
    private let umbral = Coincidencias.UMBRAL_POSIBLE

    private func puntaje(_ a: D, _ b: D) -> Double { Coincidencias.comparar(a, b).puntaje }

    // MARK: B2, los 4 casos de TS

    func testNormalizaApodosYAbreviaturas() {
        XCTAssertEqual(Coincidencias.normalizar("Ma. Lupe Hdz"), "maria guadalupe hernandez")
    }

    func testMismaPacienteEscritaDistinto() {
        let r = Coincidencias.comparar(
            D(nombre: "Ma. Lupe", apellidoPaterno: "Hdz", apellidoMaterno: "Velázquez", edad: 47, comunidad: "Tuxpan"),
            D(nombre: "María Guadalupe", apellidoPaterno: "Hernández", apellidoMaterno: "Belasquez", nacimiento: "1979-03-02", comunidad: "tuxpan"))
        XCTAssertGreaterThanOrEqual(r.puntaje, umbral)
        XCTAssertEqual(r.razones, ["nombre parecido", "apellido paterno parecido", "misma edad (±1 año)", "misma comunidad"])
    }

    func testNoJuntaMadreEHijaConElMismoNombre() {
        let p = puntaje(
            D(nombre: "Rosa", apellidoPaterno: "López", apellidoMaterno: "Cruz", nacimiento: "1958-01-10", comunidad: "Tuxpan"),
            D(nombre: "Rosa", apellidoPaterno: "López", apellidoMaterno: "Cruz", nacimiento: "1986-07-22", comunidad: "Tuxpan"))
        XCTAssertLessThan(p, umbral)
        XCTAssertEqual(p, 0.75, accuracy: 0.0005)
    }

    func testNoJuntaAPersonasDistintas() {
        let p = puntaje(D(nombre: "Juana", apellidoPaterno: "Pérez", edad: 30), D(nombre: "Carmen", apellidoPaterno: "Ramírez", edad: 31))
        XCTAssertLessThan(p, 0.7)
        XCTAssertEqual(p, 0.633, accuracy: 0.0005)
    }

    // MARK: piezas sueltas, valores calculados con la versión TS

    func testJaroWinklerIgualQueTS() {
        XCTAssertEqual(Coincidencias.jaroWinkler("martha", "marhta"), 0.961111, accuracy: 0.000001)
        XCTAssertEqual(Coincidencias.jaroWinkler("maria guadalupe", "guadalupe"), 0.774074, accuracy: 0.000001)
        XCTAssertEqual(Coincidencias.jaroWinkler("bibiana", "viviana"), 0.809524, accuracy: 0.000001)
        XCTAssertEqual(Coincidencias.jaroWinkler("", "a"), 0)
        XCTAssertEqual(Coincidencias.jaroWinkler("", ""), 1)
    }

    func testFoneticaIgualQueTS() {
        XCTAssertEqual(Coincidencias.fonetica("hernandez"), "ernandes")
        XCTAssertEqual(Coincidencias.fonetica("vazquez"), "baskes")
        XCTAssertEqual(Coincidencias.fonetica("llamas"), "yamas")
        XCTAssertEqual(Coincidencias.fonetica("cecilia"), "sesilia")
        XCTAssertEqual(Coincidencias.fonetica("gerardo"), "jerardo")
        XCTAssertEqual(Coincidencias.fonetica("accesso"), "akseso")
    }

    func testLlavesBloqueIgualQueTS() {
        XCTAssertEqual(Coincidencias.llavesBloque(D(nombre: "Ma. Lupe", apellidoPaterno: "Hdz", apellidoMaterno: "Velázquez", nacimiento: "1979-03-02")),
                       ["ap:erna", "am:bela", "ap-anio:ern:1979"])
        XCTAssertEqual(Coincidencias.llavesBloque(D(nombre: "Leticia", apellidoPaterno: "Ramírez")), ["ap:rami"])
    }

    // MARK: B3, nombres mexicanos (los mismos 10 casos están en api/test/coincidencias.test.ts)

    func testMx01_MaDelCarmen() {
        XCTAssertEqual(Coincidencias.normalizar("Ma. del Carmen"), "maria carmen")
        XCTAssertGreaterThanOrEqual(puntaje(
            D(nombre: "Ma. del Carmen", apellidoPaterno: "Ruiz", apellidoMaterno: "Gómez", nacimiento: "1970-11-05", comunidad: "Zongolica"),
            D(nombre: "María del Carmen", apellidoPaterno: "Ruiz", apellidoMaterno: "Gómez", nacimiento: "1970-11-05", comunidad: "Zongolica")), umbral)
    }

    func testMx02_MaLupitaSinPunto() {
        XCTAssertGreaterThanOrEqual(puntaje(
            D(nombre: "Ma Lupita", apellidoPaterno: "Flores", apellidoMaterno: "Díaz", edad: 35, comunidad: "Tuxpan"),
            D(nombre: "María Guadalupe", apellidoPaterno: "Flores", apellidoMaterno: "Díaz", nacimiento: "1991-06-18", comunidad: "Tuxpan")), umbral)
    }

    func testMx03_Hdz() {
        XCTAssertGreaterThanOrEqual(puntaje(
            D(nombre: "Josefina", apellidoPaterno: "Hdz", apellidoMaterno: "Torres", edad: 52, comunidad: "Papantla"),
            D(nombre: "Josefina", apellidoPaterno: "Hernández", apellidoMaterno: "Torres", nacimiento: "1974-05-10", comunidad: "Papantla")), umbral)
    }

    func testMx04_MtzGlz() {
        XCTAssertGreaterThanOrEqual(puntaje(
            D(nombre: "Ana", apellidoPaterno: "Mtz", apellidoMaterno: "Glz", nacimiento: "1982-02-20"),
            D(nombre: "Ana", apellidoPaterno: "Martínez", apellidoMaterno: "González", nacimiento: "1982-02-20")), umbral)
    }

    func testMx05_BVEnApellido() {
        XCTAssertGreaterThanOrEqual(puntaje(
            D(nombre: "Silvia", apellidoPaterno: "Bázquez", apellidoMaterno: "Mora", edad: 60, comunidad: "Zongolica"),
            D(nombre: "Silvia", apellidoPaterno: "Vázquez", apellidoMaterno: "Mora", edad: 61, comunidad: "Zongolica")), umbral)
    }

    func testMx06_BVEnNombre() {
        XCTAssertGreaterThanOrEqual(puntaje(
            D(nombre: "Bibiana", apellidoPaterno: "Ortega", apellidoMaterno: "Salas", nacimiento: "1988-09-09"),
            D(nombre: "Viviana", apellidoPaterno: "Ortega", apellidoMaterno: "Salas", nacimiento: "1988-09-09")), umbral)
    }

    func testMx07_SZ() {
        XCTAssertGreaterThanOrEqual(puntaje(
            D(nombre: "Beatris", apellidoPaterno: "Sanches", apellidoMaterno: "Ríos", edad: 39, comunidad: "Papantla"),
            D(nombre: "Beatriz", apellidoPaterno: "Sánchez", apellidoMaterno: "Ríos", nacimiento: "1987-01-15", comunidad: "Papantla")), umbral)
    }

    func testMx08_SZCSinMaterno() {
        let p = puntaje(D(nombre: "Sesilia", apellidoPaterno: "Gonsales", edad: 44), D(nombre: "Cecilia", apellidoPaterno: "González", edad: 45))
        XCTAssertGreaterThanOrEqual(p, umbral)
        XCTAssertEqual(p, 0.95, accuracy: 0.0005)
    }

    func testMx09_SinApellidoMaterno() {
        XCTAssertGreaterThanOrEqual(puntaje(
            D(nombre: "Leticia", apellidoPaterno: "Ramírez", edad: 40, comunidad: "Tuxpan"),
            D(nombre: "Leticia", apellidoPaterno: "Ramírez", apellidoMaterno: "Ortiz", nacimiento: "1986-08-01", comunidad: "Tuxpan")), umbral)
    }

    func testMx10_MadreEHijaMismoNombreDistintaFecha() {
        let p = puntaje(
            D(nombre: "Guadalupe", apellidoPaterno: "Martínez", apellidoMaterno: "Soto", nacimiento: "1960-04-12", comunidad: "Zongolica"),
            D(nombre: "Lupita", apellidoPaterno: "Mtz", apellidoMaterno: "Soto", nacimiento: "1985-09-30", comunidad: "Zongolica"))
        XCTAssertLessThan(p, umbral)
        XCTAssertEqual(p, 0.75, accuracy: 0.0005)
    }

    // MARK: buscar sobre Paciente (sin SwiftData: los @Model se pueden crear sin contenedor)

    func testBuscarOrdenaYFiltra() {
        let misma = Paciente(nombre: "María Guadalupe", apellidoPaterno: "Hernández", apellidoMaterno: "Belasquez",
                             nacimiento: "1979-03-02", comunidad: "Tuxpan", creadaPor: "test")
        let madre = Paciente(nombre: "Guadalupe", apellidoPaterno: "Hernández", apellidoMaterno: "Velázquez",
                             nacimiento: "1950-01-01", comunidad: "Tuxpan", creadaPor: "test")
        let otra = Paciente(nombre: "Carmen", apellidoPaterno: "Ramírez", edad: 47, comunidad: "Tuxpan", creadaPor: "test")
        let fusionada = Paciente(nombre: "Ma. Guadalupe", apellidoPaterno: "Hdz", apellidoMaterno: "Velazquez",
                                 nacimiento: "1979-03-02", comunidad: "Tuxpan", creadaPor: "test")
        fusionada.fusionadaEn = misma.id

        let q = NuevaPaciente(nombre: "Ma. Lupe", apellidoPaterno: "Hdz", apellidoMaterno: "Velázquez", edad: 47, comunidad: "Tuxpan")
        let r = Coincidencias.buscar(q, en: [otra, madre, fusionada, misma])
        XCTAssertEqual(r.map(\.id), [misma.id])
        XCTAssertEqual(r.first?.puntaje ?? 0, 1, accuracy: 0.0005)
    }
}
