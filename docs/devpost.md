# Expediente Rosa

Expediente digital por paciente para las jornadas de tamizaje de EIRA Movimiento Rosa A.C. Una app de iPhone que funciona sin señal reconoce a la paciente que regresa aunque su nombre venga escrito distinto, y un panel web le da a coordinación y patología lo que juntaron las brigadas. Reto 1 de EIRA, Nerdearla Vibeathon CDMX, 21 de noviembre de 2026.

## Inspiración

El 21 de noviembre a las nueve y media, EIRA presentó sus retos. Tenían en ese momento una brigada en la sierra de Oaxaca y Guerrero: viajes de unas siete horas y hasta tres días sin señal. En tres años han hecho unos 80,000 estudios de mastografía, ultrasonido y papanicolaou, y los registran en hojas de papel, una por jornada y comunidad. Digitalizarlas después les sale caro y llega tarde.

Cuando una paciente regresa, la identifican por su nombre completo. Si un año la anotaron como «Ma. del Carmen López Hdz» y al siguiente como «María del Carmen López Hernández», nadie en la jornada ve lo que se le hizo antes. Muchas no tienen CURP: en 2015 cerca de un millón de personas en México no tenía acta de nacimiento, y ese subregistro se concentra en municipios indígenas como los que visita EIRA. Contaron también que una mujer que va cuatro veces en un año puede quedar registrada cuatro veces, y que el papanicolaou se toma en campo y lo interpreta un patólogo días después. Dijeron que su valor está en llevar rápido a tratamiento a quien sale con un resultado anormal, y eso depende de reconocerla cuando regresa.

## Qué hace

En el iPhone, sin señal:

- **Alta.** Nombre, apellidos, edad o fecha de nacimiento y comunidad. La paciente firma el consentimiento en la pantalla; sin firma no se guarda. El teléfono genera el ID y un folio corto.
- **Búsqueda con coincidencias.** La enfermera escribe lo que le dicen y la app propone candidatas con puntaje y razones. Reconoce abreviaturas y apodos (Ma., Lupe, Chayo, Hdz, Mtz), errores de captura del español (b/v, s/z, ll/y, j/g, h muda) y apellido materno faltante, y compara año de nacimiento contra edad. A una madre y una hija con el mismo nombre completo las deja separadas.
- **Segunda visita con historial.** «Es ella» abre el expediente con estudios anteriores, BI-RADS o Bethesda y la conducta indicada. El médico registra los estudios de hoy en una visita nueva.
- **Hojas de papel.** Con una foto, la app lee la hoja de EIRA y propone los datos de la paciente o el estudio de hoy. Quien captura revisa antes de guardar.
- **Sincronización.** Todo entra a una cola en el teléfono. Al volver la señal se manda al servidor; cada registro lleva una llave única y un reenvío no duplica nada.
- **Revisión.** Si dos teléfonos dieron de alta a la misma señora, o cambiaron el mismo dato, el servidor no decide: Coordinación ve las dos versiones y elige.

En el panel web:

- **Tablero de Coordinación.** Personas únicas, estudios, anormales y muestras pendientes, por estado y por comunidad, con el conteo de la jornada en vivo.
- **Patología.** El patólogo ve los papanicolaous por interpretar, el que más espera primero, y captura el resultado Bethesda. Si sale anormal, entra a seguimiento.
- **Seguimiento.** Los anormales con fecha límite de 15 días (6 meses para BI-RADS 3), vencidos primero. Coordinación avisa a la paciente y la marca como avisada.
- **Bitácora.** Quién hizo qué, cuándo y desde qué dispositivo, sin datos clínicos.

Roles: Enfermería captura y no ve resultados; Médico ve el historial y agrega estudios; Coordinación revisa duplicados, conflictos, seguimiento y bitácora; Patología solo ve las muestras por interpretar.

## Cómo lo construimos

- **iPhone, iOS 26.** SwiftUI y SwiftData guardan todo en el teléfono. Vision lee el texto de las hojas en español. Foundation Models, el modelo de Apple que corre dentro del dispositivo, explica en una línea por qué dos fichas parecen la misma persona, resume el historial en tres líneas y pasa hojas a campos con salida estructurada (`@Generable`). Sin Apple Intelligence todo funciona: la lectura de las hojas de EIRA usa reglas fijas y solo faltan la explicación y el resumen.
- **API.** Hono sobre Node 20 con Valkey. Las pacientes van en hashes con número de versión, los estudios en listas y las visitas en sorted sets por fecha. Las llaves de envío usan `SET NX`, que da la idempotencia. Un cambio hecho sobre una versión vieja se compara y se aplica en un script Lua; si no coincide, queda como conflicto. Duplicados, seguimiento, conflictos y muestras por interpretar van en sorted sets, la bitácora en un stream y el conteo de la jornada en un canal pub/sub que llega al panel por Server-Sent Events. La imagen `valkey-bundle` trae valkey-search: buscamos pacientes por KNN sobre un vector de trigramas fonéticos del nombre, sin modelo de embeddings.
- **Panel web.** HTML, CSS y JavaScript sin build ni dependencias, servido por la misma API.
- **Coincidencias.** Normalización de apodos y abreviaturas, una fonética para errores de captura en español, Jaro-Winkler por campo y ajuste por año de nacimiento y comunidad, con umbral de 0.82. La misma lógica corre en TypeScript (servidor) y en Swift (teléfono), y comprobamos que las dos den el mismo resultado.
- **Privacidad.** Datos mínimos, consentimiento firmado, IA dentro del teléfono, roles, bitácora sin datos clínicos y cifrado AES-256-GCM en reposo de la nota clínica y el consentimiento.
- **Forma de trabajo.** Un `SPEC.md` con el problema y un `ORQUESTACION.md` con carriles separados por carpeta. Varios agentes de código (Claude Code) trabajaron en paralelo, uno por carril: sincronización, coincidencias en Swift, Valkey, Foundation Models y entrega. Cada tarea se cerró con su verificación pegada en una bitácora. La interfaz de la app la hice yo.

