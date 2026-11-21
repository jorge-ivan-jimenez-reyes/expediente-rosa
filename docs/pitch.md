# Guion del pitch (2 minutos), versión 9

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
| 0:00–0:30 | Diapositiva 1 Rocío → al decir "Para eso hicimos Expediente Rosa", → portada | «Ella es Rocío, enfermera de una brigada de EIRA. Tiene enfrente a una señora que dice que ya vino el año pasado. Rocío busca en sus carpetas y no la encuentra: el año pasado alguien escribió su apellido con s. Hoy EIRA nos compartió que una mujer que va cuatro veces en un año a sus jornadas puede quedar registrada hasta cuatro veces. Para eso hicimos Expediente Rosa, un ecosistema para administrar los expedientes de las pacientes de EIRA: una app para la brigada y un panel web para la oficina, hecho para trabajar días sin señal.» |
| 0:30–0:42 | Panel → Jornadas → «Programar jornada» San Martín Peras, 25 nov, equipo → Guardar. Simulador → Jornada: tarjeta verde «2 pacientes» | «Antes de salir, coordinación programa la visita en el panel: San Martín Peras, miércoles 25, y quién va. El teléfono de la brigada baja solo las historias de las mujeres que ya se atendieron ahí.» |
| 0:42–0:48 | Tarjeta «Lista en el teléfono» | «Se quedan en el teléfono, cifradas, y la IA de Apple trabaja ahí mismo, sin mandar nada a ningún servidor.» |
| 0:48–1:05 | Activar «Simular sin señal» (la mascota saca su nube) → Buscar → Escanear hoja → Ejemplo «Eulalia, marzo 2025» → Eulalia García Luna → «Es ella» | «En la sierra se va la señal y no pasa nada. La señora es Eulalia y trae su hoja de 2025. Rocío la escanea y la app la reconoce aunque venga escrita distinto. Rocío confirma; la app nunca une expedientes sola.» |
| 1:05–1:18 | Expediente como Enfermería (candado) → rol Médico → BI-RADS 4 de 2025 → Agregar estudio → «Leer hoja» → «Hoja de hoy: Eulalia» → Guardar | «Rocío no ve resultados; el médico sí: un BI-RADS 4 de 2025 con una referencia que nunca se cerró. Le toma foto a la hoja de hoy, la app llena BI-RADS 4 y la referencia, y él revisa y guarda.» |
| 1:18–1:33 | Jornada «pendientes» → apagar «Simular sin señal» → se sincroniza solo (mascota contenta) | «Vuelve la señal y la app sincroniza sola. Si se corta a la mitad, cada registro lleva una llave y Valkey no aplica dos veces el mismo. Eulalia entra sola a la lista de seguimiento.» |
| 1:33–1:47 | Panel → Tablero → Patología → Asistente: «¿Qué pasó con Eulalia?» | «En la oficina, coordinación ve lo que trajo la brigada, el patólogo interpreta los papanicolaous, y el asistente, que también corre en esta Mac, resume el caso de Eulalia.» |
| 1:47–2:00 | Diapositiva «Lo que pidió EIRA» → cierre (mascota) | «Eso cubre lo que pidió EIRA: identificador estable, coincidencias que confirma una persona, captura sin señal, sincronización con conflictos, visitas aparte, roles y bitácora. El código es público, con licencia MIT.» |

Unas 330 palabras: va justo. Si te pasas, corta primero la frase de privacidad (0:42) y luego la del asistente.

## Si preguntan

- **¿Y las hojas viejas?** Foto de la hoja impresa de revisión mamaria → Escanear → la app propone a Rosa María Santiago Cruz, 55 años, mastografía BI-RADS 2; la enfermera revisa antes de guardar.
- **¿Qué pasa si dos enfermeras registran a la misma señora?** Al sincronizar va a Revisión → Duplicados; la coordinadora une o separa.
- **¿Y si dos teléfonos cambian el mismo dato?** Gana el primero; el otro va a Conflictos para que alguien decida.
- **¿Quién ve qué?** Tarjeta en Jornada: Enfermería captura y no ve resultados; Médico ve y agrega estudios; Coordinación revisa duplicados, conflictos y bitácora; Patología solo interpreta muestras.

## Plan B

- Si Foundation Models no responde, la búsqueda muestra puntaje y razones igual; se omite la frase del modelo.
- Si el iPhone no llega a la API: simulador en la Mac + «Simular sin señal» en Jornada.
- Si falla iOS: terminal con `curl` a `/api/buscar?nombre=Eulalia&apellidoPaterno=Garsia&apellidoMaterno=Luna&edad=67` y el panel web.
