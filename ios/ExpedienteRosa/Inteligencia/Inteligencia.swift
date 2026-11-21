import CoreGraphics
import Foundation
import FoundationModels
import ImageIO
import os
#if canImport(UIKit)
import UIKit
#endif

/// Lo que la enfermera revisa después de escanear una hoja. Si el modelo no está,
/// solo trae `textoCrudo` (lo que leyó Vision) y la UI deja capturar a mano.
struct HojaLeida: Sendable, Hashable {
    var textoCrudo: String
    var paciente: NuevaPaciente?
    var estudios: [NuevoEstudio]
    /// true si Foundation Models llenó paciente/estudios.
    var leidaPorModelo: Bool { paciente != nil }
}

/// Datos mínimos de un estudio para el resumen (Sendable: no cruza @Model entre hilos).
struct EstudioParaResumen: Sendable, Hashable {
    var tipo: TipoEstudio
    var fecha: Date
    var resultado: Resultado
    var nota: String?
}

enum ErrorInteligencia: Error, LocalizedError {
    case imagenIlegible
    var errorDescription: String? { "No se pudo leer la imagen." }
}

/// Vision + Foundation Models, todo dentro del teléfono: nada de esto usa red.
/// Todo es opcional: si el modelo no está (simulador, iPhone sin Apple Intelligence,
/// o sin español), las funciones devuelven nil y la UI sigue sin las líneas del modelo.
enum Inteligencia {
    private static let log = Logger(subsystem: "org.eira.expedienterosa", category: "Inteligencia")

    /// Mismo modelo del sistema, con la guardrail pensada para transformar texto que da el usuario
    /// (resumir, extraer). Los datos de salud de una hoja disparan menos falsos positivos así.
    private static var modelo: SystemLanguageModel { SystemLanguageModel(guardrails: .permissiveContentTransformations) }

    // MARK: D1

    static var disponible: Bool {
        let m = SystemLanguageModel.default
        guard case .available = m.availability else { return false }
        return m.supportedLanguages.contains { $0.languageCode == .spanish }
    }

    /// Para mostrar en Inicio o en logs por qué no hay modelo.
    static var motivo: String {
        let m = SystemLanguageModel.default
        switch m.availability {
        case .available:
            return m.supportedLanguages.contains { $0.languageCode == .spanish }
                ? "Modelo disponible" : "El modelo no tiene español en este dispositivo"
        case .unavailable(.deviceNotEligible): return "Este dispositivo no tiene Apple Intelligence"
        case .unavailable(.appleIntelligenceNotEnabled): return "Apple Intelligence está apagado"
        case .unavailable(.modelNotReady): return "El modelo se está descargando"
        case .unavailable: return "Modelo no disponible"
        }
    }

    /// Carga el modelo antes de usarlo (la primera respuesta en frío tarda ~30 s; después, ~3 s).
    /// Llamar al abrir Escanear o Buscar. No hace nada si no hay modelo.
    static func precalentar() {
        guard disponible else { return }
        LanguageModelSession(model: modelo).prewarm()
    }

    // MARK: D2 leer hoja de papel

    #if canImport(UIKit)
    static func leerHoja(_ imagen: UIImage) async throws -> HojaLeida {
        if let cg = imagen.cgImage {
            return try await leerHoja(cg, orientacion: imagen.imageOrientation.orientacionCG)
        }
        guard let dibujada = imagen.cgParaVision else { throw ErrorInteligencia.imagenIlegible }
        return try await leerHoja(dibujada, orientacion: .up)
    }
    #endif

    /// Vision (es-MX) → texto → Foundation Models → paciente + estudios. Lanza solo si Vision falla.
    static func leerHoja(_ imagen: CGImage, orientacion: CGImagePropertyOrientation? = nil) async throws -> HojaLeida {
        let texto = try await LectorTexto.leer(imagen, orientacion: orientacion)
        return await interpretarHoja(texto: texto)
    }

