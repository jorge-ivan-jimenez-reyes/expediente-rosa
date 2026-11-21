# Expediente Rosa

Expediente digital por paciente para las jornadas de tamizaje de EIRA Movimiento Rosa. Funciona en un iPhone sin señal, reconoce a una paciente que regresa aunque su nombre esté escrito distinto y sincroniza cuando vuelve la señal. Reto 1 de EIRA, Nerdearla Vibeathon CDMX, 21 de noviembre de 2026.

## Inspiración

El 21 de noviembre a las nueve y media, EIRA presentó sus retos. Dijeron que en ese momento tenían una brigada en la sierra de Oaxaca y Guerrero: viajes de unas siete horas y hasta tres días sin señal. En tres años han hecho unos 80,000 estudios de mastografía, ultrasonido y papanicolaou, y los registran en hojas de papel, una por jornada y comunidad. Digitalizarlas después les sale caro y llega tarde.

Cuando una paciente regresa, la identifican por su nombre completo. Si un año la anotaron como «Ma. del Carmen López Hdz» y al siguiente como «María del Carmen López Hernández», nadie en la jornada tiene a la mano lo que se le hizo antes. Muchas no tienen CURP: en 2015 cerca de un millón de personas en México no tenía acta de nacimiento, y ese subregistro se concentra en los municipios indígenas donde trabaja EIRA. Dijeron que su valor está en llevar rápido a tratamiento a quien sale con un resultado anormal, y eso depende de reconocerla cuando regresa.

## Qué hace

Una app de iPhone y un servidor chico.

- **Alta sin señal.** Nombre, apellidos, edad o fecha de nacimiento y comunidad. La paciente firma el consentimiento en la pantalla; sin firma no se guarda. El teléfono genera el ID y un folio corto.
- **Búsqueda con coincidencias.** La enfermera escribe lo que le dicen y la app propone candidatas con un puntaje y sus razones. Reconoce abreviaturas y apodos (Ma., Lupe, Chayo, Hdz, Mtz), errores comunes de captura en español (b/v, s/z, ll/y, j/g, h muda) y apellido materno faltante. Compara año de nacimiento contra edad. A una madre y una hija con el mismo nombre completo las mantiene separadas.
- **Historial en la segunda visita.** «Es ella» abre el expediente con sus estudios anteriores y un resumen de tres líneas. El médico agrega el estudio del día.
- **Sincronización.** Todo entra a una cola en el teléfono. Al volver la señal se manda al servidor; cada evento lleva una llave única y un envío repetido no duplica nada.
- **Hojas de papel viejas.** Una foto de la hoja de una jornada pasada se lee en el teléfono y prellena a la paciente con sus estudios para que la enfermera revise.
- **Duplicados entre brigadas.** Si dos teléfonos dieron de alta a la misma señora, el servidor la marca y la coordinadora decide si se unen o son distintas.
- **Seguimiento de anormales.** Cada resultado anormal entra a una lista con fecha límite de 15 días, vencidos primero.
- **Roles.** Enfermería, Médico y Coordinadora ven cada uno lo que necesita. Enfermería no ve resultados.

## Cómo lo construimos

- iOS 26: SwiftUI y SwiftData para guardar todo en el teléfono. Vision para leer el texto de las hojas en español. Foundation Models, el modelo de lenguaje de Apple que corre dentro del dispositivo, para pasar ese texto a campos con salida estructurada (`@Generable`), explicar en una línea una coincidencia y resumir el historial. Sin Apple Intelligence la app hace todo lo demás.
- API: Hono sobre Node 20 con Valkey. Valkey guarda las pacientes en hashes y sus estudios en listas; un índice por apellido fonético y por apellido más año de nacimiento, para comparar solo contra candidatas probables; las llaves de envío con `SET NX`, que dan la idempotencia; la cola de duplicados y el seguimiento de anormales en sorted sets; la bitácora en un stream, y un canal pub/sub por comunidad para un tablero en vivo de la jornada por Server-Sent Events. Con la imagen `valkey-bundle` probamos valkey-search: búsqueda KNN sobre un vector de trigramas fonéticos del nombre, sin modelo de embeddings.
- Coincidencias: normalización de apodos y abreviaturas, una fonética para errores de captura en español, Jaro-Winkler por campo y ajuste por año de nacimiento y comunidad. Umbral de 0.82. La misma lógica está en TypeScript (servidor) y en Swift (teléfono) y se verificó que las dos den el mismo resultado.
- Privacidad: datos mínimos, consentimiento firmado, cifrado AES-256-GCM en reposo de la nota clínica y el consentimiento, y la IA dentro del teléfono.
- Forma de trabajo: un archivo `SPEC.md` con el problema y uno `ORQUESTACION.md` con carriles separados por carpeta. Varios agentes de código (Claude Code) trabajaron en paralelo, uno por carril: sincronización, coincidencias en Swift, Valkey, Foundation Models y entrega. Cada tarea se cerró con su verificación pegada en una bitácora. La interfaz la hice yo.

