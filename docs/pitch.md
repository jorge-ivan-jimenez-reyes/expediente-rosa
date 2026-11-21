# Guion del pitch (2 minutos), versión 5

Orden: la paciente que regresa primero, luego la nueva, sincronizar y el tablero. Cubre lo que pide el Reto 1: alta de una paciente ficticia, búsqueda con detección de coincidencia, segunda visita con historial, trabajo sin conexión verificable y explicación del control de acceso. Son unas 300 palabras habladas.

## Antes de subir

1. En la Mac: `docker compose up -d` y `cd api && pnpm seed`. Abrir `http://localhost:8787/panel` y entrar como Coordinación, con filtro San Martín Peras.
2. En el iPhone, con señal: Jornada → Servidor (IP de la Mac) → estado Oaxaca, comunidad San Martín Peras → bajar pacientes.
3. Poner modo avión. Rol: Enfermería. Pantalla: Buscar, vacía.
4. Hoja impresa de `docs/hojas-ejemplo/mamaria-p1.jpg` a la mano (solo para preguntas).

## Guion

Hilo: una sola semana de una brigada, contada con día y hora. Personas ficticias (Eulalia, Adela, la enfermera Rocío); el problema y las cifras de EIRA son reales. Poner «Personas ficticias» en la diapositiva 1.

| Tiempo | En pantalla | Se dice |
|---|---|---|
| 0:00–0:10 | Portada | «Les presentamos Expediente Rosa, un ecosistema para administrar los expedientes de las pacientes de EIRA: una app en el teléfono de la brigada y un panel web para coordinación y patología. Funciona aunque pasen días sin señal.» |
| 0:10–0:28 | Diapositiva: la semana de una brigada | «Martes, nueve y cuarenta. San Martín Peras, en la Mixteca de Oaxaca. La brigada lleva dos días sin señal. La enfermera Rocío atiende a Eulalia García Luna, de 67 años. En marzo de 2025, a Eulalia le salió una mastografía BI-RADS 4 y la mandaron a Huajuapan. Ese resultado está en una hoja de papel, en una caja en Ciudad Guzmán. Rocío no lo sabe.» |
| 0:28–0:50 | iPhone en modo avión → Buscar: «Eulalia», «Garsia», «Luna», 67 → aparece Eulalia García Luna con puntaje, razones y línea de IA | «Rocío escribe García con s y pone 67, porque Eulalia no sabe su fecha de nacimiento. Este iPhone está en modo avión. La app la encuentra y dice por qué: nombre parecido, misma edad, misma comunidad. El modelo de Apple, que corre aquí mismo, lo explica en una línea. Rocío confirma que es ella; la app nunca une expedientes sola.» |
| 0:50–1:04 | «Es ella» → expediente como Enfermería (candado) → cambiar a Médico → BI-RADS 4 → Agregar estudio | «Rocío no ve resultados. El médico sí: ve el BI-RADS 4 y la referencia que nunca se cerró, y registra la mastografía de hoy en una visita nueva.» |
| 1:04–1:15 | Buscar → «Es nueva» → Adela Ruiz Pacheco, 44 → firma → Guardar | «Detrás de Eulalia viene Adela, de 44, que nunca ha venido. Nombre, apellidos, edad, comunidad y su firma. Sin firma no se guarda.» |
| 1:15–1:35 | Jornada «2 pendientes» → quitar modo avión → Sincronizar | «Jueves, seis y veinte de la tarde. La camioneta llega a Juxtlahuaca y vuelve la señal. Rocío sincroniza. Si la señal se corta a la mitad, Valkey reconoce cada registro por su llave y no lo duplica. Eulalia entra a la lista de seguimiento como vencida.» |
| 1:35–1:52 | Panel web: San Martín Peras → Patología | «Viernes, Ciudad Guzmán. Coordinación ve San Martín Peras: trece mujeres, sus estudios y tres papanicolaous esperando al patólogo. El patólogo los interpreta desde aquí; si alguno sale anormal, entra a seguimiento igual que Eulalia.» |
| 1:52–2:00 | Diapositiva de arquitectura | «La próxima vez que la brigada suba a San Martín Peras, el teléfono de Rocío ya trae el resultado. El código es público, con licencia MIT.» |

Cifras del tablero verificadas con el seed (21-nov, 12:05): San Martín Peras 12 personas + Adela = 13; 3 papanicolaous en laboratorio. Si el médico agrega un papanicolaou en la demo, serán 4: decirlo como lo muestre la pantalla.

## Si preguntan

- **¿Y las hojas viejas?** Foto de la hoja impresa de revisión mamaria → Escanear → la app propone a Rosa María Santiago Cruz, 55 años, mastografía BI-RADS 2; la enfermera revisa antes de guardar.
- **¿Qué pasa si dos enfermeras registran a la misma señora?** Al sincronizar va a Revisión → Duplicados; la coordinadora une o separa.
- **¿Y si dos teléfonos cambian el mismo dato?** Gana el primero; el otro va a Conflictos para que alguien decida.
- **¿Quién ve qué?** Tarjeta en Jornada: Enfermería captura y no ve resultados; Médico ve y agrega estudios; Coordinación revisa duplicados, conflictos y bitácora; Patología solo interpreta muestras.

## Plan B

- Si Foundation Models no responde, la búsqueda muestra puntaje y razones igual; se omite la frase del modelo.
- Si el iPhone no llega a la API: simulador en la Mac + «Simular sin señal» en Jornada.
- Si falla iOS: terminal con `curl` a `/api/buscar?nombre=Eulalia&apellidoPaterno=Garsia&apellidoMaterno=Luna&edad=67` y el panel web.