    /// Segunda mitad de leerHoja, separada para probarla con texto.
    static func interpretarHoja(texto: String) async -> HojaLeida {
        var hoja = HojaLeida(textoCrudo: texto, paciente: nil, estudios: [])
        guard !TextoIA.limpio(texto).isEmpty else { return hoja }
        guard disponible else {
            hoja.paciente = RevisionHoja.pacienteSinModelo(texto)   // sin modelo: reglas del formato de EIRA
            return hoja
        }
        let sesion = LanguageModelSession(model: modelo, instructions: """
            Ayudas a capturar hojas de registro en papel de jornadas de tamizaje de cáncer de mama y \
            cervicouterino en comunidades rurales de México. Recibes el texto que leyó el OCR de una hoja; \
            puede traer errores de lectura. Extrae solo lo que está escrito en la hoja. No inventes datos: \
            si algo no aparece, déjalo nulo. Copia las fechas tal como están escritas (día/mes/año).
            Los nombres en México son: uno o más nombres de pila, luego apellido paterno y luego materno. \
            Ejemplo: "Petra Ma. Ramírez Cruz" es nombre "Petra Ma.", paterno "Ramírez", materno "Cruz". \
            "Ana Luisa Morales" es nombre "Ana Luisa", paterno "Morales", sin materno.
            """)
        do {
            let r = try await sesion.respond(to: "Texto de la hoja:\n\(texto)", generating: HojaGenerada.self,
                                             options: GenerationOptions(sampling: .greedy))
            (hoja.paciente, hoja.estudios) = RevisionHoja.revisar(r.content, texto: texto)
        } catch {
            registrar(error, en: "leerHoja")
        }
        if hoja.paciente == nil || hoja.paciente?.nombre.isEmpty == true {
            hoja.paciente = RevisionHoja.pacienteSinModelo(texto) ?? hoja.paciente
        }
        return hoja
    }

    // MARK: D3 explicar coincidencia

    /// Firma del contrato. @MainActor porque `Candidata.paciente` es un @Model: se copia a datos simples aquí.
    @MainActor
    static func explicar(_ c: Candidata, para q: NuevaPaciente) async -> String? {
        let p = c.paciente
        let guardada = NuevaPaciente(nombre: p.nombre, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno,
                                     nacimiento: p.nacimiento, edad: p.edad, comunidad: p.comunidad, municipio: p.municipio)
        return await explicar(buscada: q, candidata: guardada, puntaje: c.puntaje, razones: c.razones)
    }

    /// Una línea que explica por qué la candidata podría ser la misma señora. La decisión es de la enfermera.
    static func explicar(buscada q: NuevaPaciente, candidata: NuevaPaciente, puntaje: Double, razones: [String]) async -> String? {
        guard disponible else { return nil }
        let prompt = """
            Ficha que se busca: \(describir(q))
            Ficha guardada: \(describir(candidata))
            Parecido calculado: \(Int((puntaje * 100).rounded())) de 100
            Razones del algoritmo: \(razones.joined(separator: "; "))
            """
        return await unaRespuesta(prompt, lineas: 1, en: "explicar", instrucciones: """
            Ayudas a una enfermera a reconocer pacientes que regresan a una jornada de tamizaje. \
            Escribe una sola línea corta en español de México que explique por qué las dos fichas podrían \
            ser la misma señora, usando las razones dadas (nombre escrito distinto, misma comunidad, edad). \
            Empieza por lo que coincide y termina con lo que no cuadra, si hay algo. No afirmes que es ella \
            y no hables de la enfermera. Ejemplo: "Ma. es María y Hdz es Hernández; mismo materno y misma \
            comunidad; la edad difiere 2 años."
            """)
    }

    // MARK: D3 resumir historial

    /// Resumen de hasta tres líneas del historial. nil si no hay estudios o no hay modelo.
    @MainActor
    static func resumir(_ estudios: [Estudio]) async -> String? {
        let datos = estudios.map { EstudioParaResumen(tipo: $0.tipo, fecha: $0.fecha, resultado: $0.resultado, nota: $0.nota) }
        return await resumir(datos: datos)
    }

