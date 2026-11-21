# Guion del pitch (2 minutos), versión 3

Orden: la paciente que regresa primero, luego la nueva, sincronizar y el tablero. Cubre lo que pide el Reto 1: alta de una paciente ficticia, búsqueda con detección de coincidencia, segunda visita con historial, trabajo sin conexión verificable y explicación del control de acceso. Son unas 300 palabras habladas.

## Antes de subir

1. En la Mac: `docker compose up -d` y `cd api && pnpm seed`. Abrir `http://localhost:8787/panel` y entrar como Coordinación, con filtro San Martín Peras.
2. En el iPhone, con señal: Jornada → Servidor (IP de la Mac) → estado Oaxaca, comunidad San Martín Peras → bajar pacientes.
3. Poner modo avión. Rol: Enfermería. Pantalla: Buscar, vacía.
4. Hoja impresa de `docs/hojas-ejemplo/mamaria-p1.jpg` a la mano (solo para preguntas).

## Guion

| Tiempo | En pantalla | Se dice |
|---|---|---|
| 0:00–0:25 | Diapositiva 1 o nada | «Marzo de 2025, San Martín Peras, Oaxaca. A Eulalia, de 66 años, le sale una mastografía BI-RADS 4 y la mandan a Huajuapan. El resultado queda en una hoja de papel, en una caja en Ciudad Guzmán. Hoy la brigada regresa, a siete horas de camino y sin señal. EIRA nos contó esta mañana que una mujer que va cuatro veces en un año puede quedar registrada cuatro veces. Eulalia es ficticia; el problema es el que nos contaron.» |
| 0:25–0:50 | iPhone en modo avión → Buscar: «Eulalia», «Garsia», «Luna», 67 → aparece Eulalia García Luna con puntaje, razones y línea de IA | «Este iPhone está en modo avión. La enfermera escribe García con s y pone 67 años, porque no sabe la fecha. La app encuentra a Eulalia García Luna y dice por qué: nombre parecido, misma edad, misma comunidad. El modelo de Apple, que corre en el teléfono, lo explica en una línea. La enfermera confirma; la app nunca une expedientes sola.» |
| 0:50–1:05 | «Es ella» → expediente como Enfermería (resultados con candado) → cambiar a Médico → BI-RADS 4 → Agregar estudio | «La enfermera no ve resultados. Cambio a médico: ahí está el BI-RADS 4 de marzo y la referencia a Huajuapan sin cerrar. El médico registra la mastografía de hoy en una visita nueva.» |
| 1:05–1:20 | Buscar → «Es nueva» → Adela Ruiz Pacheco, 44 → consentimiento → firma → Guardar → folio | «Después llega Adela, que nunca ha venido. Pedimos nombre, apellidos, edad y comunidad; no pedimos domicilio, teléfono ni CURP. Sin su firma la app no guarda, y el folio sale sin señal.» |
| 1:20–1:40 | Jornada: «2 pendientes» → quitar modo avión → Sincronizar → nuevos / ya estaban | «Quito el modo avión y sincronizo: dos registros. Si la señal se corta y se repite el envío, Valkey reconoce cada registro por su llave y no lo duplica. Eulalia entra sola a la lista de seguimiento como vencida.» |
| 1:40–1:55 | Panel web en la Mac: tablero de San Martín Peras → Patología | «Al regresar, coordinación ve esto: San Martín Peras, [N] personas, [N] estudios y los papanicolaous que esperan al patólogo. El patólogo captura el resultado aquí y, si sale anormal, también entra a seguimiento.» |
| 1:55–2:00 | Diapositiva de arquitectura | «La IA corre en el teléfono y los datos de salud no salen a la nube para usarla. El repo es público, con licencia MIT.» |

Las cifras entre corchetes se llenan con lo que muestre el tablero después del seed.

## Si preguntan

- **¿Y las hojas viejas?** Foto de la hoja impresa de revisión mamaria → Escanear → la app propone a Rosa María Santiago Cruz, 55 años, mastografía BI-RADS 2; la enfermera revisa antes de guardar.
- **¿Qué pasa si dos enfermeras registran a la misma señora?** Al sincronizar va a Revisión → Duplicados; la coordinadora une o separa.
- **¿Y si dos teléfonos cambian el mismo dato?** Gana el primero; el otro va a Conflictos para que alguien decida.
- **¿Quién ve qué?** Tarjeta en Jornada: Enfermería captura y no ve resultados; Médico ve y agrega estudios; Coordinación revisa duplicados, conflictos y bitácora; Patología solo interpreta muestras.

## Plan B

- Si Foundation Models no responde, la búsqueda muestra puntaje y razones igual; se omite la frase del modelo.
- Si el iPhone no llega a la API: simulador en la Mac + «Simular sin señal» en Jornada.
- Si falla iOS: terminal con `curl` a `/api/buscar?nombre=Eulalia&apellidoPaterno=Garsia&apellidoMaterno=Luna&edad=67` y el panel web.
