# Guion del pitch (2 minutos), versión 7

Orden: la paciente que regresa primero, luego la nueva, sincronizar y el tablero. Cubre lo que pide el Reto 1: alta de una paciente ficticia, búsqueda con detección de coincidencia, segunda visita con historial, trabajo sin conexión verificable y explicación del control de acceso. Son unas 300 palabras habladas.

## Antes de subir

1. En la Mac: `docker compose up -d` y `cd api && pnpm seed`. Abrir `http://localhost:8787/panel` y entrar como Coordinación, con filtro San Martín Peras.
2. En el iPhone, con señal: Jornada → Servidor (IP de la Mac) → estado Oaxaca, comunidad San Martín Peras → bajar pacientes.
3. Demo en el **simulador de la Mac** (iPhone 17). Jornada → activar «Simular sin señal». Rol: Enfermería. Pantalla: Buscar, vacía. Las hojas de Eulalia ya están en Fotos del simulador y en «Ejemplo».
4. Hoja impresa de `docs/hojas-ejemplo/mamaria-p1.jpg` a la mano (solo para preguntas).

## Guion

Hilo (versión de Jorge): planear la visita en el panel → el teléfono se prepara solo → en la sierra sin señal no pasa nada → cara conocida, se escanea y solo se actualiza → vuelve la señal y se sincroniza sin duplicar → coordinación lo gestiona en el panel. Personas ficticias; el problema y las cifras son de EIRA.

**Antes:** `scripts/demo-reset.sh --app` (deja Huejuquilla y Metlatónoc programadas; San Martín Peras se programa en vivo). Panel abierto como Coordinación en Jornadas. Simulador en Jornada, servidor `http://localhost:8787/api`, rol Enfermería.

| Tiempo | En pantalla | Se dice |
|---|---|---|
| 0:00–0:10 | Portada | «Les presentamos Expediente Rosa: una app para la brigada y un panel web para la oficina de EIRA, hecha para trabajar días sin señal.» |
| 0:10–0:28 | Panel → Jornadas → «Programar jornada»: Oaxaca, San Martín Peras, 25 de noviembre, equipo «Enf. Rocío, Dr. Andrés» → Guardar. Simulador → Jornada → «Actualizar ahora» → tarjeta verde «12 pacientes» | «Lunes, Ciudad Guzmán. Coordinación programa la siguiente visita: San Martín Peras, Oaxaca, martes 25, y quién de la brigada va. No es la primera vez que van: ahí ya hay 12 mujeres con expediente. En cuanto la jornada queda programada, el teléfono de la brigada baja solo esas 12 historias.» |
| 0:28–0:40 | Tarjeta «Lista en el teléfono» | «Los datos se quedan en el teléfono, cifrados por iOS con la llave del propio equipo. La IA es el modelo de Apple que corre en el chip del teléfono: lo que lee de las pacientes no sale a ningún servidor.» |
| 0:40–1:00 | Activar «Simular sin señal» → Buscar → Escanear → Ejemplo «Eulalia, marzo 2025» → aparece Eulalia García Luna → «Es ella» | «Martes, nueve y cuarenta, en la sierra. Se va la señal y no pasa nada: los datos ya están aquí. Llega una cara conocida, Eulalia García Luna, de 67 años, con su hoja de 2025. Rocío la escanea y la app la reconoce aunque venga escrita distinto. Rocío confirma; la app nunca une expedientes sola.» |
| 1:00–1:18 | Expediente como Enfermería (candado) → rol Médico → BI-RADS 4 de 2025 → Agregar estudio → «Leer hoja» → «Hoja de hoy: Eulalia» → Guardar | «Rocío no ve resultados; el médico sí. Ve el BI-RADS 4 de 2025 y la referencia a Huajuapan que nunca se cerró. Le toma foto a la hoja de hoy y la app llena BI-RADS 4, la referencia y la nota. Él revisa y guarda: no se crea otra paciente, se actualiza la que ya existía.» |
| 1:18–1:38 | Jornada «pendientes» → apagar «Simular sin señal» → se sincroniza solo | «Jueves, seis y veinte. La camioneta llega a Juxtlahuaca, vuelve la señal y la app sincroniza sola. Si la señal se corta a la mitad, no pasa nada: cada registro lleva una llave y Valkey no aplica dos veces el mismo. Eulalia entra sola a la lista de seguimiento.» |
| 1:38–1:55 | Panel → Tablero San Martín Peras → Patología → Seguimiento | «Viernes, de vuelta en Ciudad Guzmán. Coordinación ve lo que trajo la brigada, el patólogo interpreta los papanicolaous que quedaron en laboratorio y Eulalia aparece en seguimiento para que alguien la llame. Cada paso queda en la bitácora, sin datos clínicos.» |
| 1:55–2:00 | Diapositiva de arquitectura | «El código es público, con licencia MIT.» |

## Si preguntan

- **¿Y las hojas viejas?** Foto de la hoja impresa de revisión mamaria → Escanear → la app propone a Rosa María Santiago Cruz, 55 años, mastografía BI-RADS 2; la enfermera revisa antes de guardar.
- **¿Qué pasa si dos enfermeras registran a la misma señora?** Al sincronizar va a Revisión → Duplicados; la coordinadora une o separa.
- **¿Y si dos teléfonos cambian el mismo dato?** Gana el primero; el otro va a Conflictos para que alguien decida.
- **¿Quién ve qué?** Tarjeta en Jornada: Enfermería captura y no ve resultados; Médico ve y agrega estudios; Coordinación revisa duplicados, conflictos y bitácora; Patología solo interpreta muestras.

## Plan B

- Si Foundation Models no responde, la búsqueda muestra puntaje y razones igual; se omite la frase del modelo.
- Si el iPhone no llega a la API: simulador en la Mac + «Simular sin señal» en Jornada.
- Si falla iOS: terminal con `curl` a `/api/buscar?nombre=Eulalia&apellidoPaterno=Garsia&apellidoMaterno=Luna&edad=67` y el panel web.
