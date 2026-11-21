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

// Sync/ (Agente 1) — todo @MainActor salvo ClienteAPI
@MainActor @Observable final class Sincronizador {
  init(contexto: ModelContext, api: ClienteAPI = ClienteAPI(), autor: String = Config.dispositivo, vigilarRed: Bool = true)
  var enLinea: Bool { get }           // NWPathMonitor && !simularSinSenal
  var pendientes: Int; var ultimaSync: Date?; var sincronizando: Bool; var ultimoError: String?; var rechazados: Int  // solo lectura
  var simularSinSenal: Bool           // demo: corta la «señal»; al apagarlo sincroniza solo si sincronizarAlVolver
  var sincronizarAlVolver: Bool       // default true
  var repositorio: Repositorio { get }  // usa este: actualiza `pendientes` en cada alta/estudio
  @discardableResult func prepararJornada(comunidad: String) async throws -> Int  // baja pacientes+estudios; no duplica
  @discardableResult func sincronizar() async throws -> ResultadoSync  // lotes de 100; borra solo lo confirmado
  func actualizarPendientes()
}
@MainActor struct Repositorio {
  init(contexto: ModelContext, autor: String = Config.dispositivo, alCambiar: (@MainActor () -> Void)? = nil)
  @discardableResult func alta(_ p: NuevaPaciente, firma: Data) throws -> Paciente  // guarda + encola evento; lanza Repositorio.Falla
  @discardableResult func agregarEstudio(_ e: NuevoEstudio, a p: Paciente) throws -> Estudio
  func historial(de p: Paciente) -> [Estudio]            // más reciente primero
  func pacientes(comunidad: String? = nil) -> [Paciente]  // para Coincidencias.buscar (sin fusionadas)
}
struct ClienteAPI: Sendable {      // init(base: URL = Config.apiURL)
  func duplicados() async throws -> [ParDuplicado]; func resolver(_ par: ParDuplicado, unir: Bool) async throws
  func salud() async -> Bool
}
enum ErrorSync: LocalizedError { sinSenal, sinServidor, rechazado, respuestaIncompleta, enCurso, parInvalido }  // textos en español

// Coincidencias/ (Agente 2)
enum Coincidencias { static func buscar(_ q: NuevaPaciente, en: [Paciente]) -> [Candidata] }  // Candidata: paciente, puntaje, razones

