// asistente: lee de stdin {"pregunta": "...", "contexto": "..."} y escribe a stdout {"respuesta": "..."}.
// El contexto lo arma la API con las cifras ya calculadas; el modelo solo redacta.
// Todo corre en esta Mac con Foundation Models: nada sale a la nube.
//
// Con {"calentar": true} hace una llamada mínima para que el sistema cargue el modelo.
//
// Códigos de salida:
//   0 ok · 1 otro error · 2 entrada inválida · 3 modelo no disponible
//   4 guardrail o el modelo se negó · 5 contexto demasiado largo
import Foundation
import FoundationModels

struct Entrada: Decodable {
    var pregunta: String?
    var contexto: String?
    var calentar: Bool?
}

struct Salida: Encodable { var respuesta: String }
struct Falla: Encodable { var error: String }

func salir(_ codigo: Int32, error: String) -> Never {
    if let d = try? JSONEncoder().encode(Falla(error: error)) {
        FileHandle.standardError.write(d)
        FileHandle.standardError.write(Data("\n".utf8))
    }
    exit(codigo)
}

let instrucciones = """
    Eres el asistente de Coordinación de EIRA Movimiento Rosa, que hace jornadas de tamizaje de cáncer \
    de mama y cervicouterino en comunidades rurales de México. Respondes preguntas con los datos que te da \
    el sistema en DATOS.
    Reglas:
    - Si DATOS trae RESPUESTA CALCULADA, tu respuesta es esa misma información redactada con naturalidad: \
    los mismos folios y las mismas cifras, en el mismo orden. No agregues ni quites folios ni cifras.
    - Si no hay RESPUESTA CALCULADA, responde solo con lo que está en las otras secciones de DATOS.
    - No cuentes, no sumes, no restes ni calcules nada. Copia cada cifra tal como viene. No escribas ningún \
    número que no aparezca en DATOS.
    - Cita los folios exactamente como aparecen, por ejemplo JUX-007.
    - Responde en español de México, de tú, en 1 a 3 frases cortas. Empieza directo con la respuesta, \
    sin saludo, sin listas y sin formato.
    - No des diagnósticos, interpretaciones médicas ni recomendaciones clínicas.
    - Solo cuando lo que preguntan no aparece en DATOS, responde: No tengo ese dato.
    """

// MARK: - Entrada

let crudo = FileHandle.standardInput.readDataToEndOfFile()
guard let entrada = try? JSONDecoder().decode(Entrada.self, from: crudo) else {
    salir(2, error: "entrada inválida: se espera JSON {pregunta, contexto}")
}

// MARK: - Modelo

let sistema = SystemLanguageModel.default
guard case .available = sistema.availability else {
    salir(3, error: "modelo no disponible: \(sistema.availability)")
}
guard sistema.supportedLanguages.contains(where: { $0.languageCode == .spanish }) else {
    salir(3, error: "el modelo no tiene español en esta Mac")
}
// Misma guardrail que la app: pensada para transformar texto que da el usuario.
// Los datos de salud disparan menos falsos positivos así.
let modelo = SystemLanguageModel(guardrails: .permissiveContentTransformations)

func codigo(de error: any Error) -> (Int32, String) {
    guard let e = error as? LanguageModelSession.GenerationError else {
        return (1, String(describing: type(of: error)))
    }
    switch e {
    case .guardrailViolation: return (4, "guardrail")
    case .refusal: return (4, "el modelo se negó")
    case .exceededContextWindowSize: return (5, "contexto excedido")
    case .assetsUnavailable: return (3, "modelo no disponible")
    case .unsupportedLanguageOrLocale: return (3, "idioma no soportado")
    case .rateLimited, .concurrentRequests: return (1, "ocupado")
    default: return (1, "otro")
    }
}

if entrada.calentar == true {
    let sesion = LanguageModelSession(model: modelo)
    sesion.prewarm()
    do {
        _ = try await sesion.respond(to: "Responde solo: listo", options: GenerationOptions(samplingMode: .greedy, maximumResponseTokens: 4))
        if let d = try? JSONEncoder().encode(Salida(respuesta: "listo")) { FileHandle.standardOutput.write(d) }
        exit(0)
    } catch {
        let (c, m) = codigo(de: error)
        salir(c, error: m)
    }
}

let pregunta = (entrada.pregunta ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
let contexto = (entrada.contexto ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
guard !pregunta.isEmpty else { salir(2, error: "falta la pregunta") }

let sesion = LanguageModelSession(model: modelo, instructions: instrucciones)
let prompt = "DATOS:\n\(contexto.isEmpty ? "(sin datos)" : contexto)\n\nPREGUNTA: \(pregunta)"

do {
    let r = try await sesion.respond(to: prompt, options: GenerationOptions(samplingMode: .greedy, maximumResponseTokens: 220))
    // Una sola línea, sin el formato que a veces agrega el modelo.
    let texto = r.content
        .replacingOccurrences(of: "**", with: "")
        .replacingOccurrences(of: "\n- ", with: " ")
        .split(whereSeparator: \.isNewline)
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
        .joined(separator: " ")
    // A veces antepone «Tengo ese dato.» o «Tengo los datos de X:»: sobra.
    let limpio = texto.replacingOccurrences(of: #"^(Sí,?\s*)?[Tt]engo (ese dato|el dato|los datos)[^.:]*[.:]\s*"#, with: "", options: .regularExpression)
    guard !limpio.isEmpty else { salir(1, error: "respuesta vacía") }
    let d = try JSONEncoder().encode(Salida(respuesta: limpio))
    FileHandle.standardOutput.write(d)
    exit(0)
} catch {
    let (c, m) = codigo(de: error)
    salir(c, error: m)
}
