# Expediente Rosa: definición del problema y reparto

## Problema (Reto 1 de EIRA)

- EIRA hace jornadas de tamizaje (mastografía, ultrasonido, papanicolaou) en comunidades rurales. Lleva ~80,000 estudios en 3 años.
- El equipo pasa **hasta 3 días sin señal**.
- Registran enfermería y médicos **en hojas de papel**. Digitalizarlas después sale caro y no llega a tiempo.
- Cuando una paciente regresa, la reconocen solo por su nombre y **nadie ve su historial**.

Queremos que una paciente que regresa sea reconocida aunque su nombre esté escrito distinto y que su historial esté a la mano, sin internet.

## Lo que la demo tiene que probar (lo pidió EIRA)

1. Alta de una paciente ficticia.
2. Búsqueda con detección de coincidencias.
3. Segunda visita con su historial.
4. Simulación verificable sin señal → sincroniza al volver.

## Usuarios (sin login: selector de rol arriba)

| Rol | Qué hace |
|---|---|
| Enfermería | Busca, da de alta, toma consentimiento firmado, escanea hojas viejas |
| Médico | Ve el expediente y el resumen, agrega estudios y resultados |
| Coordinadora | Revisa posibles duplicados del servidor: une o separa |

## Pantallas (app iOS, SwiftUI + SwiftData, iOS 26)

1. **Inicio:** rol, estado de señal, número de pendientes por sincronizar, botón «Preparar jornada» (baja las pacientes de la comunidad) y botón «Sincronizar».
2. **Buscar:** nombre, apellidos, edad o fecha y comunidad. Muestra coincidencias con puntaje y razones; si hay Foundation Models, una línea del modelo explica por qué. Desde ahí: «Es ella» → Expediente, o «Es nueva» → Alta.
3. **Alta + consentimiento:** campos mínimos, texto de consentimiento fijo y firma en pantalla (PencilKit). Sin firma no se guarda. Se genera ID (UUID) y folio corto sin señal.
4. **Escanear hoja:** foto → Vision (es-MX) → Foundation Models llena paciente + estudios previos → la enfermera revisa y confirma → Alta prellenada.
5. **Expediente:** datos, lista de estudios, resumen de 3 líneas (Foundation Models) y «Agregar estudio» (solo Médico).
6. **Duplicados:** cola de `/api/duplicados` con las dos fichas lado a lado y botones Unir / Son distintas.

Si Foundation Models no está disponible (simulador o iPhone sin Apple Intelligence), todo funciona igual, solo sin las líneas del modelo.

## Privacidad (criterio del jurado)

- Datos mínimos: no se piden dirección, teléfono ni CURP.
- Consentimiento expreso y firmado: la LFPDPPP 2025 lo pide así para datos de salud.
- La IA corre en el teléfono: los datos de salud no salen a la nube para usar el modelo.
- Cada rol ve solo lo que necesita: enfermería no ve resultados.
- Solo datos ficticios.

## Arquitectura

- **iOS:** SwiftData local + cola de eventos (`alta`, `estudio`), cada uno con una llave UUID única. `POST /api/sync` al volver la señal.
- **API** (`api/`, ya hecha y probada): Hono + Valkey.
  - Endpoints: `POST /api/sync`, `GET /api/pacientes?comunidad=`, `GET /api/pacientes/:id`, `GET /api/duplicados`, `POST /api/duplicados/resolver`, `GET /api/estadisticas`.
  - Valkey guarda pacientes (hash), estudios (lista), índice de coincidencias (sets por apellido fonético + año), envíos ya aplicados (`SET NX`), cola de duplicados (sorted set) y bitácora (stream).
- **Coincidencias:** `api/src/coincidencias.ts`. La versión Swift debe dar el mismo resultado; los casos de `api/test/coincidencias.test.ts` son la referencia.

## Fuera de alcance hoy

Login, WhatsApp, entrega de resultados en PDF (reto 4), panel web y despliegue en la nube (si sobra tiempo, la API va en un EC2).

## Reparto por agente (carpetas separadas, nadie pisa a otro)

