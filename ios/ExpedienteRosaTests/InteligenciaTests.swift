import ImageIO
import XCTest
@testable import ExpedienteRosa

/// Carril D. Hojas ficticias en Hojas/ (dibujadas con un script; nombres inventados).
/// Las pruebas con modelo se saltan si Foundation Models no está (simulador, iPhone sin Apple Intelligence).
final class InteligenciaTests: XCTestCase {
    struct Esperado {
        var archivo: String
        var nombre: String, paterno: String, materno: String?
        var nacimiento: String?, edad: Int?, comunidad: String
        var estudios: [(TipoEstudio, String, Resultado)]   // tipo, fecha AAAA-MM-DD, resultado
    }

    static let hojas: [Esperado] = [
        Esperado(archivo: "hoja1", nombre: "MARÍA GUADALUPE", paterno: "HERNÁNDEZ", materno: "LÓPEZ",
                 nacimiento: nil, edad: 47, comunidad: "METLATÓNOC",
                 estudios: [(.mastografia, "2024-03-12", .normal), (.papanicolaou, "2024-03-12", .pendiente)]),
        Esperado(archivo: "hoja2", nombre: "Juana Ma.", paterno: "Gómez", materno: "Santiago",
                 nacimiento: "1968-07-03", edad: nil, comunidad: "San Martín Peras",
                 estudios: [(.ultrasonido, "2023-08-20", .anormal), (.exploracion, "2023-08-20", .anormal)]),
        Esperado(archivo: "hoja3", nombre: "Rosa Isela", paterno: "Vásquez", materno: nil,
                 nacimiento: nil, edad: 52, comunidad: "Huejuquilla",
                 estudios: [(.mastografia, "2022-11-05", .normal), (.papanicolaou, "2022-11-05", .normal),
                            (.mastografia, "2025-02-14", .normal)]),
    ]

    func imagen(_ nombre: String) throws -> CGImage {
        let b = Bundle(for: InteligenciaTests.self)
        let url = try XCTUnwrap(b.url(forResource: nombre, withExtension: "png")
                                ?? b.url(forResource: nombre, withExtension: "png", subdirectory: "Hojas"),
                                "\(nombre).png no está en el bundle de pruebas")
        let src = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
        return try XCTUnwrap(CGImageSourceCreateImageAtIndex(src, 0, nil))
    }

    // MARK: Sin modelo (corren siempre)

    func testVisionLeeLasTresHojas() async throws {
        for h in Self.hojas {
            let texto = RevisionHoja.plegar(try await LectorTexto.leer(try imagen(h.archivo)))
            for palabra in [h.paterno, h.comunidad] {
                XCTAssertTrue(RevisionHoja.aparece(palabra, en: texto), "\(h.archivo): Vision no leyó «\(palabra)»")
            }
        }
    }

    func testRevisionCorrigeLoQueElModeloInventa() {
        let texto = """
            Paciente: Rosa Isela Vásquez
            Edad: 52 Comunidad: Huejuquilla
            05/11/2022 Mastografía - normal
            20/08/2023 Ultrasonido de mama: ANORMAL
            Dra. Itzel Romero
            """
        // Salida real que dio el modelo en una corrida: nombre cortado, materno repetido,
        // nacimiento inventado, fecha con día y mes volteados, ANORMAL como normal y la firma como nota.
        let g = HojaGenerada(
            paciente: PacienteGenerada(nombreTalCual: "Rosa Isela Vásquez", nombre: "Rosa", apellidoPaterno: "Vásquez",
                                       apellidoMaterno: "Vásquez", nacimiento: "1970-05-11", edad: nil,
                                       comunidad: "Huejuquilla", municipio: nil),
            estudios: [EstudioGenerado(tipo: .mastografia, fecha: "2022-05-11", resultado: .normal, nota: "Mastografía - normal"),
                       EstudioGenerado(tipo: .ultrasonido, fecha: "2023-08-20", resultado: .normal, nota: "Dra. Itzel Romero")])
        let (p, estudios) = RevisionHoja.revisar(g, texto: texto)
        XCTAssertEqual(p.nombre, "Rosa Isela")
        XCTAssertEqual(p.apellidoPaterno, "Vásquez")
        XCTAssertNil(p.apellidoMaterno)
        XCTAssertNil(p.nacimiento)
        XCTAssertEqual(p.edad, 52)
        XCTAssertEqual(FechasIA.texto(estudios[0].fecha), "2022-11-05")
        XCTAssertNil(estudios[0].nota)
        XCTAssertEqual(estudios[1].resultado, .anormal)
        XCTAssertNil(estudios[1].nota)
    }