## Retos

- **Nombres en español.** Los algoritmos fonéticos conocidos (Soundex, Metaphone) están hechos para inglés. Escribimos reglas para los errores que de verdad aparecen en una hoja de captura: b/v, s/z/c, ll/y, j/g, h muda, y abreviaturas como Ma. o Hdz.
- **Madres e hijas.** En una comunidad es común que la hija lleve el nombre completo de la madre. El año de nacimiento resta puntaje cuando la diferencia pasa de un año, y con eso quedan en 0.75, debajo del umbral.
- **Dos implementaciones que deben coincidir.** El teléfono decide sin servidor y el servidor decide entre brigadas. Corrimos los mismos casos en Swift y en TypeScript y comparamos la salida línea por línea.
- **Un lockfile que caducó en la mañana.** Una dependencia publicó versión el mismo día y pnpm 12 rechazaba instalarla por su política de antigüedad mínima. El contenedor no arrancaba. Fijamos la versión de pnpm en `package.json`.
- **Foundation Models no corre en el simulador.** Todo lo que usa el modelo devuelve nada si no está disponible, y la app sigue sin esa línea.

## Logros

- Con las 40 pacientes ficticias del seed, los 6 pares de la misma señora escrita distinto salen en la cola de duplicados y los 2 casos de madre e hija no.
- El seed carga por el mismo `POST /api/sync` que usa el teléfono: la primera vez aplica 88 eventos y la segunda responde 88 repetidos.
- 23 pruebas de la API en verde (24 con la imagen valkey-bundle), incluidas idempotencia, duplicado detectado y unir expedientes.
- El puerto en Swift de las coincidencias da la misma salida que TypeScript en 15 casos, a tres decimales.

## Qué aprendimos

- Sin CURP, la identidad de una paciente en campo se arma con nombre, año de nacimiento y comunidad, y cada uno viene con errores. Un puntaje con razones visibles le sirve más a la enfermera que un «sí» o «no».
- La decisión de unir dos expedientes tiene que quedarse con una persona. El sistema propone y la coordinadora decide.
- Diseñar para «sin señal» desde el principio simplifica: el teléfono es la fuente y el servidor junta.
- La nueva Ley Federal de Protección de Datos Personales (DOF, 20 de marzo de 2025) pide consentimiento expreso y por escrito para datos de salud. Eso se resuelve con una firma en la pantalla antes de guardar.

## Qué sigue

- Probarlo con una brigada real de EIRA en una jornada, junto al papel.
- Revisar contra la NOM-004 (conservación del expediente) y la NOM-024 (sistemas de expediente electrónico).
- Login por rol y bitácora de quién vio qué expediente.
- Servidor en la nube con HTTPS para que los teléfonos sincronicen desde cualquier lugar con señal.
- Mejorar el caso de dos hermanas con el mismo apellido y edades cercanas, que hoy puede salir como posible duplicado.
- Entrega de resultados a la paciente (reto 4 de EIRA) sin pasar datos de salud por WhatsApp.

## Pruébalo

Repositorio público con licencia MIT. El README explica cómo levantar la API y Valkey con `docker compose up`, cargar las pacientes ficticias con `pnpm seed` y abrir la app en Xcode 26.