| Agente | Carpeta | Entrega |
|---|---|---|
| 0. Esqueleto (yo, antes de repartir) | `ios/project.yml`, `ios/ExpedienteRosa/Modelo/` | Proyecto XcodeGen que compila, modelos SwiftData y contrato de la API en Swift |
| 1. Datos y sync | `ios/ExpedienteRosa/Sync/` | Cola de eventos, envío a `/api/sync`, «Preparar jornada», estado de señal |
| 2. Coincidencias Swift | `ios/ExpedienteRosa/Coincidencias/` | Puerto de `coincidencias.ts` con los mismos casos de prueba en XCTest |
| 3. Inteligencia | `ios/ExpedienteRosa/Inteligencia/` | Vision + Foundation Models: escanear hoja, explicar coincidencia, resumen de historial, con respaldo sin modelo |
| 4. Pantallas: **Jorge**, no un agente | `ios/ExpedienteRosa/Pantallas/` | Las 6 pantallas, selector de rol, consentimiento con firma |
| 5. Entrega | `README.md`, `seed/`, `docs/` | Datos ficticios (incluye pares de la misma señora escrita distinto), README para correrlo, texto de Devpost y guion del pitch de 2 min |

Orden: el 0 primero (15 min). Después 1, 2, 3 y 5 en paralelo. El 4 arranca con los modelos del 0 y conecta lo de los otros al final.

## Endpoints

Todos bajo `/api`. Los nuevos (Carril C) solo agregan; los contratos de `sync`, `pacientes` y `duplicados` no cambiaron.

| Método y ruta | Devuelve |
|---|---|
| `POST /sync` | `{ aplicados, repetidos, posiblesDuplicados[] }` |
| `GET /pacientes?comunidad=` · `GET /pacientes/:id` | Paciente(s) con `estudios[]` (nota y consentimiento ya descifrados) |
| `GET /duplicados` · `POST /duplicados/resolver` | Cola de pares `{ llave, puntaje, razones, a, b }` · `{ ok }` (unir también mueve el seguimiento) |
| `GET /seguimiento?comunidad=` | Estudios `anormal` sin atender, vencidos primero: `[{ estudioId, tipo, fecha, fechaLimite, vencido, diasRestantes, paciente{id, folio, nombre, apellidos, comunidad} }]`. Límite = fecha del estudio + 15 días. Valkey: sorted set `seguimiento` |
| `POST /seguimiento/:estudioId/atendido` | `{ ok }` y lo saca de la lista; 404 si no estaba |
| `GET /jornada/:comunidad?dia=AAAA-MM-DD` | Conteo del día (CDMX): `{ comunidad, dia, altas, estudios, porTipo{…}, anormales, duplicados }`. Valkey: hash `jornada:<comunidad>:<día>` |
| `GET /jornada/:comunidad/en-vivo` | SSE: `estado` al conectar; luego `alta`, `estudio` con el conteo nuevo; `latido` cada 15 s. Valkey: PUBLISH/SUBSCRIBE `canal:jornada:<comunidad>` |
| `GET /buscar?nombre=&apellidoPaterno=&apellidoMaterno=&edad=&nacimiento=&comunidad=&k=10` | `{ motor: 'valkey-search' \| 'bloques', resultados: [{ paciente, puntaje, razones, posible, distancia? }] }`. Con `valkey-bundle` usa KNN de valkey-search (`docker-compose.bundle.yml`); si no, los sets de bloque |
| `GET /estadisticas` | `{ pacientes, duplicadosPendientes, eventos, seguimientoPendiente, seguimientoVencido }` |
| `GET /salud` | `{ ok, valkey, cifrado }` |
| `GET /conflictos` | (Reto 1) Actualizaciones que no se aplicaron, más viejas primero: `[{ id, pacienteId, autor, dispositivo, creado, motivo: 'version-distinta' \| 'paciente-no-existe', versionBase, versionActual, campos: [{ campo, propuesto, actual, alRecibir }], paciente{id, folio, nombre, apellidoPaterno, apellidoMaterno, comunidad} }]`. Valkey: hash `conflicto:<id>` + sorted set `conflictos` (score = fecha) |
| `POST /conflictos/:id/resolver` | (Reto 1) Body `{ decision: 'aceptar' \| 'rechazar', autor? }` → `{ ok, version? }`. Aceptar aplica lo propuesto encima de lo actual y sube `version`; 404 si ya no está pendiente; 409 si la paciente no existe |
| `GET /bitacora?limite=50&pacienteId=` | (Reto 1) Stream `eventos` con XREVRANGE, más nuevo primero (limite 1–500): `[{ id, cuando, tipo, autor, dispositivo, pacienteId, otraPacienteId?, estudioId?, visitaId?, conflictoId?, campos?, version? }]`. `tipo`: alta, estudio, visita, actualizacion, conflicto, conflicto-aceptar, conflicto-rechazar, duplicado-unir, duplicado-separar, seguimiento-atendido. Sin datos clínicos: ni resultados, ni clasificación, ni notas, ni valores de campos (solo sus nombres) |

