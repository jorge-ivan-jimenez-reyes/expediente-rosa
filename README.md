# Expediente Rosa

Expediente digital por paciente para las jornadas de tamizaje de cáncer de mama y cervicouterino de EIRA Movimiento Rosa A.C. Responde al Reto 1 de EIRA en el Nerdearla Vibeathon CDMX, 21 de noviembre de 2026.

Todos los datos de este repositorio son ficticios.

## El problema

EIRA lleva unos 80,000 estudios (mastografía, ultrasonido y papanicolaou) en tres años. Sus brigadas trabajan en comunidades rurales y pasan hasta 3 días sin señal. Enfermería y médicos registran en hojas de papel; digitalizarlas después cuesta mucho y llega tarde.

Cuando una paciente regresa, la reconocen solo por su nombre. Si un año la anotaron como «Ma. del Carmen López Hdz» y al siguiente como «María del Carmen López Hernández», nadie en la jornada ve sus estudios anteriores ni sabe si alguno salió anormal. Muchas no tienen CURP, así que tampoco sirve como llave.

El reto pide demostrar cuatro cosas: alta de una paciente ficticia, búsqueda con detección de coincidencias, segunda visita con su historial y trabajo sin conexión que se pueda verificar.

## Qué hay en el repositorio

- **App de iPhone** (`ios/`): SwiftUI y SwiftData en iOS 26. Funciona completa sin señal. Vision lee las hojas de papel en español y Foundation Models, el modelo de Apple que corre dentro del teléfono, explica coincidencias, resume el historial y ayuda a leer las hojas. Roles en la app: Enfermería, Médico y Coordinación.
- **API** (`api/`): Hono sobre Node 20 con Valkey. Junta lo que mandan las brigadas, detecta duplicados entre teléfonos y lleva el seguimiento de anormales y la bitácora. La imagen `valkey/valkey-bundle` trae valkey-search, que la API usa para buscar pacientes por similitud del nombre.
- **Panel web** (`panel/`): HTML, CSS y JavaScript sin build, servido por la misma API en `/panel`. Coordinación ve el tablero por estado y comunidad, el seguimiento de anormales y la bitácora. Patología ve los papanicolaous por interpretar y captura el resultado Bethesda.

## El recorrido de una brigada

1. Antes de salir, con señal: en Jornada elige estado y comunidad y toca «Bajar». El teléfono guarda a las pacientes que ya vinieron, con su historial.
2. En la comunidad, sin señal: Enfermería busca por nombre y edad. «Es ella» abre su expediente; «Es nueva» pide datos mínimos y la firma del consentimiento.
3. El médico ve el historial (resultado, BI-RADS, conducta) y registra los estudios de hoy, a mano o leyendo la hoja con la cámara. El papanicolaou queda «En laboratorio».
4. Al volver la señal toca «Sincronizar». Lo que se reenvía no se duplica; los posibles duplicados y los cambios en conflicto van a Revisión, donde Coordinación decide.
5. En el panel web, Coordinación ve personas, estudios y anormales por estado y comunidad. Patología interpreta cada papanicolaou; si sale anormal, entra a seguimiento con fecha límite.
6. Coordinación avisa a la paciente y la marca como avisada. La siguiente vez que la brigada baje esa comunidad, el teléfono ya trae el resultado.

El recorrido completo está en [`docs/happy-path.md`](docs/happy-path.md).

## Cómo correrlo desde cero

### Requisitos

- Docker con Compose. Levanta Valkey en el puerto 6379 y la API en el 8787; los dos puertos tienen que estar libres.
- Node 20 y pnpm 10 para cargar los datos ficticios (`corepack enable` instala la versión fijada en `api/package.json`).
- Para la app: una Mac con Xcode 26 o posterior, [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) y el simulador de iPhone 17 con iOS 26.

### 1. API y Valkey

```bash
git clone <este repo> && cd eira-expediente
docker compose up -d
curl http://localhost:8787/api/salud
# {"ok":true,"valkey":"PONG","cifrado":false}
```

La primera vez el contenedor de la API instala dependencias y tarda alrededor de un minuto en responder. `docker compose logs -f api` muestra cuando ya escucha.

### 2. Datos ficticios

```bash
cd api && pnpm install
pnpm seed
```

