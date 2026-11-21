// Mascota de Expediente Rosa para el panel: el expediente del logo con cara.
// Misma geometría que docs/diseno/mascota.svg y ios/ExpedienteRosa/Pantallas/Mascota.swift
// (logo de 624 × 560 desplazado 78,110 dentro de un cuadro de 940 con 80 de aire por lado).
// Decorativa: siempre aria-hidden. Se anima con CSS (estilos.css, sección «Mascota»);
// el parpadeo lo pone este archivo porque es un cambio de expresión y sigue con «Reducir movimiento».
//
//   Mascota.crear('reposo', { tamano: 64 })      → <svg class="mascota" data-estado="reposo">
//   Mascota.cambiar(svg, 'contenta', { volver: 'reposo', tras: 2000 })
//
// Estados: reposo · saluda · contenta · buscando · sinSenal.
// `tamano` es el ancho del expediente en px; la caja de layout mide eso mismo (el aire sobra hacia afuera).
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const ESTADOS = ['reposo', 'saluda', 'contenta', 'buscando', 'sinSenal'];

  // Un pivote: el grupo de afuera pone el origen en (x, y); el de adentro se anima con CSS
  // alrededor de su 0,0; el último regresa las coordenadas. Así no depende de transform-box.
  const pivote = (x, y, clase, contenido) =>
    `<g transform="translate(${x} ${y})"><g class="${clase}"><g transform="translate(${-x} ${-y})">${contenido}</g></g></g>`;

  function dibujo(sobreRosa) {
    // Sobre rosa (arranque, botón): hoja de atrás blanca translúcida y hoja de enfrente sin borde, como el logo.
    const hoja = sobreRosa
      ? '<rect class="m-hoja" x="78" y="230" width="624" height="440" rx="56"/>'
      : '<rect class="m-hoja" x="87" y="239" width="606" height="422" rx="47" stroke-width="18"/>';
    const ojo = (x) => pivote(x, 428, 'm-ojo', `<rect x="${x - 32}" y="380" width="64" height="96" rx="32"/>`);
    const cara = `
      <g class="m-mejillas"><ellipse cx="196" cy="519" rx="48" ry="27"/><ellipse cx="584" cy="519" rx="48" ry="27"/></g>
      <g class="m-mirada">
        <g class="m-ojos-redondos">${ojo(282)}${ojo(498)}</g>
        <path class="m-ojos-felices m-trazo" d="M244 444 Q282 388 320 444 M460 444 Q498 388 536 444"/>
        <path class="m-ojos-tranquilos m-trazo" d="M246 426 Q282 458 318 426 M462 426 Q498 458 534 426"/>
      </g>
      <g class="m-boca-mirada">
        <path class="m-boca m-boca-sonrisa m-trazo" d="M360 506 Q390 532 420 506"/>
        <path class="m-boca m-boca-abierta m-relleno" d="M353 500 Q390 559 427 500 Z"/>
        <path class="m-boca m-boca-grande m-relleno" d="M346 500 Q390 570 434 500 Z"/>
        <path class="m-boca m-boca-chica m-trazo" d="M370 506 Q390 518 410 506"/>
      </g>`;
    const cuerpo =
      '<path class="m-atras" d="M134 110 H298 Q322 110 336 130 L368 178 H646 Q702 178 702 234 V478 H78 V166 Q78 110 134 110 Z"/>' +
      // Mano: pivote en la orilla derecha de la hoja; queda detrás de la hoja de enfrente.
      pivote(678, 506, 'm-mano', '<rect x="640" y="356" width="76" height="162" rx="38"/>') +
      hoja + cara;
    return (
      `<g class="m-nube"><circle cx="579.8" cy="112.8" r="49.4"/><circle cx="655.2" cy="76.4" r="65"/><circle cx="722.8" cy="107.6" r="46.8"/><rect x="530.4" y="105" width="239.2" height="57.2" rx="28.6"/></g>` +
      // Salto (traslada y aplasta) › respirar › girar: los tres desde el pie, al centro.
      pivote(390, 661, 'm-salto', pivote(390, 661, 'm-respira', pivote(390, 661, 'm-giro', cuerpo)))
    );
  }

  function crear(estado = 'reposo', { tamano = 56, sobreRosa = false, clase = '' } = {}) {
    const svg = document.createElementNS(NS, 'svg');
    // viewBox desde 0,0 (el dibujo va dentro de translate(80 80)): así el origen de las
    // transformaciones CSS es el mismo en todos los navegadores.
    svg.setAttribute('viewBox', '0 0 940 940');
    svg.setAttribute('class', `mascota${sobreRosa ? ' sobre-rosa' : ''}${clase ? ' ' + clase : ''}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.setProperty('--m-tam', `${tamano}px`);
    svg.innerHTML = `<g transform="translate(80 80)">${dibujo(sobreRosa)}</g>`;
    svg.dataset.estado = ESTADOS.includes(estado) ? estado : 'reposo';
    parpadear(svg);
    return svg;
  }

  // Cambia de estado y reinicia sus animaciones (un segundo «contenta» vuelve a brincar).
  // Con `volver` y `tras`, regresa a ese estado después de `tras` ms.
  function cambiar(svg, estado, { volver, tras } = {}) {
    if (!svg) return;
    clearTimeout(svg._regreso);
    svg.removeAttribute('data-estado');
    void svg.getBoundingClientRect(); // fuerza el reinicio de las animaciones CSS
    svg.dataset.estado = ESTADOS.includes(estado) ? estado : 'reposo';
    if (volver && tras) svg._regreso = setTimeout(() => { svg.dataset.estado = volver; }, tras);
  }

  // Parpadeo al azar cada 3–5 s (~130 ms), como en la app. Se detiene solo cuando la mascota sale del DOM.
  function parpadear(svg) {
    const siguiente = () => {
      svg._parpadeo = setTimeout(() => {
        if (svg.isConnected) {
          svg._vista = true;
          if (!document.hidden) {
            svg.classList.add('parpadea');
            setTimeout(() => svg.classList.remove('parpadea'), 130);
          }
        } else if (svg._vista) {
          return; // ya estuvo en pantalla y la quitaron: no programa más
        }
        siguiente();
      }, 3000 + Math.random() * 2000);
    };
    siguiente();
  }

  window.Mascota = { crear, cambiar, ESTADOS };
})();