// Inteligencia/ (Agente 3), todo opcional: si el modelo no está, devuelve nil y la UI sigue
enum Inteligencia {
  static var disponible: Bool                // modelo .available y con español
  static var motivo: String                  // por qué no hay modelo, para mostrar o loguear
  static func precalentar()                  // llamar al abrir Escanear/Buscar: en frío la 1ª respuesta tarda ~30 s, luego ~4 s
  static func leerHoja(_ imagen: UIImage) async throws -> HojaLeida        // lanza solo si Vision falla
  @MainActor static func explicar(_ c: Candidata, para q: NuevaPaciente) async -> String?   // 1 línea
  @MainActor static func resumir(_ estudios: [Estudio]) async -> String?                   // ≤ 3 líneas
  static func dictarEstudio(_ texto: String) async -> NuevoEstudio?        // fecha = hoy
}
struct HojaLeida { var textoCrudo: String; var paciente: NuevaPaciente?; var estudios: [NuevoEstudio]; var leidaPorModelo: Bool }
// Sin modelo: leerHoja trae solo textoCrudo (paciente nil, estudios []); lo demás devuelve nil.
```

## Fase 0: esqueleto (un agente, ~15 min, bloquea a los demás)

- [ ] **0.1** `ios/project.yml` (XcodeGen, iOS 26, bundle `org.eira.expedienterosa`), target app + target tests. `xcodegen && xcodebuild build` pasa.
- [ ] **0.2** `ios/ExpedienteRosa/Modelo/`: modelos SwiftData, `Rol`, DTOs `Codable` iguales a los esquemas zod de `api/src/index.ts`.
- [ ] **0.3** `ContentView` mínima, que Jorge reemplaza.

Verificación: `cd ios && xcodegen && xcodebuild -scheme ExpedienteRosa -destination 'platform=iOS Simulator,name=iPhone 17' build`.

## Fase 1: en paralelo

### Carril A: Datos y sync (`ios/ExpedienteRosa/Sync/`)
- [x] **A1** `Repositorio`: alta guarda paciente + `EventoPendiente` con llave UUID en la misma transacción.
- [x] **A2** `Sincronizador`: estado de red con `NWPathMonitor`; manda la cola en lotes de 100 a `POST /api/sync`; borra solo lo que el servidor confirmó.
- [x] **A3** `prepararJornada`: `GET /api/pacientes?comunidad=` → SwiftData (sin duplicar si ya existen).
- [x] **A4** `ClienteAPI` de duplicados y resolver.
- [x] **A5** Test: 3 altas en «modo avión» (servidor caído), se levanta el servidor, `sincronizar()`, Valkey tiene 3, y repetir no duplica.

Verificación: XCTest de A5 contra `docker compose up` local.

### Carril B: Coincidencias en Swift (`ios/ExpedienteRosa/Coincidencias/`)
- [x] **B1** Puerto exacto de `api/src/coincidencias.ts` (normalizar, fonética, Jaro-Winkler, comparar, umbral 0.82).
- [x] **B2** XCTest con los mismos 4 casos de `api/test/coincidencias.test.ts` y el mismo resultado.
- [x] **B3** 10 casos más de nombres mexicanos (Ma./María, Hdz, b/v, s/z, sin materno, madre/hija), agregados también al test de TS.

Verificación: `xcodebuild test` y `cd api && pnpm vitest run`, los dos en verde.

### Carril C: Valkey a fondo (`api/`)
- [x] **C1** Seguimiento de anormales: estudio `anormal` → sorted set `seguimiento` con fecha límite (+15 días); `GET /api/seguimiento` vencidos primero. Es el enlace a tratamiento que EIRA dijo que es su valor.
- [x] **C2** Tablero en vivo: `GET /api/jornada/:comunidad/en-vivo` (SSE) con pub/sub de Valkey: altas, estudios por tipo y duplicados del día.
- [x] **C3** Cifrar `nota` y `consentimiento` en reposo (AES-GCM, llave en env).
- [x] **C4** Experimento: imagen `valkey/valkey-bundle` con valkey-search para buscar pacientes por similitud. Si en 40 min no sale, se descarta y se anota por qué. (Salió, opcional: `docker-compose.bundle.yml`.)
- [x] **C5** `api/test/sync.test.ts`: idempotencia, duplicado detectado, unir mueve estudios.

Verificación: `pnpm vitest run` con Valkey arriba.

### Carril D: Foundation Models + Vision (`ios/ExpedienteRosa/Inteligencia/`)
- [x] **D1** `Inteligencia.disponible` con `SystemLanguageModel.default.availability` y `supportedLanguages` contiene español.
- [x] **D2** `leerHoja`: Vision `VNRecognizeTextRequest` (es-MX) → `LanguageModelSession.respond(generating: HojaLeida.self)` con `@Generable`.
- [x] **D3** `explicar` y `resumir`: prompts cortos, salida de una o tres líneas; si el modelo lanza error (guardrail o contexto), devuelve nil.
- [x] **D4** `dictarEstudio`: texto dictado («mastografía normal, regresa en un año») → `NuevoEstudio` con `@Generable`.
- [x] **D5** 3 hojas de papel ficticias como imagen en `ios/ExpedienteRosaTests/Hojas/` y un test que corre si el modelo está disponible y se salta si no.

Verificación: test D5 en Mac o iPhone con Apple Intelligence; anota en la bitácora en qué dispositivo corrió.

### Carril E: Entrega (`README.md`, `seed/`, `docs/`)
- [x] **E1** `seed/pacientes.json`: 40 pacientes ficticias de 3 comunidades, con 6 pares de la misma señora escrita distinto y 2 madre/hija con el mismo nombre. `pnpm seed` las carga a Valkey.
- [x] **E2** README: qué es, cómo correr API + Valkey (`docker compose up`), cómo correr la app, credenciales (ninguna), licencia MIT.
- [x] **E3** `docs/devpost.md` y `docs/pitch.md` (guion de 2 min sin frases de anuncio, ver SPEC «Lo que la demo tiene que probar»).
- [ ] **E4** Despliegue de API + Valkey en un EC2 con HTTPS (`<ip>.sslip.io` + Caddy) para que el iPhone llegue desde el evento.

## Fase 2: integración (cuando Jorge tenga la UI)

- [ ] Conectar pantallas al contrato: Buscar → `Coincidencias` + `Inteligencia.explicar`; Alta → `Repositorio.alta`; Expediente → `historial` + `resumir`; Escanear → `leerHoja`.
- [ ] Ensayo de la demo en modo avión con iPhone + simulador.
- [ ] Grabar video de respaldo.

## Pedidos entre carriles

- Carril E → Jorge: E4 espera OK de Jorge para cuenta AWS.
- Carril D → Jorge (Escanear): mostrar siempre `hoja.textoCrudo` junto a los campos prellenados; si `paciente` es nil (sin modelo) la enfermera captura a mano. Campos vacíos ("") = el modelo no los encontró en el papel. Llamar `Inteligencia.precalentar()` en `.onAppear`.
- Carril E → quien tenga la raíz: `docker compose up` con el `api` en contenedor crea `api/.pnpm-store/` (71 MB) dentro del repo. Agregar `.pnpm-store` a `.gitignore`. También: el seed corre desde el host (`cd api && pnpm seed`), porque el contenedor no monta `seed/`; si se quiere `docker compose exec api pnpm seed`, montar `./seed:/seed` en `docker-compose.yml`.

## Bitácora

| Hora | Agente | Tarea | Verificación |
|---|---|---|---|
| 10:30 | Claude | API + Valkey + coincidencias.ts | vitest 4/4; sync, idempotencia, duplicado y unir probados con curl contra Valkey |
| 10:50 | Carril E | E1 seed (40 pacientes, 48 estudios, 3 comunidades) | `pnpm seed` vía `POST /api/sync`: aplicados 88, posibles duplicados 6; los 6 pares en `/api/duplicados` (puntaje 1), madre/hija fuera (0.75). 2ª corrida: aplicados 0, repetidos 88. `/api/estadisticas` → pacientes 42 (40 + 2 de prueba previas), duplicadosPendientes 6, eventos 92 |
| 10:52 | Carril B | B1 puerto Swift (`Coincidencias/Coincidencias.swift` puro + `Coincidencias+Paciente.swift` con `buscar`/`Candidata`) | `swiftc` del archivo puro + mismo `casos.json` que `npx tsx`: `diff` vacío en 39 líneas (15 puntajes a 3 decimales, razones, llaves de bloque, normalizar, Jaro-Winkler a 6 decimales, fonética). `xcodebuild build` → BUILD SUCCEEDED, sin warnings |
| 10:52 | Carril B | B2 `ExpedienteRosaTests/CoincidenciasTests.swift` (4 casos TS + piezas + `buscar`) | `build-for-testing` → TEST BUILD SUCCEEDED. No se corrió `xcodebuild test` (el runner se traba en esta Mac); los valores esperados son los mismos que dio el ejecutable `swiftc` |
| 10:52 | Carril B | B3 10 casos mexicanos en Swift y TS (Ma./María, Hdz, Mtz/Glz, b/v ×2, s/z, s/z/c sin materno, sin materno, madre/hija) | `pnpm vitest run` → 22/22 (coincidencias 14). Sin cambios al algoritmo. Falso positivo conocido, no está en tests: hermanas «María» y «Ana» López Cruz, 34/35 años, misma comunidad → 0.829 (≥ 0.82) |
| 10:53 | Carril C | C1 seguimiento de anormales (sorted set `seguimiento`, score = fecha del estudio + 15 días) | `sync.test.ts`: dos anormales (hace 20 y hace 1 día) salen vencido primero, límite exacto +15 d, `atendido` lo saca (2ª vez 404); unir mueve el seguimiento a la paciente que queda. curl contra instancia propia en :8788 (DB 14) → `vencido: true, diasRestantes: -5` |
| 10:53 | Carril C | C2 tablero en vivo: hash `jornada:<comunidad>:<día CDMX>` (HINCRBY) + PUBLISH `canal:jornada:<comunidad>`; SSE con un solo suscriptor compartido | test lee el SSE con `app.request`: llega `event: estado` y luego `event: alta` con el conteo. curl -N en :8788 recibió `estado`, `alta` y `estudio` en vivo |
| 10:53 | Carril C | C3 AES-256-GCM en `consentimiento` (hash) y `nota` (JSON del estudio), llave `CLAVE_DATOS` en `.env.example` | test: en Valkey ambos empiezan con `enc:v1:` y no contienen el texto; la API los devuelve en claro. Sin llave arranca y avisa en el log. Lee datos viejos en claro sin romper |
| 10:53 | Carril C | C4 valkey-search: sale. KNN sobre vectores de trigramas fonéticos (128 dims, sin modelo) en `buscar:paciente:<id>`, `GET /api/buscar`; con `valkey:8` cae a los sets de bloque | con `valkey/valkey-bundle:8` (search 1.0.3) en :6380: «Ma. Lupe Hdz Belasquez» → María Guadalupe Hernández Velázquez a distancia 0. `busqueda.test.ts` pasa con bundle y se salta sin él. Opcional vía `docker-compose.bundle.yml`; el compose principal no cambió. Límite: search 1.0 no tiene texto completo ni filtros sin KNN |
| 10:53 | Carril C | C5 `api/test/sync.test.ts` (DB 15, se limpia) | `pnpm vitest run` → 24/24 con bundle arriba (23 + 1 saltado sin bundle); `tsc --noEmit` limpio. **La API en :8787 corre código viejo: hay que reiniciarla** para tener C1–C4; al arrancar `preparar()` mete al seguimiento los anormales ya cargados y crea los vectores (una vez) |
| 10:58 | Carril E | E2 README completo (problema, qué hace, arquitectura, correr API+Valkey, seed, app iOS con XcodeGen, modo sin señal, credenciales, privacidad, MIT). LICENSE MIT ya existía | Probé el camino del README: el contenedor `node:20-alpine` del compose **fallaba** (corepack bajaba pnpm 12, que rechaza el lockfile por `minimumReleaseAge`: rollup 4.68.8 salió hoy). Fijé `"packageManager": "pnpm@10.33.2"` en `api/package.json` y volvió a arrancar: `/api/estadisticas` respondió desde el contenedor. `/api/buscar` del ejemplo probado en una API temporal en :8789 |
| 11:05 | Carril E | E3 `docs/devpost.md` (7 secciones) y `docs/pitch.md` (2:00 con tiempos, recorre los 4 puntos de EIRA con Eulalia García Luna del seed escrita «Garsia», + plan B) | Revisados con la skill humanizer (sin guiones largos, sin remates). Búsqueda del pitch comprobada contra `comparar`: «Eulalia Garsia Luna, 67» → 1.0 contra la del seed; ~300 palabras habladas. Ojo: describe Escanear hoja y Foundation Models según SPEC; Carril D aún sin marcar |
| 11:10 | Carril A | A1 `Repositorio` (alta/agregarEstudio guardan registro + `EventoPendiente` en un solo `save()`, validan lo mismo que zod: firma, nombre, comunidad, nacimiento AAAA-MM-DD, edad 0–120, nota ≤500) | `xcodebuild build` (dd-carril-a) → BUILD SUCCEEDED, 0 warnings con strict concurrency. Arnés macOS que compila `Modelo/*.swift + Sync/*.swift` reales: alta sin firma y nacimiento «02/03/1979» se rechazan y dejan la cola en 0; 3 altas + 1 estudio → pendientes 4 |
| 11:10 | Carril A | A2 `Sincronizador` (NWPathMonitor + `simularSinSenal` para la demo, lotes de 100 por `creado`, borra solo si aplicados+repetidos = tamaño del lote; si el servidor da 400 manda uno por uno y deja guardado el malo) | Arnés contra la API en :8787: servidor caído (127.0.0.1:1) → `sinServidor`, pendientes siguen en 4; API arriba → 4 aplicados, cola 0; 250 eventos → 250 aplicados en 3 lotes; evento con tipo inválido → el bueno pasa, el malo queda (`rechazados` 1) |
| 11:10 | Carril A | A3 `prepararJornada` (upsert por id de pacientes y estudios; no pisa la firma local; lee ISO con/sin ms y «YYYY-MM-DD») | Teléfono limpio: 1ª vez 3 pacientes y 252 estudios, 2ª vez 3 y 252. En el teléfono que dio de alta: siguen 3 y la firma intacta |
| 11:10 | Carril A | A4 `ClienteAPI` (duplicados, resolver, salud, pacientes, sincronizar; ids del par desde las fichas o desde la llave `duplicado:a\|b`) | `duplicados()` trajo el par ficticio Rosalba Quintero Ibarra / Rosalva Quinteros Ybarra (1.0, «nombre parecido, apellido paterno parecido, misma fecha de nacimiento, misma comunidad»); `resolver(separar)` lo sacó de la cola y Valkey tiene `distintas:<id>` en las dos |
| 11:10 | Carril A | A5 `ExpedienteRosaTests/SyncTests.swift` (5 tests: A1, sin firma, historial, importar sin duplicar, 3 altas sin servidor → sync → repetir) | `build-for-testing` → TEST BUILD SUCCEEDED. `test-without-building` no corre: «DTServiceHubClient failed to bless service hub» del simulador. El mismo escenario corrió real en el arnés macOS: 1ª sync 4 aplicados; reenviar las mismas llaves → 0 aplicados, 4 repetidos. Valkey: `pacientes:comunidad:prueba-carrila` = 3, `llen` estudios 249/1/2 (=252 enviados), 255 llaves `sync:envio` del dispositivo (= eventos enviados, sin duplicar). Datos de prueba borrados después (`scard pacientes` volvió a 42) |
| 11:15 | Carril D | D1 `disponible` (availability + `supportedLanguages` con `.spanish`) y `motivo` | En la Mac (macOS 27.2, Apple Intelligence): `disponible: true`, idiomas es `es-Latn-US/ES/419`. `xcodebuild build` (dd-carril-d) → BUILD SUCCEEDED, sin warnings en `Inteligencia/` |
| 11:15 | Carril D | D2 `leerHoja`: Vision Swift `RecognizeTextRequest` (es-MX → es-419 → es-ES, por renglones) → `respond(generating: HojaGenerada.self)` greedy → `RevisionHoja` (descarta lo que no está en el papel, parte el nombre con el renglón completo, fechas DD/MM, corrige resultado con el renglón, quita firmas de la nota) | Ejecutable `swiftc` en macOS con los archivos reales de `Inteligencia/`: las 3 hojas salen completas y estables en 2 corridas (≈4 s cada una; 34 s la primera en frío). Sin la revisión el modelo cortó «María Guadalupe» a «María», inventó materno «Cruz» y nacimiento «1970-05-11», volteó 05/11 → 11-may y marcó **normal** un ultrasonido ANORMAL |
| 11:15 | Carril D | D3 `explicar` (1 línea) y `resumir` (≤ 3 líneas), errores → nil y log solo con el tipo de error | Mac: explicar → «Ma. Guadalupe y María Guadalupe; misma comunidad; la edad difiere 2 años.»; resumir de 4 estudios → 3 líneas (ultrasonido anormal 2024-03-12, papanicolaou pendiente, mastografía normal) |
| 11:15 | Carril D | D4 `dictarEstudio` con `@Generable EstudioDictado` | Mac: «mastografía normal, regresa en un año» → mastografia / normal / nota «regresa en un año» |
| 11:15 | Carril D | D5 `ExpedienteRosaTests/Hojas/hoja1-3.png` (dibujadas con Swift/AppKit: molde, letra a mano, libreta; nombres ficticios) + `InteligenciaTests.swift` (6 tests, los de modelo con XCTSkip) | iOS: `build-for-testing` → TEST BUILD SUCCEEDED, las 3 PNG dentro del `.xctest`. No corrí `xcodebuild test` (se traba). El **mismo archivo** compilado como bundle macOS y corrido con `xcrun xctest` en la Mac (macOS 27.2, Apple Intelligence): 6 ejecutados, 5 pasan, 1 saltado (`testSinModeloTodoDevuelveNil`, porque sí hay modelo), 0 fallas, 41 s. No corrió en iPhone |
| 11:20 | Carril C | Reto 1 oficial de EIRA en la API: visitas (`visita:<id>` + `paciente:<id>:visitas`), `clasificacion`/`conducta`/`visitaId` en estudio, `entidadNacimiento`/`idEira`/`version` en paciente, regla de seguimiento (BI-RADS 4-5/anormal 15 d, BI-RADS 3 6 meses), ajuste de entidad solo en servidor (−0.1), evento `actualizacion` con versión (Lua) y `/conflictos`, `/bitacora` sin datos clínicos | `test/reto1.test.ts` (DB 14, se limpia): 12/12. `pnpm vitest run` → 34 pasan, 1 saltada, 1 falla **previa** (`sync.test.ts` C4 espera motor `bloques`, pero el Valkey de 6379 ya es valkey-bundle y valkey-search no ve la DB 15). `tsc --noEmit` limpio. curl en :8788 (DB 14): alta+visita+estudio BI-RADS 4+actualización → aplicados 4; 2º teléfono con versionBase 1 → `conflictos:[{campos:[edad]}]`; aceptar → version 3; seguimiento `BI-RADS 4`, 15 días; bitácora con 6 entradas y autor/dispositivo. DB 14 vaciada, :8787 intacta. **:8787 corre código viejo: reiniciarla para tener Reto 1** |
| 12:02 | Carril C | Brigada: `Visita.estado?`/`jornada?`, `Estudio.etapa?` (deducida al leer si falta), `GET /patologia` (sorted set `patologia:pendientes`), `POST /estudios/:id/interpretacion` (CAS en Lua sobre la lista, seguimiento a 15 días si anormal o Bethesda ≠ Negativa, bitácora sin datos clínicos), `POST /estudios/:id/avisado`, `GET /resumen` (por estado y comunidad, pipelines), `/panel` estático (`serveStatic`, monta `./panel` en compose). Seed: una visita con `estado`+`jornada` por paciente y día; 3 papanicolaous nuevos → 7 en laboratorio | `test/brigada.test.ts` (DB 13, se limpia): 7/7. `pnpm vitest run` → 42 pasan, 1 saltada (bundle en :6380). `tsc --noEmit` limpio. API temporal en :8788 + DB 13: seed 131 aplicados, 6 pares ok, 2ª corrida 131 repetidos; `/resumen` → 40 personas, Guerrero 14 · Jalisco 14 · Oaxaca 12, 7 pendientes de patología; interpretar HSIL → seguimiento, 2ª vez 409, avisado ok, bitácora `interpretacion`/`avisado`; `/panel` 302 → `/panel/` 200. DB 13 vaciada, :8787 intacta. **:8787 corre código viejo: reiniciarla (y correr `pnpm seed` para tener visitas con estado y los 3 papanicolaous nuevos)** |