    static func resumir(datos: [EstudioParaResumen]) async -> String? {
        guard disponible, !datos.isEmpty else { return nil }
        let renglones = datos.sorted { $0.fecha > $1.fecha }.prefix(20).map { e in
            "- \(FechasIA.texto(e.fecha)): \(e.tipo.nombre), resultado \(e.resultado.rawValue)"
                + (e.nota.map { " (\($0))" } ?? "")
        }
        return await unaRespuesta("Hoy es \(FechasIA.texto(.now)). Historial, del más reciente al más viejo:\n"
                                  + renglones.joined(separator: "\n"),
                                  lineas: 3, en: "resumir", instrucciones: """
            Resumes el historial de tamizaje de una paciente para el médico de la jornada. \
            Escribe máximo tres líneas cortas en español de México: el último estudio de cada tipo y cuándo, \
            cualquier resultado anormal y si quedó algo pendiente. Solo usa los datos dados. \
            No des diagnósticos ni recomendaciones.
            """)
    }

    // MARK: D4 dictado

    /// «mastografía normal, regresa en un año» → NuevoEstudio con fecha de hoy.
    static func dictarEstudio(_ texto: String) async -> NuevoEstudio? {
        guard disponible, !TextoIA.limpio(texto).isEmpty else { return nil }
        let sesion = LanguageModelSession(model: modelo, instructions: """
            Conviertes lo que dicta un médico en una jornada de tamizaje en un registro de estudio. \
            Tipos: mastografía, ultrasonido de mama, papanicolaou (citología cervical) o exploración clínica. \
            Si no dice resultado, es pendiente. Lo demás que diga va en la nota, breve.
            """)
        do {
            let r = try await sesion.respond(to: "Dictado: \(texto)", generating: EstudioDictado.self,
                                             options: GenerationOptions(sampling: .greedy))
            return NuevoEstudio(tipo: r.content.tipo.tipo, fecha: .now, resultado: r.content.resultado.resultado,
                                nota: TextoIA.opcional(r.content.nota))
        } catch {
            registrar(error, en: "dictarEstudio")
            return nil
        }
    }

    // MARK: - Apoyo

    private static func unaRespuesta(_ prompt: String, lineas: Int, en funcion: String, instrucciones: String) async -> String? {
        let sesion = LanguageModelSession(model: modelo, instructions: instrucciones)
        do {
            let r = try await sesion.respond(to: prompt, options: GenerationOptions(temperature: 0.3,
                                                                                     maximumResponseTokens: 60 * lineas))
            let texto = r.content.split(whereSeparator: \.isNewline)
                .map { TextoIA.limpio(String($0)) }
                .filter { !$0.isEmpty }
                .prefix(lineas)
                .joined(separator: "\n")
            return texto.isEmpty ? nil : texto
        } catch {
            registrar(error, en: funcion)
            return nil
        }
    }

    private static func describir(_ p: NuevaPaciente) -> String {
        var partes = [[p.nombre, p.apellidoPaterno, p.apellidoMaterno].compactMap { $0 }.joined(separator: " ")]
        if let n = p.nacimiento { partes.append("nacida \(n)") }
        if let e = p.edad { partes.append("\(e) años") }
        if !p.comunidad.isEmpty { partes.append("comunidad \(p.comunidad)") }
        if let m = p.municipio { partes.append("municipio \(m)") }
        return partes.joined(separator: ", ")
    }

    /// Solo el tipo de error: nunca se registran datos de la paciente.
    private static func registrar(_ error: any Error, en funcion: String) {
        let tipo: String
        if let e = error as? LanguageModelSession.GenerationError {
            switch e {
            case .guardrailViolation: tipo = "guardrail"
            case .exceededContextWindowSize: tipo = "contexto excedido"
            case .unsupportedLanguageOrLocale: tipo = "idioma no soportado"
            case .assetsUnavailable: tipo = "modelo no disponible"
            case .decodingFailure: tipo = "no se pudo decodificar"
            case .refusal: tipo = "el modelo se negó"
            case .rateLimited, .concurrentRequests: tipo = "ocupado"
            default: tipo = "otro"
            }
        } else {
            tipo = String(describing: type(of: error))
        }
        log.error("\(funcion, privacy: .public) falló: \(tipo, privacy: .public)")
    }
}

