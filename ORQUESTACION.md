# Orquestación: quién hace qué y qué sigue

El problema y las pantallas están en `SPEC.md`. Este archivo dice el orden de trabajo. **Cada agente, al terminar su tarea, marca `[x]`, escribe una línea en la bitácora de abajo y toma la siguiente tarea libre de su carril.**

## Reglas para todos los agentes

1. **La UI es de Jorge.** Ningún agente crea ni edita vistas SwiftUI (`ios/ExpedienteRosa/Pantallas/`). Si necesitas una pantalla para probar, haz un test o un `#Preview` aparte en tu carpeta.
2. Cada agente trabaja **solo en su carpeta**. Si necesitas algo de otra carpeta, escríbelo en «Pedidos» abajo y sigue con otra cosa.
3. Lo que expongas para la UI va en el **contrato** (sección de abajo): nombres de tipos y funciones. Si lo cambias, actualiza el contrato en el mismo commit.
4. «Terminado» quiere decir que corriste la verificación de tu tarea y pegaste la salida en la bitácora. Que compile no basta.
5. Datos siempre ficticios. Nada de nombres reales.
6. Commits chicos en `main`, con mensaje en español.

## Contrato para la UI de Jorge (lo que los agentes le entregan)

```swift
// Modelo/ (Agente 0)
@Model Paciente      // id, folio, nombre, apellidoPaterno, apellidoMaterno?, nacimiento?, edad?, comunidad, consentimientoFirmado: Data, creada
@Model Estudio       // id, pacienteId, tipo: TipoEstudio, fecha, resultado: Resultado, nota?
@Model EventoPendiente // llave, tipo, payload, creado
enum Rol { case enfermeria, medico, coordinadora }

// Sync/ (Agente 1)
@Observable final class Sincronizador {
  var enLinea: Bool; var pendientes: Int; var ultimaSync: Date?
  func prepararJornada(comunidad: String) async throws   // baja pacientes de esa comunidad
  func sincronizar() async throws -> ResultadoSync       // aplicados, repetidos, posiblesDuplicados
}
struct Repositorio {
  func alta(_ p: NuevaPaciente, firma: Data) throws -> Paciente  // guarda + encola evento
  func agregarEstudio(_ e: NuevoEstudio, a p: Paciente) throws
  func historial(de p: Paciente) -> [Estudio]
}
struct ClienteAPI { func duplicados() async throws -> [ParDuplicado]; func resolver(_ par: ParDuplicado, unir: Bool) async throws }

// Coincidencias/ (Agente 2)
enum Coincidencias { static func buscar(_ q: NuevaPaciente, en: [Paciente]) -> [Candidata] }  // Candidata: paciente, puntaje, razones

// Inteligencia/ (Agente 3), todo opcional: si el modelo no está, devuelve nil y la UI sigue
enum Inteligencia {
  static var disponible: Bool
  static func leerHoja(_ imagen: UIImage) async throws -> HojaLeida        // paciente + estudios previos, para que la enfermera revise
  static func explicar(_ c: Candidata, para q: NuevaPaciente) async -> String?
  static func resumir(_ estudios: [Estudio]) async -> String?
  static func dictarEstudio(_ texto: String) async -> NuevoEstudio?
}
```

## Fase 0: esqueleto (un agente, ~15 min, bloquea a los demás)

- [ ] **0.1** `ios/project.yml` (XcodeGen, iOS 26, bundle `org.eira.expedienterosa`), target app + target tests. `xcodegen && xcodebuild build` pasa.
- [ ] **0.2** `ios/ExpedienteRosa/Modelo/`: modelos SwiftData, `Rol`, DTOs `Codable` iguales a los esquemas zod de `api/src/index.ts`.
- [ ] **0.3** `ContentView` mínima, que Jorge reemplaza.

Verificación: `cd ios && xcodegen && xcodebuild -scheme ExpedienteRosa -destination 'platform=iOS Simulator,name=iPhone 17' build`.

## Fase 1: en paralelo

### Carril A: Datos y sync (`ios/ExpedienteRosa/Sync/`)
- [ ] **A1** `Repositorio`: alta guarda paciente + `EventoPendiente` con llave UUID en la misma transacción.
- [ ] **A2** `Sincronizador`: estado de red con `NWPathMonitor`; manda la cola en lotes de 100 a `POST /api/sync`; borra solo lo que el servidor confirmó.
- [ ] **A3** `prepararJornada`: `GET /api/pacientes?comunidad=` → SwiftData (sin duplicar si ya existen).
- [ ] **A4** `ClienteAPI` de duplicados y resolver.
- [ ] **A5** Test: 3 altas en «modo avión» (servidor caído), se levanta el servidor, `sincronizar()`, Valkey tiene 3, y repetir no duplica.

