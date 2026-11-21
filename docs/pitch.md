# Guion del pitch (2 minutos), versión 2: borrador para OK de Jorge

Cubre lo que EIRA pide demostrar en el Reto 1: alta de una paciente ficticia, búsqueda con detección de coincidencia, segunda visita con historial, trabajo sin conexión verificable y explicación del control de acceso.

**Antes de subir:** `docker compose up -d` y `cd api && pnpm seed`. Con señal, en la app: Jornada → Servidor (IP de la Mac) → bajar «San Martín Peras». Luego modo avión. Rol inicial: Enfermería.

| Tiempo | En pantalla | Se dice |
|---|---|---|
| 0:00–0:15 | Diapositiva 1 (problema) | «Hoy a las nueve y media, EIRA nos contó que tiene una brigada en la sierra de Oaxaca y Guerrero, a siete horas de camino y hasta tres días sin señal. En tres años han hecho unos 80,000 estudios, anotados en hojas de papel.» |
| 0:15–0:25 | iPhone con modo avión | «Una mujer que va cuatro veces en un año puede quedar registrada cuatro veces. Este iPhone está en modo avión desde que empecé.» |
| 0:25–0:45 | **Alta:** Adela Ruiz Pacheco, 44, San Martín Peras → consentimiento → firma → Guardar → folio | «Adela llega por primera vez. La enfermera anota nombre, apellidos, edad y comunidad. No pedimos domicilio, teléfono ni CURP, que mucha gente en la sierra no tiene. Sin la firma de Adela la app no guarda, y el folio sale aquí mismo, sin señal.» |
| 0:45–1:05 | **Búsqueda:** «Eulalia Garsia Luna, 67» → Eulalia García Luna, 1958, puntaje y razones, línea de IA | «Luego llega Eulalia. La enfermera escribe García con s y pone 67 años, porque no sabe la fecha. La app encuentra a Eulalia García Luna, nacida en 1958, y dice por qué: nombre parecido, misma edad, misma comunidad. El modelo de Apple que corre en el teléfono lo explica en una línea. La enfermera confirma; la app nunca une expedientes sola.» |
| 1:05–1:25 | **Segunda visita y acceso:** expediente como Enfermería (resultados con candado) → rol Médico → BI-RADS 4 de marzo 2025 → agregar estudio | «La enfermera no ve resultados. Cambio a médico: en marzo de 2025 la mastografía de Eulalia salió BI-RADS 4 y la mandaron a Huajuapan. No hay registro de que haya llegado. El médico anota el estudio de hoy como una visita nueva.» |
| 1:25–1:50 | **Sin señal → sincroniza:** Jornada «2 pendientes» → quitar modo avión → Sincronizar → terminal `curl /api/seguimiento` y `/api/bitacora` | «Todo quedó en el teléfono: dos registros pendientes. Quito el modo avión y sincronizo. Si la señal se corta y el envío se repite, Valkey reconoce cada registro por su llave y no lo duplica. Eulalia aparece en seguimiento como vencida, y la bitácora dice quién hizo cada cambio, sin datos clínicos.» |
| 1:50–2:00 | Diapositiva de arquitectura o README | «Los datos de salud no salen a la nube para usar la IA. El repo es público, con licencia MIT y datos ficticios para correrlo.» |

Unas 280 palabras habladas.

## Opcional (si sobra tiempo o lo piden en preguntas)

Foto de la hoja de revisión mamaria de EIRA llenada con datos ficticios → «Escanear» → la app propone el alta y la enfermera revisa.

## Plan B

- Si Foundation Models no responde, la búsqueda muestra puntaje y razones igual; se omite la frase del modelo.
- Si el iPhone no llega a la API: simulador + «Simular sin señal» en Jornada.
- Si falla iOS: terminal con `curl` a `/api/buscar?nombre=Eulalia&apellidoPaterno=Garsia&apellidoMaterno=Luna&edad=67`, `/api/duplicados` y el seed corrido dos veces (aplicados, luego repetidos).
