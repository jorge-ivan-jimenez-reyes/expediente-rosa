# Expediente Rosa

Expediente digital por paciente para las jornadas de tamizaje de cáncer de mama y cervicouterino que EIRA Movimiento Rosa hace en comunidades rurales. Responde al reto 1 de EIRA en el Nerdearla Vibeathon CDMX 2026.

Todos los datos de este repositorio son ficticios.

## El problema

EIRA lleva unos 80,000 estudios (mastografía, ultrasonido, papanicolaou) en tres años. Sus brigadas viajan a la sierra de Oaxaca y Guerrero y pasan hasta 3 días sin señal. Enfermería y médicos registran en hojas de papel, una por jornada y comunidad. Digitalizar esas hojas después cuesta mucho y llega tarde.

Cuando una paciente regresa al año siguiente, la buscan por su nombre. Si el año pasado alguien escribió «Ma. del Carmen López Hdz» y hoy dice «María del Carmen López Hernández», no hay forma rápida de saber que es la misma señora ni de ver qué estudios tiene y cuáles salieron anormales. Muchas no tienen CURP, así que no sirve como llave.

## Qué hace

Una app de iPhone que funciona completa sin internet y un servidor chico que junta lo de todas las brigadas cuando vuelve la señal.

1. **Alta de paciente** con datos mínimos y consentimiento firmado en la pantalla. Sin firma no se guarda. El teléfono genera el ID y un folio corto sin necesitar señal.
2. **Búsqueda con coincidencias.** La enfermera escribe nombre, apellidos, edad o fecha de nacimiento y comunidad. La app muestra las posibles coincidencias con un puntaje y las razones («nombre parecido», «misma edad ±1 año», «misma comunidad»). Reconoce abreviaturas y apodos (Ma., Lupe, Chayo, Hdz, Mtz), errores de captura comunes en español (b/v, s/z, ll/y, j/g, h muda) y apellido materno faltante. No junta a una madre y una hija que se llaman igual y nacieron con 27 años de diferencia.
3. **Segunda visita con historial.** Al elegir «Es ella», se abre su expediente con todos sus estudios previos y un resumen de tres líneas. El médico agrega el estudio de hoy.
4. **Sin señal y sincroniza después.** Todo se guarda en el teléfono y entra a una cola. Al volver la señal se manda al servidor. Cada evento lleva una llave única: si el envío se corta y se repite, el servidor no duplica nada.
5. **Escanear hojas viejas.** Una foto de la hoja de papel de una jornada pasada se lee en el teléfono y llena los datos de la paciente y sus estudios previos para que la enfermera los revise antes de guardar.
6. **Revisión de duplicados.** Si dos brigadas dieron de alta a la misma señora, el servidor lo detecta y la coordinadora ve las dos fichas lado a lado y decide si se unen o son personas distintas. El sistema nunca une solo.
7. **Seguimiento de anormales.** Cada estudio con resultado anormal entra a una lista con fecha límite de 15 días, los vencidos primero. EIRA dijo que su valor está en llevar rápido a la paciente a tratamiento; esta lista dice a quién hay que buscar.

Hay tres roles, elegidos arriba en la app (no hay login en esta versión): **Enfermería** busca, da de alta, toma el consentimiento y escanea hojas; **Médico** ve el expediente y agrega estudios y resultados; **Coordinadora** revisa duplicados.

## Arquitectura

```
iPhone (sin señal)                                  Servidor de la jornada
┌───────────────────────────────┐   POST /api/sync   ┌──────────────────────────┐
│ SwiftUI + SwiftData           │ ─────────────────▶ │ API Hono (Node 20)       │
│ Cola de eventos con llave UUID│                    │                          │
│ Coincidencias (Swift)         │ ◀───────────────── │ Valkey                   │
│ Vision + Foundation Models    │ GET /api/pacientes │                          │
│ (en el teléfono)              │   ?comunidad=      │                          │
└───────────────────────────────┘                    └──────────────────────────┘
```