    func testSinModeloTodoDevuelveNil() async throws {
        try XCTSkipIf(Inteligencia.disponible, "Hay modelo: esta prueba es para el respaldo sin modelo")
        let hoja = await Inteligencia.interpretarHoja(texto: "Nombre: Ana Pérez")
        XCTAssertEqual(hoja.textoCrudo, "Nombre: Ana Pérez")
        XCTAssertNil(hoja.paciente)
        let dictado = await Inteligencia.dictarEstudio("mastografía normal")
        XCTAssertNil(dictado)
        let resumen = await Inteligencia.resumir(datos: [EstudioParaResumen(tipo: .mastografia, fecha: .now, resultado: .normal)])
        XCTAssertNil(resumen)
    }

    // MARK: Con modelo (se saltan si no está)

    func testLeerHojasConModelo() async throws {
        try XCTSkipUnless(Inteligencia.disponible, "Foundation Models no disponible: \(Inteligencia.motivo)")
        for h in Self.hojas {
            let hoja = try await Inteligencia.leerHoja(try imagen(h.archivo))
            let p = try XCTUnwrap(hoja.paciente, "\(h.archivo): el modelo no devolvió paciente")
            XCTAssertEqual(p.nombre, h.nombre, h.archivo)
            XCTAssertEqual(p.apellidoPaterno, h.paterno, h.archivo)
            XCTAssertEqual(p.apellidoMaterno, h.materno, h.archivo)
            XCTAssertEqual(p.nacimiento, h.nacimiento, h.archivo)
            XCTAssertEqual(p.edad, h.edad, h.archivo)
            XCTAssertEqual(p.comunidad, h.comunidad, h.archivo)
            XCTAssertEqual(hoja.estudios.count, h.estudios.count, h.archivo)
            for (leido, (tipo, fecha, resultado)) in zip(hoja.estudios, h.estudios) {
                XCTAssertEqual(leido.tipo, tipo, h.archivo)
                XCTAssertEqual(FechasIA.texto(leido.fecha), fecha, h.archivo)
                XCTAssertEqual(leido.resultado, resultado, h.archivo)
            }
        }
    }

    func testDictadoConModelo() async throws {
        try XCTSkipUnless(Inteligencia.disponible, "Foundation Models no disponible: \(Inteligencia.motivo)")
        let dictado = await Inteligencia.dictarEstudio("mastografía normal, regresa en un año")
        let e = try XCTUnwrap(dictado)
        XCTAssertEqual(e.tipo, .mastografia)
        XCTAssertEqual(e.resultado, .normal)
    }

    func testResumenYExplicacionConModelo() async throws {
        try XCTSkipUnless(Inteligencia.disponible, "Foundation Models no disponible: \(Inteligencia.motivo)")
        let resumido = await Inteligencia.resumir(datos: [
            EstudioParaResumen(tipo: .ultrasonido, fecha: FechasIA.fecha("2024-03-12")!, resultado: .anormal, nota: "nódulo 1 cm"),
            EstudioParaResumen(tipo: .mastografia, fecha: FechasIA.fecha("2022-11-05")!, resultado: .normal),
        ])
        let resumen = try XCTUnwrap(resumido)
        XCTAssertLessThanOrEqual(resumen.split(whereSeparator: \.isNewline).count, 3)
        let q = NuevaPaciente(nombre: "Ma. Guadalupe", apellidoPaterno: "Hdz", apellidoMaterno: "López", edad: 49, comunidad: "Metlatónoc")
        let c = NuevaPaciente(nombre: "María Guadalupe", apellidoPaterno: "Hernández", apellidoMaterno: "López", edad: 47, comunidad: "Metlatónoc")
        let explicado = await Inteligencia.explicar(buscada: q, candidata: c, puntaje: 0.91, razones: ["misma comunidad"])
        let linea = try XCTUnwrap(explicado)
        XCTAssertEqual(linea.split(whereSeparator: \.isNewline).count, 1)
    }
}