El seed manda `seed/pacientes.json` por `POST /api/sync`, el mismo camino que usa el teléfono al volver la señal. Carga 40 pacientes de tres comunidades (San Martín Peras, Oaxaca; Metlatónoc, Guerrero; Huejuquilla el Alto, Jalisco), 40 visitas y 51 estudios. De esos estudios, 8 salieron anormales y 7 papanicolaous esperan al patólogo. Entre las pacientes hay 6 pares de la misma señora escrita distinto («Bertha Vázquez» y «Berta Basquez», «Guadalupe Martínez Cruz» y «Lupe Mtz») y 2 casos de madre e hija con el mismo nombre completo. Al terminar, el script revisa que los 6 pares estén en la cola de duplicados y que las madres e hijas no.

Se puede correr varias veces: la segunda, la API responde todo como repetido. Para otra API: `API_URL=http://otra-ip:8787/api pnpm seed`. Para borrar todo y empezar de cero: `docker compose down -v`.

Para revisar a mano:

```bash
curl http://localhost:8787/api/estadisticas
curl 'http://localhost:8787/api/buscar?nombre=Eulalia&apellidoPaterno=Garsia&apellidoMaterno=Luna&edad=67'
```

### 3. Panel web

Abre http://localhost:8787/panel. Escribe tu nombre y elige el área: Coordinación (tablero, seguimiento y bitácora) o Patología (muestras por interpretar; la cédula es opcional). No es un login: solo registra quién hace cada cosa en la bitácora.

### 4. App de iPhone

```bash
cd ios && xcodegen && open ExpedienteRosa.xcodeproj
```

Elige el simulador iPhone 17 y corre el esquema `ExpedienteRosa`. En el simulador la app llega sola a la API en `http://localhost:8787/api`.

Para probar sin señal en el simulador: pestaña Jornada, activa «Simular sin señal». Da de alta pacientes o agrega estudios y el contador de pendientes sube. Apaga el interruptor y toca «Sincronizar»: el contador baja a cero y `curl http://localhost:8787/api/estadisticas` muestra los registros nuevos. Si sincronizas otra vez, el servidor responde que todo era repetido.

Para un iPhone físico:

1. En `ios/project.yml` cambia `DEVELOPMENT_TEAM` por tu equipo de firma y vuelve a correr `xcodegen`.
2. Conecta el iPhone a la misma red Wi-Fi que la Mac y saca la IP de la Mac con `ipconfig getifaddr en0`.
3. En la app: Jornada → Servidor → escribe `http://<IP de la Mac>:8787/api` → «Usar servidor». También se puede cambiar `API_URL` en `ios/project.yml` antes de correr `xcodegen`.
4. Para cortar la señal usa modo avión o el mismo «Simular sin señal».

### Pruebas

```bash
cd api && pnpm test       # necesita Valkey arriba; usa las bases 13 a 15 y las limpia
cd ios && xcodebuild test -scheme ExpedienteRosa -destination 'platform=iOS Simulator,name=iPhone 17'
```

## Sin Apple Intelligence

Todo funciona. Alta, búsqueda con coincidencias, historial, sincronización, duplicados, conflictos y lectura de hojas corren sin el modelo. Cuando Foundation Models está disponible agrega una línea que explica por qué dos fichas parecen la misma persona y un resumen de tres líneas del historial. La lectura de hojas usa Vision y reglas fijas para los formatos de EIRA: «Escanear» llena los datos de la paciente y «Leer hoja», en el expediente, llena el estudio de hoy (tipo, BI-RADS o Bethesda, referencia y notas). Con el modelo, «Escanear» también saca los estudios previos y lee hojas con otro formato. Lo que no está escrito en el papel no se llena, y quien captura revisa antes de guardar.

## Credenciales

Ninguna. No hay llaves de terceros porque la IA corre en el teléfono. Las variables de la API están en `.env.example` y los valores por defecto sirven para correrlo en local: `VALKEY_URL` (`redis://localhost:6379`) y `PORT` (`8787`).

`CLAVE_DATOS` es opcional: una llave de 32 bytes en base64 que cifra en reposo, con AES-256-GCM, la nota de cada estudio y el consentimiento. Sin ella la API guarda en claro y lo avisa en el log. `docker-compose.yml` no la pasa al contenedor; para probar el cifrado, corre la API fuera de Docker:

```bash
docker compose stop api
cd api && pnpm install
CLAVE_DATOS=$(openssl rand -base64 32) pnpm start
curl http://localhost:8787/api/salud      # "cifrado":true
```

## Privacidad