Verificación: XCTest de A5 contra `docker compose up` local.

### Carril B: Coincidencias en Swift (`ios/ExpedienteRosa/Coincidencias/`)
- [ ] **B1** Puerto exacto de `api/src/coincidencias.ts` (normalizar, fonética, Jaro-Winkler, comparar, umbral 0.82).
- [ ] **B2** XCTest con los mismos 4 casos de `api/test/coincidencias.test.ts` y el mismo resultado.
- [ ] **B3** 10 casos más de nombres mexicanos (Ma./María, Hdz, b/v, s/z, sin materno, madre/hija), agregados también al test de TS.

Verificación: `xcodebuild test` y `cd api && pnpm vitest run`, los dos en verde.

### Carril C: Valkey a fondo (`api/`)
- [ ] **C1** Seguimiento de anormales: estudio `anormal` → sorted set `seguimiento` con fecha límite (+15 días); `GET /api/seguimiento` vencidos primero. Es el enlace a tratamiento que EIRA dijo que es su valor.
- [ ] **C2** Tablero en vivo: `GET /api/jornada/:comunidad/en-vivo` (SSE) con pub/sub de Valkey: altas, estudios por tipo y duplicados del día.
- [ ] **C3** Cifrar `nota` y `consentimiento` en reposo (AES-GCM, llave en env).
- [ ] **C4** Experimento: imagen `valkey/valkey-bundle` con valkey-search para buscar pacientes por similitud. Si en 40 min no sale, se descarta y se anota por qué.
- [ ] **C5** `api/test/sync.test.ts`: idempotencia, duplicado detectado, unir mueve estudios.

Verificación: `pnpm vitest run` con Valkey arriba.

### Carril D: Foundation Models + Vision (`ios/ExpedienteRosa/Inteligencia/`)
- [ ] **D1** `Inteligencia.disponible` con `SystemLanguageModel.default.availability` y `supportedLanguages` contiene español.
- [ ] **D2** `leerHoja`: Vision `VNRecognizeTextRequest` (es-MX) → `LanguageModelSession.respond(generating: HojaLeida.self)` con `@Generable`.
- [ ] **D3** `explicar` y `resumir`: prompts cortos, salida de una o tres líneas; si el modelo lanza error (guardrail o contexto), devuelve nil.
- [ ] **D4** `dictarEstudio`: texto dictado («mastografía normal, regresa en un año») → `NuevoEstudio` con `@Generable`.
- [ ] **D5** 3 hojas de papel ficticias como imagen en `ios/ExpedienteRosaTests/Hojas/` y un test que corre si el modelo está disponible y se salta si no.

Verificación: test D5 en Mac o iPhone con Apple Intelligence; anota en la bitácora en qué dispositivo corrió.

### Carril E: Entrega (`README.md`, `seed/`, `docs/`)
- [ ] **E1** `seed/pacientes.json`: 40 pacientes ficticias de 3 comunidades, con 6 pares de la misma señora escrita distinto y 2 madre/hija con el mismo nombre. `pnpm seed` las carga a Valkey.
- [ ] **E2** README: qué es, cómo correr API + Valkey (`docker compose up`), cómo correr la app, credenciales (ninguna), licencia MIT.
- [ ] **E3** `docs/devpost.md` y `docs/pitch.md` (guion de 2 min sin frases de anuncio, ver SPEC «Lo que la demo tiene que probar»).
- [ ] **E4** Despliegue de API + Valkey en un EC2 con HTTPS (`<ip>.sslip.io` + Caddy) para que el iPhone llegue desde el evento.

## Fase 2: integración (cuando Jorge tenga la UI)

- [ ] Conectar pantallas al contrato: Buscar → `Coincidencias` + `Inteligencia.explicar`; Alta → `Repositorio.alta`; Expediente → `historial` + `resumir`; Escanear → `leerHoja`.
- [ ] Ensayo de la demo en modo avión con iPhone + simulador.
- [ ] Grabar video de respaldo.

## Pedidos entre carriles

(vacío)

## Bitácora

| Hora | Agente | Tarea | Verificación |
|---|---|---|---|
| 10:30 | Claude | API + Valkey + coincidencias.ts | vitest 4/4; sync, idempotencia, duplicado y unir probados con curl contra Valkey |
