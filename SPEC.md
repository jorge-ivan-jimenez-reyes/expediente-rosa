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

Cifrado en reposo: `consentimiento` y `nota` van con AES-256-GCM si hay `CLAVE_DATOS` (32 bytes base64); sin ella se guardan en claro y la API lo avisa en el log.