- **Datos mínimos.** Nombre, apellidos, edad o fecha de nacimiento y comunidad. No se piden dirección, teléfono ni CURP.
- **Consentimiento firmado.** La Ley Federal de Protección de Datos Personales en Posesión de los Particulares (DOF, 20 de marzo de 2025) pide consentimiento expreso y por escrito para datos de salud. La paciente firma en la pantalla y sin firma no se guarda. El trazo se queda en el teléfono; al servidor va la fecha del consentimiento.
- **IA en el teléfono.** Leer hojas, explicar coincidencias y resumir el historial no manda datos de salud a ningún servicio en la nube.
- **Roles.** Enfermería captura y no ve resultados. Médico ve el historial y agrega estudios. Coordinación revisa duplicados, conflictos, seguimiento y bitácora. Patología solo ve las muestras por interpretar. En esta versión el rol se elige sin login.
- **Nunca se fusiona solo.** El servidor propone posibles duplicados; unir dos expedientes lo decide una persona, y la ficha unida queda marcada, no se borra.
- **Bitácora sin datos clínicos.** Registra quién hizo qué, cuándo y desde qué dispositivo, sin resultados, clasificaciones, notas ni valores de campos.
- **Cifrado en reposo** de notas y consentimiento con `CLAVE_DATOS`.

## Datos ficticios

- `seed/pacientes.json`: las 40 pacientes del seed.
- `docs/hojas-ejemplo/`: hojas de registro con el formato de EIRA llenadas con datos inventados (revisión mamaria, citología y las hojas de Eulalia García Luna). Sirven para probar «Escanear» con la cámara; la app trae copias en «Usar ejemplo».

## API

Todo va bajo `/api`. El detalle de cada respuesta está en [`SPEC.md`](SPEC.md#endpoints).

| Ruta | Para qué |
|---|---|
| `POST /sync` | El teléfono manda altas, visitas, estudios y cambios juntados sin señal |
| `GET /pacientes?comunidad=` · `GET /pacientes/:id` | «Bajar» antes de salir; una paciente con visitas y estudios |
| `GET /buscar?nombre=&apellidoPaterno=&edad=&comunidad=` | Coincidencias con puntaje y razones (valkey-search o sets por bloque) |
| `GET /duplicados` · `POST /duplicados/resolver` | Cola de posibles duplicados; unir o separar |
| `GET /conflictos` · `POST /conflictos/:id/resolver` | Cambios hechos sobre una versión vieja de la ficha |
| `GET /seguimiento` · `POST /seguimiento/:id/atendido` | Anormales pendientes, vencidos primero |
| `GET /patologia` · `POST /estudios/:id/interpretacion` · `POST /estudios/:id/avisado` | Papanicolaous por interpretar, resultado Bethesda y aviso a la paciente |
| `GET /resumen?estado=&comunidad=` | Personas, estudios y anormales por estado y comunidad |
| `GET /jornada/:comunidad` · `GET /jornada/:comunidad/en-vivo` | Conteo del día; en vivo por Server-Sent Events |
| `GET /bitacora` · `GET /estadisticas` · `GET /salud` | Bitácora, totales y estado de la API |

Valkey guarda cada paciente en un hash con versión, los estudios en listas y las visitas en un sorted set por fecha. Las llaves de envío van con `SET NX` y caducan en 30 días, y así un reenvío no duplica. Hay sets por apellido fonético y por apellido más año para comparar solo contra candidatas probables, y un índice vectorial de valkey-search sobre trigramas fonéticos del nombre. Duplicados, seguimiento, conflictos y muestras por interpretar van en sorted sets; la bitácora en un stream, y el conteo en vivo de la jornada en un canal pub/sub por comunidad. La lógica de coincidencias está en `api/src/coincidencias.ts` y su puerto en `ios/ExpedienteRosa/Coincidencias/`; las dos dan el mismo resultado con los casos de `api/test/coincidencias.test.ts`.

## Estructura

```
api/src/                 API Hono: rutas, coincidencias, búsqueda, cifrado
api/scripts/seed.ts      carga de datos ficticios por POST /api/sync
api/test/                pruebas (vitest)
ios/project.yml          proyecto XcodeGen
ios/ExpedienteRosa/      app: Modelo, Sync, Coincidencias, Inteligencia, Pantallas, Recursos
ios/ExpedienteRosaTests/ pruebas XCTest
panel/                   panel web de Coordinación y Patología
seed/                    pacientes.json
docs/                    recorrido, pitch, texto de Devpost, presentación, diseño y hojas de ejemplo
SPEC.md                  problema, roles y contrato de la API
ORQUESTACION.md          reparto del trabajo y bitácora de verificación
docker-compose.yml       Valkey (valkey-bundle) y la API
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