Cifrado en reposo: `consentimiento` y `nota` van con AES-256-GCM si hay `CLAVE_DATOS` (32 bytes base64); sin ella se guardan en claro y la API lo avisa en el log.

### Reto 1 (definición oficial de EIRA): campos y eventos nuevos

Todo es opcional y se agregó sin cambiar los contratos anteriores.

- `Paciente`: `entidadNacimiento?`, `idEira?` (texto). El servidor agrega `version` (entero, 1 en el alta; las pacientes viejas cuentan como 1).
- `Estudio`: `visitaId?`, `clasificacion?` (texto, p. ej. «BI-RADS 4», «Bethesda: LSIL»), `conducta?`: `rutina-1-anio` \| `mastografia-tamizaje` \| `imagen-complementaria` \| `evaluacion-6-meses` \| `referencia`.
- `GET /pacientes` y `GET /pacientes/:id` devuelven también `visitas[]` (ordenadas por fecha). Valkey: hash `visita:<id>` + sorted set `paciente:<id>:visitas` (score = fecha). Unir mueve también las visitas.
- `POST /sync` responde además `conflictos: [{ pacienteId, campos[] }]`.
- `GET /seguimiento` agrega `motivo` a cada fila. Regla: resultado `anormal`, BI-RADS 4 o 5, Bethesda anormal (ASC-US, ASC-H, LSIL, HSIL, AGC, carcinoma) o conducta `referencia` → 15 días; BI-RADS 3 o conducta `evaluacion-6-meses` → 6 meses.
- `GET /estadisticas` agrega `conflictosPendientes`. `POST /duplicados/resolver` y `POST /seguimiento/:id/atendido` aceptan `autor?` para la bitácora.
- Coincidencias: si las dos pacientes traen `entidadNacimiento` y es distinta, el par igual entra a la cola de duplicados, con 0.1 menos de puntaje y la razón «distinta entidad de nacimiento». **Es un ajuste solo del servidor** (`ajusteEntidad` en `api/src/index.ts`); `coincidencias.ts` y su gemelo Swift no cambiaron.

Eventos nuevos de `POST /sync`:

```json
{"tipo":"visita","llave":"<uuid>","visita":{"id":"<uuid>","pacienteId":"<uuid>","fecha":"2026-11-21T10:05:00-06:00","comunidad":"Tuxpan","motivo":"jornada de tamizaje","registradaPor":"enfermeria-1"}}
{"tipo":"actualizacion","llave":"<uuid>","actualizacion":{"pacienteId":"<uuid>","campos":{"edad":51,"idEira":"EIRA-1"},"versionBase":1,"autor":"enfermeria-1"}}
```

`campos` acepta solo: `nombre`, `apellidoPaterno`, `apellidoMaterno`, `nacimiento`, `edad`, `comunidad`, `municipio`, `entidadNacimiento`, `idEira` (no se puede borrar un campo, solo cambiarlo). Si `versionBase` es la versión actual, se aplican solo esos campos, `version` sube 1 y se mueven los índices (bloques, comunidad, vector). Si no, no se toca nada: queda en `/conflictos` para la coordinadora. La comparación y el cambio corren en un script Lua, así que dos envíos al mismo tiempo no se pisan.

### Brigada: estado, patología y resumen al regresar

Lo pidió EIRA: al volver una brigada quieren ver cuántas personas atendieron por estado, y el papanicolaou se toma en campo y lo interpreta un patólogo después. Todo es opcional o nuevo; ningún contrato anterior cambió.

