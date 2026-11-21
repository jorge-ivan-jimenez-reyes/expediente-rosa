# Sistema de diseño: Expediente Rosa

En código: `ios/ExpedienteRosa/Pantallas/Tema.swift`. Escena: enfermera en una jornada rural, de pie, al sol o bajo techo de lámina, teléfono en una mano y la fila esperando. Por eso: modo claro por defecto, alto contraste, una acción grande abajo.

## Color

Estrategia contenida: neutros del sistema + un solo acento rosa. Los colores de estado solo aparecen en resultados de estudios y en la señal.

| Token | Claro | Oscuro | Uso | Contraste |
|---|---|---|---|---|
| `rosa` | #C4006A | #FF5FA8 | Texto, íconos, controles, `AccentColor` | 5.9:1 sobre blanco · 6.0:1 sobre #1C1C1E |
| `rosaRelleno` | #C4006A | #D61F7E | Fondo de botón principal (texto blanco) | blanco encima 5.9:1 · 4.8:1 |
| `rosaSuave` | #FCE4EF | #3D1029 | Fondo de selección | rosa encima 4.9:1 · 5.7:1 |
| `verde` | #1B7A43 | #4CD787 | Resultado normal, en línea | 5.4:1 · 9.2:1 |
| `ambar` | #9A5700 | #FFB340 | Pendiente, sin señal | 5.6:1 · 9.5:1 |
| `rojo` | #C42B2B | #FF7070 | Anormal, errores | 5.6:1 · 6.3:1 |
| `fondo` | systemGroupedBackground | igual | Fondo de pantalla | sistema |
| `superficie` | secondarySystemGroupedBackground | igual | Tarjetas | sistema |
| `campo` | tertiarySystemGroupedBackground | igual | Campos de texto, lienzo de firma | sistema |

## Tipografía (SF, Dynamic Type, 5 estilos)

| Token | Estilo | Uso |
|---|---|---|
| `.cifra` | largeTitle bold rounded, dígitos fijos | Pendientes por mandar |
| `.titulo` | title2 bold | Nombre de la paciente |
| `.seccion` | headline | Títulos de sección, nombres en filas, botones |
| `.cuerpo` | body | Campos, texto, consentimiento |
| `.nota` | footnote | Etiquetas, fechas, folio (mono), la única ayuda |

## Espaciado, radios, toque

| Token | Valor |
|---|---|
| `Espacio` | 4 · 8 · 12 · 16 · 24 · 32 |
| Margen de pantalla y relleno de tarjeta | 16 |
| Entre tarjetas | 16 |
| `Radio.campo` | 12 |
| `Radio.tarjeta` | 20 |
| `toque` (alto mínimo) | 44 pt |

## Profundidad

| Capa | Tratamiento |
|---|---|
| Tarjetas | Planas, sin sombra, nunca una dentro de otra |
| Barras, botones, píldora de señal | Vidrio de iOS 26 (`glassEffect`, `.glass`, `.glassProminent`) |
| Confirmación de guardado | `regularMaterial` a pantalla completa |

## Movimiento

| Token | Resorte | Cuándo |
|---|---|---|
| `resorte` | response 0.35, damping 1.0 | Todo: aparecer, cambiar, quitar |
| `resorteLogro` | response 0.45, damping 0.75 | Solo al guardar una alta y al sincronizar |
| Reducir movimiento | Sin anillo animado; el barrido de la hoja pasa a parpadeo suave | |

## Iconografía (SF Symbols)

| Uso | Símbolo |
|---|---|
| Normal / Anormal / Pendiente | checkmark.circle.fill / exclamationmark.triangle.fill / clock.fill |
| Mastografía / Ultrasonido / Papanicolaou / Exploración | circle.circle / waveform / testtube.2 / hand.raised |
| Escrito por la IA del teléfono | apple.intelligence (solo ahí) |
| Señal | antenna.radiowaves.left.and.right(.slash) |

Un ícono acompaña a una acción o a un estado. No hay íconos de adorno en títulos.

## Reglas de texto

| Regla | Ejemplo |
|---|---|
| Títulos de 1 a 3 palabras | Buscar · Nueva paciente · Jornada |
| Botones con verbo, 3 palabras o menos | Guardar · Dar de alta · Agregar estudio · Sincronizar |
| Las decisiones usan las palabras de la enfermera | Es ella · Es nueva · Unir · Son distintas |
| Máximo un texto de ayuda por pantalla | «Baja al teléfono las pacientes de la comunidad antes de salir.» |
| Un botón deshabilitado dice qué falta | «Falta: firma» |
| Español de México, de tú, sin signos de admiración ni emojis | |
| La IA se nombra solo donde escribe algo | Resumen, explicación de coincidencia, hoja leída, dictado |

## Logo

`logo.svg` (fuente) y `logo-1024.png` (sin transparencia, copiado a `AppIcon.appiconset`). Un expediente blanco con la silueta de la paciente en rosa, sobre rosa #C4006A. No usa el moño rosa ni el logo de EIRA.