## Retos

- **Nombres en español.** Soundex y Metaphone están hechos para inglés. Escribimos reglas para los errores que aparecen en una hoja de captura: b/v, s/z/c, ll/y, j/g, h muda y abreviaturas como Ma. o Hdz.
- **Madres e hijas.** En una comunidad es común que la hija lleve el nombre completo de la madre. El año de nacimiento resta puntaje cuando la diferencia pasa de un año, y con eso quedan en 0.75, debajo del umbral.
- **Dos implementaciones que deben coincidir.** El teléfono decide sin servidor y el servidor decide entre brigadas. Corrimos los mismos casos en Swift y en TypeScript y comparamos la salida línea por línea.
- **Dos teléfonos que cambian a la misma paciente.** Sin señal no hay quién ordene los cambios. Cada ficha lleva versión; gana el primer cambio que llega y el otro espera a que una persona lo acepte o lo rechace.
- **El modelo inventaba datos.** Al leer hojas, Foundation Models cortó un nombre, inventó un apellido materno y marcó como normal un ultrasonido anormal. Ahora todo lo que propone se contrasta con el texto que leyó Vision, y lo que no está en el papel se descarta.
- **Un lockfile que caducó en la mañana.** Una dependencia publicó versión ese mismo día y pnpm 12 se negó a instalarla por su política de antigüedad mínima, así que el contenedor no arrancaba. Fijamos la versión de pnpm en `package.json`.

## Logros

- Con las 40 pacientes ficticias del seed, los 6 pares de la misma señora escrita distinto salen en la cola de duplicados y los 2 casos de madre e hija no.
- El seed carga por el mismo `POST /api/sync` que usa el teléfono: la primera vez aplica 131 eventos y la segunda responde 131 repetidos.
- «Eulalia Garsia Luna, 67 años» encuentra a Eulalia García Luna, nacida en 1958, con puntaje 1.0.
- 42 pruebas de la API en verde, entre ellas idempotencia, duplicados, unir expedientes, conflictos de versión y el flujo de patología.
- El puerto en Swift de las coincidencias da la misma salida que TypeScript en 15 casos, a tres decimales.

## Qué aprendimos

- Sin CURP, la identidad de una paciente en campo se arma con nombre, año de nacimiento y comunidad, y cada dato viene con errores. A la enfermera le sirve más un puntaje con razones visibles que un «sí» o «no».
- Unir dos expedientes lo tiene que decidir una persona. El sistema propone y Coordinación decide.
- Diseñar para «sin señal» desde el principio simplifica: el teléfono es la fuente y el servidor junta.
- La Ley Federal de Protección de Datos Personales en Posesión de los Particulares (DOF, 20 de marzo de 2025) pide consentimiento expreso y por escrito para datos de salud. Una firma en la pantalla antes de guardar lo resuelve en campo.
- Un modelo dentro del teléfono ayuda a leer papel, pero sus respuestas tienen que pasar por reglas antes de llegar a un expediente.

## Qué sigue

- Probarlo con una brigada de EIRA en una jornada, junto al papel.
- Revisarlo contra la NOM-004 (expediente clínico) y la NOM-024 (sistemas de información de registro electrónico para la salud).
- Login por rol y registro de quién consultó cada expediente.
- Servidor en la nube con HTTPS para que los teléfonos sincronicen desde cualquier lugar con señal.
- Mejorar el caso de dos hermanas con el mismo apellido y edades cercanas, que hoy puede salir como posible duplicado.
- Entrega de resultados a la paciente (reto 4 de EIRA) sin pasar datos de salud por WhatsApp.

## Pruébalo

Repositorio público con licencia MIT. El README explica cómo levantar Valkey y la API con `docker compose up -d`, cargar las pacientes ficticias con `pnpm seed`, abrir el panel en `http://localhost:8787/panel` y correr la app en el simulador de iPhone 17.