- `Visita`: `estado?` (entidad federativa de la jornada, p. ej. «Jalisco») y `jornada?` (p. ej. «San Martín Peras · nov 2026»).
- **Estado efectivo** (para agregados): el de la visita del estudio; para la paciente, el de su visita más reciente que lo traiga; si no hay, lo que va después de la última coma en `municipio` («San Martín Peras, Oaxaca» → «Oaxaca»); si no, «Sin estado». Filtros sin distinguir mayúsculas ni acentos.
- `Estudio`: `etapa?`: `tomado` \| `en-laboratorio` \| `interpretado` \| `avisado`. Si no viene: papanicolaou `pendiente` → `en-laboratorio`; `normal`/`anormal` → `interpretado`; lo demás `pendiente` → `tomado`. Se guarda al sincronizar; los estudios viejos la reciben al leer, así que `GET /pacientes` ya la trae siempre. El servidor agrega después `interpretadoPor`, `interpretadoEn`, `cedula?`, `avisadoPor`, `avisadoEn`.
- Valkey: sorted set `patologia:pendientes` (score = fecha de toma) y hash `estudios:paciente` (estudioId → pacienteId). `preparar()` los llena una vez para lo ya cargado (bandera `migracion:patologia-v1`).

| Método y ruta | Devuelve |
|---|---|
| `GET /patologia?estado=&comunidad=` | Estudios en `en-laboratorio`, el que más espera primero: `[{ estudio{id, tipo, fecha, etapa}, paciente{id, folio, nombre, apellidoPaterno, apellidoMaterno, edad, comunidad}, estado, diasEsperando }]` |
| `POST /estudios/:id/interpretacion` | Body `{ resultado: 'normal' \| 'anormal', clasificacion?: string (Bethesda: «Negativa», «ASC-US», «LSIL», «HSIL», «ASC-H», «AGC», «Carcinoma»), nota?: string ≤500, patologo: string, cedula?: string }` → `{ ok, seguimiento, estudio }`. Guarda resultado, clasificación, nota (cifrada), `etapa: 'interpretado'`, `interpretadoPor`, `interpretadoEn`; lo saca de `patologia:pendientes`. Si es anormal o la Bethesda no es «Negativa» (ni NILM), entra a `/seguimiento` con límite = hoy + 15 días y motivo «Bethesda X» o «resultado anormal». Bitácora `interpretacion` con autor = patólogo, pacienteId y estudioId, sin datos clínicos. 400 cuerpo inválido, 404 no existe, 409 ya interpretado o avisado |
| `POST /estudios/:id/avisado` | Body `{ autor? }` (por omisión «brigada») → `{ ok, estudio }` con `etapa: 'avisado'`, `avisadoPor`, `avisadoEn`; bitácora `avisado`. 404 no existe, 409 si aún no está interpretado o ya estaba avisado |
| `GET /resumen?estado=&comunidad=` | `{ corte, filtros{estado?, comunidad?}, personasUnicas, visitas, estudios{ total, porTipo{mastografia, ultrasonido, papanicolaou, exploracion}, porResultado{normal, anormal, pendiente}, porEtapa{tomado, 'en-laboratorio', interpretado, avisado} }, anormales, pendientesPatologia, seguimientoVencido, duplicadosPendientes, porEstado[{estado, personas, estudios, anormales, pendientesPatologia}], porComunidad[{comunidad, estado, personas, estudios, anormales, pendientesPatologia}] }`. Personas = pacientes sin `fusionadaEn` (un par pendiente cuenta 2; `duplicadosPendientes` lo dice). Personas por estado/comunidad de la paciente; estudios por los de su visita. Con filtro, seguimiento vencido y duplicados cuentan solo los de las pacientes que entran. Grupos ordenados por personas |
| `GET /panel`, `GET /panel/*` | Panel web estático de la carpeta `panel/` (raíz del repo; `PANEL_DIR` lo cambia). `/panel` redirige a `/panel/` (`index.html`). En docker, `docker-compose.yml` monta `./panel:/panel` |

`tipo` de la bitácora suma `interpretacion` y `avisado`. El seed manda una visita por paciente y día de estudios con `estado` (Jalisco, Oaxaca, Guerrero) y `jornada`, y deja 7 papanicolaous en laboratorio.

### Jornadas programadas

Coordinación programa en el panel a qué comunidad va la brigada y qué día; los teléfonos bajan solos a las pacientes de esa comunidad antes de salir. Solo se agregó; ningún contrato anterior cambió.

