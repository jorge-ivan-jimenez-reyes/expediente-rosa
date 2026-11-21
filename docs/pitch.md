# Guion del pitch (2 minutos)

Un iPhone en modo avión proyectado en pantalla, y una terminal al lado con la API. Las pacientes son las ficticias de `seed/pacientes.json`. Antes de subir: `docker compose up -d`, `cd api && pnpm seed`, y en la app «Preparar jornada» con San Martín Peras **con señal**. Luego modo avión.

Los nombres de botones salen de `SPEC.md`; si la UI final dice otra cosa, se ajusta aquí.

| Tiempo | En pantalla | Se dice |
|---|---|---|
| 0:00–0:15 | Foto o mapa de la sierra de Oaxaca | «Hoy a las nueve y media, EIRA nos contó que en este momento tiene una brigada en la sierra de Oaxaca y Guerrero. Son unas siete horas de camino y hasta tres días sin señal. Llevan 80,000 estudios en tres años, todos anotados en hojas de papel.» |
| 0:15–0:25 | iPhone: ícono de modo avión encendido | «Cuando una señora regresa al año siguiente, la buscan por su nombre. Si el año pasado alguien escribió "Garsia" con s, su mastografía anormal se queda en una hoja en una caja. Este iPhone está en modo avión desde que empecé.» |
| 0:25–0:50 | **1. Alta.** Rol Enfermería → «Es nueva» → Adela Ruiz Pacheco, 44 años, San Martín Peras → texto de consentimiento → firma con el dedo → Guardar. Aparece el folio | «Primero, una paciente nueva. Pedimos nombre, apellidos, edad y comunidad, nada más: ni dirección, ni teléfono, ni CURP, que mucha gente en la sierra no tiene. Sin su firma la app no guarda. El folio se genera aquí mismo, sin señal.» |
| 0:50–1:15 | **2. Búsqueda.** Buscar → «Eulalia Garsia Luna, 67» → primera candidata: Eulalia García Luna, nacida en 1958, con puntaje y razones | «Ahora llega Eulalia. La enfermera escribe García con s y pone la edad, porque no se sabe la fecha. La app encuentra a Eulalia García Luna, nacida en 1958, y dice por qué: nombre parecido, misma edad con un año de margen, misma comunidad. Con Apple Intelligence, el modelo del teléfono lo explica en una línea. A una madre y una hija que se llaman igual las deja separadas porque nacieron con 27 años de diferencia.» |
| 1:15–1:35 | **3. Segunda visita.** «Es ella» → cambia a rol Médico → expediente: mastografía BI-RADS 4 y ultrasonido anormal del 14 de marzo de 2025, referencia pendiente | «Es ella. La enfermera no ve resultados; el médico sí. En marzo de 2025 su mastografía salió BI-RADS 4 y la mandaron a Huajuapan. No hay registro de que haya llegado. El médico registra el estudio de hoy.» |
| 1:35–1:55 | **4. Sin señal → sincroniza.** Inicio: «2 pendientes». Quitar modo avión → «Sincronizar» → «2 aplicados». Otra vez → «0 aplicados, 2 repetidos». Terminal: `curl /api/estadisticas` y `/api/seguimiento` | «Todo esto se guardó en el teléfono: dos pendientes, el alta de Adela y el estudio de Eulalia. Quito el modo avión y sincronizo: dos aplicados. Si la señal se corta a la mitad y se manda otra vez, el servidor reconoce cada envío por su llave y no duplica. En el servidor, Eulalia aparece en la lista de seguimiento como vencida.» |
| 1:55–2:00 | README del repo | «La IA corre en el teléfono y los datos de salud no salen a la nube. El código está en el repo, con licencia MIT y datos ficticios para correrlo.» |

Unas 300 palabras habladas. Si el tiempo aprieta, se corta la frase de madre e hija del punto 2.

## Plan B

- Si Foundation Models no responde, la búsqueda muestra puntaje y razones igual; no se menciona la línea del modelo.
- Si el iPhone no llega a la API: correr la demo en el simulador con `docker compose stop api` como «sin señal» y `docker compose start api` para sincronizar.
- Si falla todo lo de iOS: terminal con `curl` a `/api/buscar?nombre=Eulalia&apellidoPaterno=Garsia&apellidoMaterno=Luna&edad=67`, `/api/duplicados` y el seed corrido dos veces (88 aplicados, luego 88 repetidos).
