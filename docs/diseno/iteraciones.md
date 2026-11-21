# Iteraciones de revisión

Capturas en `capturas/iter<N>-<pantalla>[-oscuro].png`, sacadas con el modo captura (`-pantalla <nombre>`), iPhone 17, iOS 26.1.

## Iteración 1 (la UI tal como estaba)

- Visto: el expediente abría con una tarjeta en degradado rosa, sombra y tres cifras (la plantilla de «métrica héroe»); Jornada tenía el número en degradado; el sello de guardado también. Tarjetas con sombra y, en Revisión y en la línea de la IA, tarjetas dentro de tarjetas.
- Visto: texto de más. «¿Ya vino antes?», un ícono que respiraba y dos renglones de ayuda en Buscar; «No pedimos dirección, teléfono ni CURP», ayudas bajo el interruptor y bajo «Antes de salir»; «Resultado visible solo para el médico» repetido en cada estudio; «Primera visita» con ✨ (sparkles).
- Visto: el selector de rol era un ícono sin texto (no se sabía quién estaba usando el teléfono); cada coincidencia tenía su botón y competía con «Es nueva»; razones cortadas en un carrusel horizontal.
- Cambio: nuevo `Tema.swift` (tokens de color claro/oscuro con AA, 5 estilos de letra, escala de 4, radios, 44 pt, dos resortes). Fuera degradados y sombras; tarjetas planas del sistema. Encabezado del expediente como texto. Candidata = una fila que se toca entera («Es ella ›»); «Es nueva» abajo, al alcance del pulgar. Candado una sola vez («Resultados: solo médico»). Rol con nombre.

## Iteración 2

- Visto: en Alta, el texto «Falta: firma» flotaba sin fondo encima del lienzo de firma y el botón gris tapaba el lienzo.
- Visto: el resumen del médico y la explicación de la coincidencia decían «Leyendo…» mientras el modelo trabajaba; no describe lo que pasa.
- Cambio: el botón deshabilitado dice qué falta («Falta: firma») y al completarse cambia a «Guardar»; se quitó el texto suelto.
- Cambio: `LineaIA` recibe su texto de espera: «Resumiendo…», «Comparando…».
- Cambio: logo e ícono de app (expediente con la paciente) en `Assets.xcassets`, con `AccentColor` y `ASSETCATALOG_COMPILER_APPICON_NAME` en `project.yml`.

## Iteración 3 (claro y oscuro)

- Visto: el modo oscuro aguanta (tokens dinámicos, botones con `rosaRelleno` #D61F7E para que el texto blanco pase AA). El botón «Escanear» de Buscar era un ícono (doc.viewfinder) que no se entiende sin etiqueta.
- Visto: el encabezado del expediente y la ayuda de Buscar estaban 4 pt adentro del borde de las tarjetas; no alineaban con el título grande.
- Visto: el modo captura guardaba el rol en los ajustes del teléfono.
- Cambio: «Escanear» como texto en la barra; encabezado y ayudas alineados al borde de las tarjetas; rol y comunidad del modo captura en el dominio volátil de argumentos.
- Cambio (pedido de Jorge): arranque. `UILaunchScreen` con `FondoArranque` + `LogoMarca`; `Arranque.swift` empieza idéntico, crece con resorte sin rebote y se desvanece hacia Buscar (0.9 s; con Reducir movimiento solo se desvanece). Primera prueba: el arranque tomaba el tamaño del `ProgressView` y se veía un recuadro; se corrigió con un `ZStack` a pantalla completa.

## Iteración 4 (claro y Dynamic Type extra-extra-large)

- Visto: con letra XXL nada se corta: los campos se apilan (`Renglon`), «Elegir foto» y «Usar ejemplo» también, y en Revisión «Son distintas» y «Unir» quedan uno sobre otro con 44 pt.
- Visto: en Alta la firma queda abajo del pliegue (en tamaño normal y más en XXL). El botón deshabilitado decía «Falta: firma» pero no llevaba a ningún lado; con prisa, la enfermera no sabe que tiene que bajar.
- Cambio: mientras falte algo, el botón es de vidrio (no rosa lleno), dice qué falta y al tocarlo baja a la firma o sube a los datos, con aviso háptico. Sin firma sigue sin guardarse (`guardar()` sale si no está listo).

## Iteración 5 (verificación final, claro y oscuro)

- Visto: las 8 pantallas cumplen la lista: sin degradados, sin sombras propias, sin tarjetas anidadas, títulos de 1 o 2 palabras, una acción rosa por pantalla abajo, un solo texto de ayuda donde hace falta, IA marcada solo donde escribe. Contraste correcto en los dos modos.
- Sin cambios de código en esta vuelta; estas son las capturas finales (`iter5-*.png` y `iter5-*-oscuro.png`).
- Pendiente menor: en Revisión la segunda tarjeta queda bajo la barra de pestañas hasta que se desplaza; en el arranque la barra de estado sale oscura sobre el rosa.
- No verificado en simulador: el toque en «Falta: firma» que baja al lienzo (no hay automatización de toques aquí) y las líneas de IA, que no aparecieron porque el modelo no respondió en el simulador.
