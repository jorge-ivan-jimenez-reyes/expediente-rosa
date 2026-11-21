import XCTest
@testable import ExpedienteRosa

final class ModeloTests: XCTestCase {
    func testFolioSinCaracteresConfusos() {
        let f = Paciente.nuevoFolio()
        XCTAssertTrue(f.hasPrefix("ER-"))
        XCTAssertEqual(f.count, 9)
        XCTAssertNil(f.dropFirst(3).first { "01OI".contains($0) })
    }
}