| Método y ruta | Devuelve |
|---|---|
| `POST /jornadas` | Body `{ comunidad, estado, municipio?, fecha: 'AAAA-MM-DD', equipo?: string[] (≤20), nota?: string ≤300, autor }` → **201** `{ id, comunidad, estado, municipio, fecha, equipo, nota, autor, creada }` (`municipio` y `nota` en `null` si no vienen, `equipo` `[]`). Valkey: hash `jornada:<id>` (id = UUID, no choca con los contadores `jornada:<comunidad>:<día>`) + sorted set `jornadas` (score = medianoche CDMX de `fecha`, epoch ms). Bitácora `jornada-programada` con `autor`, `jornadaId` y `comunidad`, sin pacientes ni datos clínicos. 400 cuerpo inválido (fecha que no existe, como `2026-02-30`, también) |
| `GET /jornadas?desde=AAAA-MM-DD&dias=N` | Por omisión desde hoy (CDMX) y 30 días (`dias` 1–366; el rango es `[desde, desde + dias)`). `[{ id, comunidad, estado, municipio, fecha, equipo, nota, autor, creada, pacientesPrevias, estudiosPendientes }]` por fecha. `pacientesPrevias` = pacientes sin `fusionadaEn` con esa comunidad; `estudiosPendientes` = estudios de esas pacientes en `seguimiento` o con `etapa: 'en-laboratorio'` (cada estudio cuenta una vez). La comunidad se compara sin mayúsculas ni acentos |
| `DELETE /jornadas/:id` | `autor` en query (`?autor=`) o en el body (por omisión «coordinadora») → `{ ok }`; borra el hash y la saca de `jornadas`. Bitácora `jornada-cancelada` con `autor`, `jornadaId` y `comunidad`. 404 si no existe |

`GET /bitacora` suma `jornadaId?` y `comunidad?` a cada fila, y `tipo` suma `jornada-programada`, `jornada-cancelada` y `consulta-asistente`. Panel: vista **Jornadas** (Coordinación) con la lista, «Programar jornada» y cancelar con confirmación.

### Asistente de coordinación

Coordinación pregunta en español en el panel y recibe 1 a 3 frases con cifras y folios. Regla: **las cifras las calcula la API; el modelo solo redacta.** El modelo es el de Apple (Foundation Models) y corre en la misma Mac que la API, con el binario `asistente/`; nada sale a la nube.

| Método y ruta | Devuelve |
|---|---|
| `POST /asistente` | Body `{ pregunta: string 1–500, comunidad?: string, autor?: string }` → `{ respuesta, motor: 'apple' \| 'sin-modelo', motivo?, ms, datosUsados }`. 400 si falta la pregunta |

- `api/src/asistente.ts` lee la pregunta con reglas (comunidad, estado, tipo de estudio, BI-RADS o Bethesda, «vencid», nombre o folio de una paciente) y elige una intención: `seguimiento`, `patologia`, `hoy`, `paciente`, `jornadas` o `general`. Con eso calcula una **respuesta calculada** y arma el contexto (< 6 000 caracteres): resumen filtrado, seguimiento sin atender (folio, estudio, clasificación, días vencido o restantes, comunidad), papanicolaous esperando (folio, días), jornadas programadas a 30 días, las últimas 40 entradas de bitácora (sin `consulta-asistente`) y, si la pregunta nombra a una paciente que existe, su línea de tiempo (visitas, estudios con tipo, fecha, resultado, clasificación y etapa, seguimiento y bitácora). La respuesta calculada va al final del contexto.
- El binario (`ASISTENTE_BIN`, por omisión `asistente/.build/release/asistente` en la raíz del repo) recibe `{pregunta, contexto}` por stdin y devuelve `{respuesta}`. Timeout 45 s, una llamada a la vez. Al arrancar, la API lo precalienta con `{calentar: true}` si existe.
- La API revisa lo que redactó el modelo: si trae un folio o un número que no está en el contexto, o copia un renglón de tabla, se descarta y sale la respuesta calculada con `motor: 'sin-modelo'` y `motivo`. Sin binario, sin Apple Intelligence (código 3), guardrail (4) o tiempo agotado: lo mismo.
- `datosUsados`: `{ intencion, filtros, calculada, resumen, seguimiento[], patologia[], jornadas[], bitacora[], pacientes[], folios{folio: 'seguimiento' \| 'patologia' \| null}, caracteres }`. `folios` dice a qué vista del panel lleva cada folio.
- Bitácora `consulta-asistente` con `autor`, **sin la pregunta ni la respuesta**. `ASISTENTE_BITACORA=0` la apaga (para probar contra la base de la demo).
- Panel: vista **Asistente** (Coordinación) y botón «Preguntar» en Tablero y Bitácora. Los folios de la respuesta abren Seguimiento (`#/seguimiento?folio=`) o Patología en solo lectura (`#/patologia?folio=`).

