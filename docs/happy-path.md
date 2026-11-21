# Recorrido completo de una brigada

1. **Antes de salir (con señal, oficina en Ciudad Guzmán).** En la app, Jornada → elige estado (Oaxaca) y comunidad (San Martín Peras) → «Bajar pacientes». El teléfono guarda a las que ya vinieron antes, con su historial.
2. **En la comunidad (sin señal, hasta 3 días).**
   - Llega una señora. Enfermería la busca por nombre y edad. Si aparece («Es ella»), abre su expediente; si no, «Es nueva»: datos mínimos + firma de consentimiento → folio.
   - Si trae su hoja de papel de una jornada pasada: «Escanear» → la app propone los datos → enfermería revisa y guarda.
   - El médico ve el historial (resultados, BI-RADS, conducta) y registra los estudios de hoy. La mastografía o el ultrasonido pueden quedar con resultado; el papanicolaou queda «En laboratorio».
   - Todo se guarda en el teléfono como pendiente. Si dos enfermeras registran a la misma señora en dos teléfonos, no pasa nada todavía.
3. **Al volver la señal.** «Sincronizar». Cada registro tiene llave única: si la conexión se corta y se repite, no se duplica. El servidor cruza contra toda la base y manda los posibles duplicados y los cambios encontrados a Revisión.
4. **Coordinación.** En el panel web: tablero con personas únicas, estudios, anormales y pendientes por estado y comunidad, seguimiento y bitácora. En la app (pestaña Revisión, rol Coordinación): duplicados (une o separa, nunca el sistema solo) y conflictos.
5. **Patología (panel web).** El patólogo entra con su nombre, ve las muestras por interpretar (la que más espera primero), captura el resultado Bethesda. Si es anormal, entra solo a la lista de seguimiento con fecha límite.
6. **Seguimiento.** Coordinación ve las anormales vencidas primero, avisa a la paciente y la marca como avisada. Cada paso queda en la bitácora, sin datos clínicos.
7. **Siguiente jornada.** Cuando la brigada vuelve a esa comunidad, «Bajar pacientes» trae el historial actualizado, incluido el resultado del patólogo.