- **App iOS** (`ios/`): SwiftUI, SwiftData e iOS 26. Vision lee el texto de las hojas en español; Foundation Models (el modelo de Apple que corre dentro del teléfono) convierte ese texto en campos, explica en una línea por qué dos fichas parecen la misma persona y resume el historial. Si el teléfono no tiene Apple Intelligence, la app funciona igual, solo sin esas líneas.
- **API** (`api/`): Hono sobre Node 20 con Valkey. Valkey guarda:
  - cada paciente en un hash y sus estudios en una lista;
  - un índice de coincidencias en sets por apellido fonético y por apellido + año de nacimiento, para comparar solo contra candidatas probables;
  - los envíos ya aplicados con `SET NX` y caducidad de 30 días (idempotencia);
  - la cola de posibles duplicados en un sorted set ordenado por puntaje;
  - el seguimiento de anormales en un sorted set ordenado por fecha límite;
  - una bitácora de todo lo sincronizado en un stream, y un canal pub/sub por comunidad para el tablero en vivo de la jornada;
  - opcional: con la imagen `valkey/valkey-bundle`, un índice de valkey-search para buscar pacientes por similitud del nombre (ver `docker-compose.bundle.yml`). Sin el módulo, la búsqueda usa los sets del índice.
- **Coincidencias**: la lógica está en `api/src/coincidencias.ts` y su puerto en `ios/ExpedienteRosa/Coincidencias/`. Las dos versiones deben dar el mismo resultado; los casos de `api/test/coincidencias.test.ts` son la referencia. El umbral para marcar «posible duplicado» es 0.82.

Endpoints:

| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/api/sync` | El teléfono manda altas y estudios juntados sin señal |
| `GET` | `/api/pacientes?comunidad=` | Antes de salir, el teléfono baja las pacientes de esa comunidad |
| `GET` | `/api/pacientes/:id` | Una paciente con sus estudios |
| `GET` | `/api/duplicados` | Cola de revisión de la coordinadora |
| `POST` | `/api/duplicados/resolver` | `{ a, b, decision: "unir" \| "separar" }` |
| `GET` | `/api/buscar?nombre=&apellidoPaterno=&edad=&comunidad=` | Coincidencias con puntaje y razones, sin dar de alta |
| `GET` | `/api/seguimiento?comunidad=` | Estudios anormales pendientes, vencidos primero |
| `POST` | `/api/seguimiento/:estudioId/atendido` | Marca un anormal como atendido |
| `GET` | `/api/jornada/:comunidad` | Conteo del día: altas, estudios por tipo, duplicados |
| `GET` | `/api/jornada/:comunidad/en-vivo` | Lo mismo en vivo (Server-Sent Events) |
| `GET` | `/api/estadisticas` | Pacientes, duplicados pendientes, eventos sincronizados y seguimiento |
| `GET` | `/api/salud` | Revisa que la API y Valkey respondan |

## Cómo correrlo

### 1. API y Valkey

Requisitos: Docker. Para cargar los datos ficticios también Node 20 y pnpm (`corepack enable`).

```bash
git clone <este repo> && cd eira-expediente
docker compose up -d
curl http://localhost:8787/api/salud        # {"ok":true,"valkey":"PONG"}
```

`docker compose up` levanta Valkey en el puerto 6379 y la API en el 8787.

Si prefieres correr la API fuera de Docker:

```bash
docker compose up -d valkey
cd api && pnpm install && pnpm dev          # API en http://localhost:8787/api
```

### 2. Cargar los datos ficticios

```bash
cd api && pnpm install
pnpm seed
```

Carga `seed/pacientes.json`: 40 pacientes inventadas de tres comunidades (San Martín Peras, Oaxaca; Metlatónoc, Guerrero; Huejuquilla el Alto, Jalisco) con 48 estudios previos, 8 de ellos con resultado anormal que entran al seguimiento. Las manda por `POST /api/sync`, igual que un teléfono al volver la señal, así que el seed pasa por el mismo camino que la app.

Entre ellas hay:

- **6 pares de la misma señora escrita distinto**, por ejemplo «María del Carmen López Hernández, nacida en 1974» y «Ma. del Carmen López Hdz, 52 años»; «Bertha Vázquez» y «Berta Basquez»; «Guadalupe Martínez Cruz» y «Lupe Mtz» sin apellido materno.
- **2 casos de madre e hija** con el mismo nombre completo y distinta fecha de nacimiento.

Al terminar, el script revisa que los 6 pares estén en la cola de duplicados y que las madres e hijas no. Se puede correr las veces que quieras: la segunda vez la API responde todo como repetido y no duplica. Si ya resolviste algún par desde la app, el script lo reporta como faltante.

Para revisar a mano:

```bash
curl http://localhost:8787/api/estadisticas
# {"pacientes":40,"duplicadosPendientes":6,"eventos":88,"seguimientoPendiente":8,"seguimientoVencido":7}
curl http://localhost:8787/api/duplicados
curl 'http://localhost:8787/api/buscar?nombre=Ma.%20del%20Carmen&apellidoPaterno=Lopez&apellidoMaterno=Hdz&edad=52'
```

Para otra API: `API_URL=https://mi-servidor/api pnpm seed`. Para borrar todo y empezar de cero: `docker compose down -v`.

### 3. La app de iPhone

Requisitos: Mac con Xcode 26 y [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
cd ios
xcodegen
open ExpedienteRosa.xcodeproj
```

Elige un simulador de iPhone con iOS 26 y corre el esquema `ExpedienteRosa`. En el simulador la app llega a la API en `http://localhost:8787/api`.

Para un iPhone físico, la URL se cambia en `ios/project.yml` (`API_URL`) por la IP de tu Mac en la misma red, por ejemplo `http://192.168.1.20:8787/api`, y se vuelve a correr `xcodegen`. Para instalar en un iPhone necesitas tu propio equipo de firma en Xcode.

Foundation Models necesita un iPhone o Mac con Apple Intelligence activado y en un idioma compatible. En el simulador o en un iPhone sin Apple Intelligence la app hace todo lo demás: alta, búsqueda con coincidencias, historial, sincronización y duplicados.

Pruebas:

```bash
cd api && pnpm test                         # coincidencias en TypeScript
cd ios && xcodebuild test -scheme ExpedienteRosa -destination 'platform=iOS Simulator,name=iPhone 17'
```

### 4. Probar el modo sin señal

1. Con la API arriba, en la app toca «Preparar jornada» y elige una comunidad. El teléfono baja sus pacientes.
2. Corta la señal: en el iPhone, modo avión; en el simulador, `docker compose stop api`.
3. Da de alta pacientes y agrega estudios. El contador de pendientes sube.
4. Regresa la señal (`docker compose start api`) y toca «Sincronizar». El contador baja a cero y `curl http://localhost:8787/api/estadisticas` muestra las pacientes nuevas.
5. Sincroniza otra vez: el servidor responde que todo era repetido.

## Credenciales

Ninguna para correrlo en local. No hay llaves de terceros: la IA corre en el teléfono. Las variables de la API están en `.env.example` y sus valores por defecto ya sirven:

- `VALKEY_URL` (por defecto `redis://localhost:6379`) y `PORT` (por defecto `8787`).
- `CLAVE_DATOS`, opcional: llave de 32 bytes en base64 (`openssl rand -base64 32`) para cifrar en reposo la nota de cada estudio y el consentimiento. Sin ella la API guarda en claro y lo avisa en el log, lo cual basta para probar con datos ficticios.

## Privacidad

- **Datos mínimos.** Nombre, apellidos, fecha de nacimiento o edad, y comunidad. No se piden dirección, teléfono ni CURP.
- **Consentimiento expreso y firmado.** La Ley Federal de Protección de Datos Personales en Posesión de los Particulares (DOF, 20 de marzo de 2025) pide consentimiento expreso y por escrito para datos de salud. La paciente firma en la pantalla antes de guardar y la fecha queda registrada con su ficha.
- **La IA corre en el teléfono.** Leer hojas, explicar coincidencias y resumir el historial se hace con Foundation Models dentro del dispositivo. Los datos de salud no salen a ningún servicio de IA en la nube.
- **Cada rol ve lo que necesita.** Enfermería no ve resultados de estudios; el médico sí; la coordinadora ve lo necesario para decidir si dos fichas son la misma persona.
- **Cifrado en reposo.** Con `CLAVE_DATOS` definida, la nota clínica y el consentimiento se guardan en Valkey cifrados con AES-256-GCM.
- **Nadie se une sola.** El servidor solo propone duplicados; unir dos expedientes es decisión de una persona, y la ficha unida se marca, no se borra.
- **Solo datos ficticios** en este repositorio y en la demo.

## Estructura

```
api/            API Hono + Valkey, coincidencias y pruebas
api/scripts/    seed.ts (carga de datos ficticios)
ios/            App SwiftUI (XcodeGen)
seed/           pacientes.json ficticias
docs/           texto de Devpost y guion del pitch
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
