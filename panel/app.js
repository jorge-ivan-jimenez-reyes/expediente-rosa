// Panel web de Expediente Rosa. HTML + CSS + JS sin build ni dependencias.
// Habla con /api/... (mismo origen). Si un endpoint responde 404 de ruta
// (todavía no existe) o no hay API, usa panel/datos-ejemplo.js.
(function () {
  'use strict';

  // ---------- Utilidades ----------
  const $ = (s, r = document) => r.querySelector(s);
  function h(tag, attrs, ...hijos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of hijos.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...hijos) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of hijos.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const ICONOS = {
    normal: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2l2.1 2.1 4.3-4.6" fill="none" stroke="var(--superficie)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    anormal: '<path d="M8 1.2l7.2 12.6H.8z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M8 6v3.6" stroke="var(--superficie)" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.8" r="0.95" fill="var(--superficie)"/>',
    pendiente: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.4V8l2.4 1.6" fill="none" stroke="var(--superficie)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const icono = (tipo, extra = '') => {
    const el = document.createElementNS(SVGNS, 'svg');
    el.setAttribute('viewBox', '0 0 16 16');
    el.setAttribute('class', `icono estado-${tipo} ${extra}`);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = ICONOS[tipo];
    return el;
  };
  const fmt = new Intl.NumberFormat('es-MX');
  const n = (x) => fmt.format(x ?? 0);
  const TZ = 'America/Mexico_City';
  const fechaCorta = (iso) => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(iso.length === 10 ? iso + 'T12:00:00-06:00' : iso)).replace('.', '');
  const hora = (iso) => new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(iso));
  const diaDe = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
  function cuando(iso) {
    const d = diaDe(iso), hoy = diaDe(new Date().toISOString());
    const ayer = diaDe(new Date(Date.now() - 86400000).toISOString());
    if (d === hoy) return `hoy, ${hora(iso)}`;
    if (d === ayer) return `ayer, ${hora(iso)}`;
    return `${fechaCorta(iso)}, ${hora(iso)}`;
  }
  const nombreCompleto = (p) => [p.nombre, p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' ') || p.apellidos || '';
  const edadDe = (nac) => {
    const [a, m, d] = nac.split('-').map(Number), hoy = new Date();
    return hoy.getFullYear() - a - ((hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) ? 1 : 0);
  };
  const plural = (k, uno, varios) => `${n(k)} ${k === 1 ? uno : varios}`;
  const TIPO_ESTUDIO = { mastografia: 'Mastografía', ultrasonido: 'Ultrasonido', papanicolaou: 'Papanicolaou', exploracion: 'Exploración' };
  const ESTADOS = ['Jalisco', 'Oaxaca', 'Guerrero'];
  const reducido = matchMedia('(prefers-reduced-motion: reduce)');
  // Mascota (panel/mascota.js). Decorativa; si el archivo no cargó, el panel sigue igual.
  const mascota = (estado, opciones) => (window.Mascota ? window.Mascota.crear(estado, opciones) : null);
  const vacioConMascota = (titulo, texto, ...extra) => h('div', { class: 'vacio-vista' },
    mascota('reposo', { tamano: 64 }), h('b', {}, titulo), h('p', {}, texto), ...extra);

  // ---------- Usuario (no es login: solo quién eres) ----------
  const LLAVE = 'expediente-rosa-panel:usuario';
  const leerUsuario = () => { try { return JSON.parse(localStorage.getItem(LLAVE)); } catch { return null; } };
  const guardarUsuario = (u) => { try { localStorage.setItem(LLAVE, JSON.stringify(u)); } catch { /* sin almacenamiento */ } };
  const borrarUsuario = () => { try { localStorage.removeItem(LLAVE); } catch { /* nada */ } };
  let usuario = leerUsuario();

  // ---------- API con respaldo de ejemplo ----------
  let ejemploListo = null;
  function cargarEjemplo() {
    return (ejemploListo ??= new Promise((ok, mal) => {
      if (window.DatosEjemplo) return ok(window.DatosEjemplo);
      const sc = h('script', { src: '/panel/datos-ejemplo.js' });
      sc.onload = () => ok(window.DatosEjemplo);
      sc.onerror = () => mal(new Error('No se pudieron cargar los datos de ejemplo.'));
      document.head.append(sc);
    }));
  }
  // 404 "de ruta" (Hono responde texto plano) vs. 404 de recurso (JSON con error).
  const esRutaFaltante = (res) => res.status === 404 && !(res.headers.get('content-type') || '').includes('json');

  async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
    let res;
    try {
      res = await fetch(ruta, {
        method: metodo,
        headers: cuerpo ? { 'content-type': 'application/json' } : undefined,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch {
      res = null; // sin API: usa el ejemplo
    }
    if (!res || esRutaFaltante(res)) {
      const ej = await cargarEjemplo();
      const r = ej.responder(metodo, ruta, cuerpo);
      return { ok: r.status < 300, status: r.status, datos: r.datos, ejemplo: true };
    }
    let datos = null;
    try { datos = await res.json(); } catch { /* sin cuerpo */ }
    return { ok: res.ok, status: res.status, datos, ejemplo: false };
  }
  const conQuery = (base, q) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    const t = p.toString();
    return t ? `${base}?${t}` : base;
  };

  // ---------- Avisos ----------
  function avisar(texto, { tipo = 'normal', detalle } = {}) {
    const caja = $('#avisos');
    const el = h('div', { class: `aviso ${tipo}` }, icono(tipo === 'error' ? 'anormal' : tipo), h('p', {}, texto, detalle ? h('small', {}, detalle) : null));
    caja.append(el);
    setTimeout(() => { el.classList.add('fuera'); setTimeout(() => el.remove(), 220); }, 5200);
  }

  // Quita un elemento de una lista con una salida corta.
  function sacar(el) {
    return new Promise((listo) => {
      if (!el || reducido.matches) { el?.remove(); return listo(); }
      const alto = el.getBoundingClientRect().height;
      el.style.height = alto + 'px';
      el.classList.add('saliendo');
      setTimeout(() => {
        el.style.transition = 'height 180ms cubic-bezier(0.25,1,0.5,1)';
        el.style.height = '0px';
        setTimeout(() => { el.remove(); listo(); }, 190);
      }, 200);
    });
  }

  // ---------- Rutas ----------
  const VISTAS_COORD = [
    { id: 'tablero', titulo: 'Tablero' },
    { id: 'jornadas', titulo: 'Jornadas' },
    { id: 'seguimiento', titulo: 'Seguimiento' },
    { id: 'bitacora', titulo: 'Bitácora' },
    { id: 'asistente', titulo: 'Asistente' },
  ];
  const VISTAS_PATO = [{ id: 'patologia', titulo: 'Por interpretar' }];
  const vistasDe = (u) => (u?.rol === 'patologia' ? VISTAS_PATO : VISTAS_COORD);

  function rutaActual() {
    const [ruta, query] = location.hash.replace(/^#\/?/, '').split('?');
    return { ruta: ruta || '', q: Object.fromEntries(new URLSearchParams(query || '')) };
  }
  function ir(ruta, q = {}) {
    const destino = '#/' + conQuery(ruta, q);
    if (location.hash === destino) mostrar(); else location.hash = destino;
  }

  let limpiar = () => {};
  async function mostrar() {
    limpiar(); limpiar = () => {};
    const { ruta, q } = rutaActual();
    const vista = $('#vista');
    if (!usuario) { pintarBarra(null); return vistaEntrada(vista); }
    const permitidas = vistasDe(usuario).map((v) => v.id);
    // Coordinación llega a Patología solo desde un folio del asistente, en solo lectura.
    if (usuario.rol !== 'patologia') permitidas.push('patologia');
    if (!permitidas.includes(ruta)) return ir(permitidas[0]);
    pintarBarra(ruta);
    vista.replaceChildren();
    if (ruta === 'tablero') limpiar = await vistaTablero(vista, q) || limpiar;
    if (ruta === 'jornadas') limpiar = await vistaJornadas(vista) || limpiar;
    if (ruta === 'patologia') limpiar = await vistaPatologia(vista, q) || limpiar;
    if (ruta === 'seguimiento') limpiar = await vistaSeguimiento(vista, q) || limpiar;
    if (ruta === 'bitacora') limpiar = await vistaBitacora(vista, q) || limpiar;
    if (ruta === 'asistente') limpiar = await vistaAsistente(vista, q) || limpiar;
    if (ruta === 'tablero' || ruta === 'bitacora') vista.append(botonPreguntar(q));
  }

  function pintarBarra(ruta) {
    const barra = $('#barra');
    if (!usuario) { barra.hidden = true; return; }
    barra.hidden = false;
    const rol = usuario.rol === 'patologia' ? 'Patología' : 'Coordinación';
    barra.replaceChildren(
      h('a', { class: 'marca', href: '#/' + vistasDe(usuario)[0].id }, h('img', { src: '/panel/logo.svg', alt: '' }), h('b', {}, 'Expediente Rosa')),
      h('nav', { class: 'nav', 'aria-label': 'Secciones' },
        vistasDe(usuario).map((v) => h('a', { href: '#/' + v.id, 'aria-current': v.id === ruta ? 'page' : null, 'data-vista': v.id }, v.titulo))),
      h('div', { class: 'quien' },
        cliente(),
        h('span', { class: 'usuario' }, h('b', {}, usuario.nombre), rol),
        h('button', { class: 'boton quieto', type: 'button', onclick: () => { borrarUsuario(); usuario = null; ir(''); } }, 'Cambiar')),
    );
    // En teléfono la navegación se desliza: deja visible la sección actual.
    const actual = barra.querySelector('.nav [aria-current="page"]');
    if (actual) actual.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  // Logo del cliente, aparte del logo propio.
  const cliente = () => h('div', { class: 'cliente' },
    h('img', { src: '/panel/eira-logo.png', alt: 'EIRA', width: '78', height: '28' }),
    h('span', {}, 'Movimiento Rosa'));

  function marcarCuenta(vista, k) {
    const a = $(`.nav a[data-vista="${vista}"]`);
    if (!a) return;
    a.querySelector('.cuenta')?.remove();
    if (k != null) a.append(h('span', { class: 'cuenta' }, n(k)));
  }

  // ---------- 1. Entrada ----------
  function vistaEntrada(vista) {
    document.title = 'Expediente Rosa · Panel';
    // Saluda cuando ya se fue el arranque (si no, el primer saludo queda tapado).
    const saluda = mascota('reposo', { tamano: 48 });
    if (saluda) arranqueListo.then(() => { if (saluda.isConnected) Mascota.cambiar(saluda, 'saluda'); });
    let rol = 'coordinacion';
    const cedula = h('label', { class: 'campo', hidden: true },
      h('span', {}, 'Cédula profesional (opcional)'),
      h('input', { name: 'cedula', inputmode: 'numeric', autocomplete: 'off', maxlength: '12' }));
    const nombre = h('input', { name: 'nombre', required: true, autocomplete: 'name', placeholder: 'Ej. Dra. Laura Méndez' });
    const opcion = (valor, titulo, detalle) => h('div', { class: 'opcion' },
      h('input', { type: 'radio', name: 'rol', id: 'rol-' + valor, value: valor, checked: valor === rol, onchange: () => { rol = valor; cedula.hidden = valor !== 'patologia'; } }),
      h('label', { for: 'rol-' + valor }, h('b', {}, titulo), h('small', {}, detalle)));
    const form = h('form', {
      onsubmit: (ev) => {
        ev.preventDefault();
        const nom = nombre.value.trim();
        if (!nom) { nombre.focus(); return; }
        usuario = { rol, nombre: nom, cedula: rol === 'patologia' ? (cedula.querySelector('input').value.trim() || null) : null };
        guardarUsuario(usuario);
        ir(vistasDe(usuario)[0].id);
      },
    },
      h('fieldset', { class: 'roles' }, h('legend', {}, 'Área'),
        opcion('coordinacion', 'Coordinación', 'Jornadas y seguimiento'),
        opcion('patologia', 'Patología', 'Papanicolaous')),
      h('label', { class: 'campo' }, h('span', {}, 'Tu nombre'), nombre),
      cedula,
      h('button', { class: 'boton principal', type: 'submit' }, 'Entrar'),
    );
    vista.replaceChildren(h('div', { class: 'entrada' }, h('div', { class: 'panel' },
      h('div', { class: 'cabeza-entrada' }, h('div', { class: 'marca' }, h('img', { src: '/panel/logo.svg', alt: '' }), h('b', {}, 'Expediente Rosa')), cliente()),
      h('div', { class: 'titulo-entrada' }, saluda, h('h1', {}, '¿Quién eres?')),
      form,
      h('p', { class: 'demo' }, 'Demo: sin contraseña.'),
    )));
    nombre.focus();
  }

  // ---------- 2. Tablero ----------
  let comunidadesConocidas = []; // [{comunidad, estado}] para el selector

  async function vistaTablero(vista, q) {
    document.title = 'Tablero · Expediente Rosa';
    const filtros = { estado: q.estado || '', comunidad: q.comunidad || '' };
    let resumen = null, cerrado = false, fuentes = [], sondeo = null, recarga = null;

    const selEstado = h('select', { 'aria-label': 'Estado' }, h('option', { value: '' }, 'Todos'), ESTADOS.map((e) => h('option', { value: e, selected: e === filtros.estado }, e)));
    const selComunidad = h('select', { 'aria-label': 'Comunidad' });
    const quitar = h('button', { class: 'boton quieto', type: 'button', onclick: () => ir('tablero') }, 'Quitar filtros');
    selEstado.addEventListener('change', () => ir('tablero', { estado: selEstado.value }));
    selComunidad.addEventListener('change', () => {
      const c = comunidadesConocidas.find((x) => x.comunidad === selComunidad.value);
      ir('tablero', { estado: c ? c.estado : selEstado.value, comunidad: selComunidad.value });
    });

    const corte = h('span', {}, 'Cargando…');
    const vivo = h('span', { class: 'pildora', hidden: true });
    // Guiño: la mascota aparece contenta un momento junto a «En vivo» cuando llega trabajo de campo.
    const guino = h('span', { class: 'guino', hidden: true });
    const carita = mascota('reposo', { tamano: 28 });
    if (carita) guino.append(carita);
    let finGuino = null;
    function guinar() {
      if (!carita) return;
      clearTimeout(finGuino);
      guino.hidden = false;
      requestAnimationFrame(() => guino.classList.add('ve'));
      Mascota.cambiar(carita, 'contenta');
      finGuino = setTimeout(() => {
        guino.classList.remove('ve');
        finGuino = setTimeout(() => { guino.hidden = true; carita.dataset.estado = 'reposo'; }, 220);
      }, 1800);
    }
    const ejemplo = h('span', { class: 'pildora ejemplo', hidden: true, title: 'La API todavía no tiene /api/resumen' }, h('span', { class: 'punto' }), 'Datos de ejemplo');
    const cuerpo = h('div', {}, esqueletoTablero());

    vista.append(
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, 'Tablero'), h('p', { class: 'meta' }, corte, vivo, guino, ejemplo)),
        h('div', { class: 'derecha filtros' },
          h('label', { class: 'campo' }, h('span', {}, 'Estado'), selEstado),
          h('label', { class: 'campo' }, h('span', {}, 'Comunidad'), selComunidad),
          (filtros.estado || filtros.comunidad) ? quitar : null)),
      cuerpo,
    );

    function llenarComunidades() {
      const lista = comunidadesConocidas.filter((c) => !filtros.estado || c.estado === filtros.estado);
      selComunidad.replaceChildren(h('option', { value: '' }, 'Todas'),
        lista.map((c) => h('option', { value: c.comunidad, selected: c.comunidad === filtros.comunidad }, c.comunidad)));
    }

    async function cargar() {
      const r = await pedir(conQuery('/api/resumen', filtros));
      if (cerrado) return;
      if (!r.ok) {
        cuerpo.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'error' }, `No se pudo leer el resumen (${r.status}). `), h('button', { class: 'boton secundario chico', onclick: cargar }, 'Reintentar')));
        return;
      }
      resumen = r.datos;
      ejemplo.hidden = !r.ejemplo;
      // Las comunidades del selector salen de la primera carga sin filtro de comunidad.
      if (!filtros.comunidad || !comunidadesConocidas.length) {
        for (const c of resumen.porComunidad || []) {
          if (!comunidadesConocidas.some((x) => x.comunidad === c.comunidad)) comunidadesConocidas.push({ comunidad: c.comunidad, estado: c.estado });
        }
        comunidadesConocidas.sort((a, b) => a.comunidad.localeCompare(b.comunidad, 'es'));
      }
      llenarComunidades();
      corte.textContent = `Corte: ${cuando(resumen.corte || new Date().toISOString())}`;
      cuerpo.replaceChildren(...pintarTablero(resumen, filtros));
      if (!r.ejemplo && !fuentes.length && !sondeo) conectarVivo();
    }

    // En vivo: SSE por comunidad (máximo 3 para no agotar conexiones); si no, sondeo cada 60 s.
    function conectarVivo() {
      const comunidades = filtros.comunidad ? [filtros.comunidad]
        : (resumen.porComunidad || []).map((c) => c.comunidad);
      const pedirRecarga = () => { clearTimeout(recarga); recarga = setTimeout(cargar, 700); };
      if (!window.EventSource || comunidades.length === 0 || comunidades.length > 3) {
        sondeo = setInterval(cargar, 60000);
        return;
      }
      let abiertas = 0;
      const marcar = () => {
        vivo.hidden = false;
        vivo.className = abiertas > 0 ? 'pildora vivo' : 'pildora';
        vivo.replaceChildren(h('span', { class: 'punto' }), abiertas > 0 ? 'En vivo' : 'Sin conexión en vivo');
      };
      for (const c of comunidades) {
        const es = new EventSource(`/api/jornada/${encodeURIComponent(c)}/en-vivo`);
        let abierta = false;
        es.onopen = () => { if (!abierta) { abierta = true; abiertas++; marcar(); } };
        es.onerror = () => { if (abierta) { abierta = false; abiertas--; marcar(); } };
        for (const ev of ['alta', 'estudio', 'visita', 'interpretacion', 'avisado', 'duplicado']) es.addEventListener(ev, pedirRecarga);
        // Solo altas, estudios y visitas: una interpretación puede ser un resultado anormal.
        for (const ev of ['alta', 'estudio', 'visita']) es.addEventListener(ev, guinar);
        fuentes.push(es);
      }
    }

    llenarComunidades();
    cargar();
    return () => { cerrado = true; fuentes.forEach((f) => f.close()); clearInterval(sondeo); clearTimeout(recarga); clearTimeout(finGuino); };
  }

  function esqueletoTablero() {
    return [
      h('div', { class: 'cifras', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map(() => h('div', { class: 'cifra' }, h('div', { class: 'hueso', style: 'height:14px;width:60%' }), h('div', { class: 'hueso', style: 'height:34px;width:40%;margin-top:6px' })))),
      h('div', { class: 'rejilla', 'aria-hidden': 'true' }, h('div', { class: 'panel' }, h('div', { class: 'hueso', style: 'height:180px' })), h('div', { class: 'panel' }, h('div', { class: 'hueso', style: 'height:180px' }))),
    ];
  }

  function pintarTablero(r, filtros) {
    const e = r.estudios || { total: 0, porEtapa: {} };
    const cifra = (titulo, valor, sub, ico) => h('div', { class: 'cifra' },
      h('dt', {}, ico ? icono(ico) : null, titulo), h('dd', {}, n(valor)), sub ? h('div', { class: 'sub' }, sub) : null);
    const cifras = h('dl', { class: 'cifras' },
      cifra('Personas únicas', r.personasUnicas, plural(r.visitas ?? 0, 'visita', 'visitas')),
      cifra('Estudios', e.total, `${n(e.porTipo?.papanicolaou)} papanicolaous`),
      cifra('Anormales', r.anormales, e.total ? `${Math.round((r.anormales / e.total) * 1000) / 10} % de los estudios` : null, r.anormales ? 'anormal' : null),
      cifra('Pendientes de patología', r.pendientesPatologia, 'papanicolaous sin leer', r.pendientesPatologia ? 'pendiente' : null),
      cifra('Seguimiento vencido', r.seguimientoVencido, h('a', { href: '#/' + conQuery('seguimiento', { comunidad: filtros.comunidad }) }, 'Ver seguimiento'), r.seguimientoVencido ? 'anormal' : null),
    );

    // Gráfica: por estado, o por comunidad si ya hay un estado elegido.
    const porComunidad = !!filtros.estado;
    const filas = porComunidad
      ? (r.porComunidad || []).map((c) => ({ id: c.comunidad, etiqueta: c.comunidad, valor: c.personas, extra: c, elegida: c.comunidad === filtros.comunidad, ir: () => ir('tablero', { estado: c.estado, comunidad: c.comunidad }) }))
      : ESTADOS.map((nombre) => {
          const c = (r.porEstado || []).find((x) => x.estado === nombre) || { estado: nombre, personas: 0, estudios: 0, anormales: 0, pendientesPatologia: 0 };
          return { id: nombre, etiqueta: nombre, valor: c.personas, extra: c, elegida: false, ir: () => ir('tablero', { estado: nombre }) };
        });
    const titulo = porComunidad ? `Personas atendidas en ${filtros.estado}` : 'Personas atendidas por estado';
    const grafica = h('section', { class: 'panel', 'aria-labelledby': 't-grafica' },
      h('div', { class: 'panel-cabeza' }, h('h2', { class: 'panel-titulo', id: 't-grafica' }, titulo), h('p', {}, porComunidad ? 'Elige una comunidad para filtrar' : 'Elige un estado para ver sus comunidades')),
      barras(filas, titulo));

    // Embudo por etapa.
    const etapas = [['tomado', 'Tomado'], ['en-laboratorio', 'En laboratorio'], ['interpretado', 'Interpretado'], ['avisado', 'Avisado']];
    const pe = e.porEtapa || {};
    const valores = etapas.map(([k]) => pe[k] || 0);
    const suma = valores.reduce((a, b) => a + b, 0);
    // Si la API manda cuántos hay en cada etapa (suman el total), se acumula:
    // «llegaron a esta etapa» = los de esta etapa y las siguientes.
    const acumulado = suma === e.total || suma === 0
      ? valores.map((_, i) => valores.slice(i).reduce((a, b) => a + b, 0))
      : valores;
    const tope = Math.max(acumulado[0], 1);
    const embudo = h('section', { class: 'panel', 'aria-labelledby': 't-embudo' },
      h('div', { class: 'panel-cabeza' }, h('h2', { class: 'panel-titulo', id: 't-embudo' }, 'Avance de los estudios'), h('p', {}, 'Cuántos llegaron a cada etapa')),
      h('ol', { class: 'embudo' }, etapas.map(([k, nombre], i) => h('li', { 'aria-label': `${nombre}: ${n(acumulado[i])} de ${n(acumulado[0])}. ${n(valores[i])} siguen aquí.` },
        h('span', { class: 'nombre', 'aria-hidden': 'true' }, nombre),
        h('span', { class: 'riel', 'aria-hidden': 'true' }, h('span', { class: 'lleno', style: `display:block;width:${(acumulado[i] / tope) * 100}%` })),
        h('span', { class: 'cuanto', 'aria-hidden': 'true' }, n(acumulado[i])),
        h('span', { class: 'aqui', 'aria-hidden': 'true' }, i === etapas.length - 1 ? 'Ya se les avisó' : `${n(valores[i])} siguen aquí`)))));

    // Tabla por comunidad.
    const comunidades = (r.porComunidad || []).slice().sort((a, b) => b.personas - a.personas);
    const celdaN = (v, ico) => h('td', { class: 'n' }, v ? (ico ? h('span', { class: 'con-icono' }, icono(ico), n(v)) : n(v)) : h('span', { class: 'cero' }, '0'));
    const tabla = h('section', { class: 'panel', 'aria-labelledby': 't-tabla' },
      h('div', { class: 'panel-cabeza' }, h('h2', { class: 'panel-titulo', id: 't-tabla' }, 'Por comunidad'), h('p', {}, plural(comunidades.length, 'comunidad', 'comunidades'))),
      comunidades.length ? h('div', { class: 'tabla-caja' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Comunidad'), h('th', { scope: 'col' }, 'Estado'), h('th', { class: 'n', scope: 'col' }, 'Personas'), h('th', { class: 'n', scope: 'col' }, 'Estudios'), h('th', { class: 'n', scope: 'col' }, 'Anormales'), h('th', { class: 'n', scope: 'col' }, 'Pend. patología'))),
        h('tbody', {}, comunidades.map((c) => h('tr', { class: c.comunidad === filtros.comunidad ? 'elegida' : null },
          h('th', { scope: 'row' }, h('button', {
            class: 'enlace-fila', type: 'button', 'aria-pressed': c.comunidad === filtros.comunidad ? 'true' : 'false',
            onclick: () => (c.comunidad === filtros.comunidad ? ir('tablero', { estado: c.estado }) : ir('tablero', { estado: c.estado, comunidad: c.comunidad })),
          }, c.comunidad)),
          h('td', { class: 'tenue' }, c.estado),
          celdaN(c.personas), celdaN(c.estudios), celdaN(c.anormales, 'anormal'), celdaN(c.pendientesPatologia, 'pendiente'))))))
        : vacioConMascota('Sin jornadas con este filtro', 'Prueba con otro estado o comunidad, o quita los filtros.'));

    return [cifras, h('div', { class: 'rejilla' }, grafica, embudo), tabla];
  }

  // Barras horizontales en SVG: una serie, valor en la punta, tooltip y teclado.
  function barras(filas, titulo) {
    const caja = h('div', { class: 'grafica' });
    const tip = h('div', { class: 'tooltip', hidden: true, role: 'presentation' });
    const dibujar = () => {
      const ancho = Math.max(caja.clientWidth, 280);
      const alto = filas.length <= 4 ? 56 : 40, grosor = 20;
      const etiquetaW = Math.min(180, Math.max(96, ...filas.map((f) => f.etiqueta.length * 7.6 + 12)));
      const valorW = 48;
      const tope = Math.max(...filas.map((f) => f.valor), 1);
      const usable = ancho - etiquetaW - valorW;
      const hayElegida = filas.some((f) => f.elegida);
      const svg = s('svg', { viewBox: `0 0 ${ancho} ${filas.length * alto}`, height: filas.length * alto, role: 'group', 'aria-label': `${titulo}. ${filas.map((f) => `${f.etiqueta}: ${f.valor}`).join('; ')}` });
      filas.forEach((f, i) => {
        const y = i * alto;
        const w = Math.max((f.valor / tope) * usable, f.valor ? 3 : 0);
        const r = Math.min(4, w);
        const x0 = etiquetaW, yb = y + (alto - grosor) / 2;
        // Extremo de dato redondeado, base recta.
        const d = w > 0 ? `M${x0} ${yb} H${x0 + w - r} Q${x0 + w} ${yb} ${x0 + w} ${yb + r} V${yb + grosor - r} Q${x0 + w} ${yb + grosor} ${x0 + w - r} ${yb + grosor} H${x0} Z` : '';
        const g = s('g', {
          class: 'fila', tabindex: '0', role: 'button',
          'aria-label': `${f.etiqueta}: ${f.valor} personas, ${f.extra.estudios ?? 0} estudios, ${f.extra.anormales ?? 0} anormales. ${f.elegida ? 'Elegida.' : 'Filtrar.'}`,
          onclick: f.ir,
          onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); f.ir(); } },
          onmouseenter: () => mostrarTip(f, x0 + w / 2, yb + grosor),
          onmouseleave: () => { tip.hidden = true; },
          onfocus: () => mostrarTip(f, x0 + w / 2, yb + grosor),
          onblur: () => { tip.hidden = true; },
        },
          s('rect', { class: 'zona', x: 0, y: y + 2, width: ancho, height: alto - 4, rx: 8 }),
          s('text', { class: 'etiqueta', x: 8, y: y + alto / 2, 'dominant-baseline': 'central' }, f.etiqueta),
          d ? s('path', { class: 'barra-dato' + (hayElegida && !f.elegida ? ' apagada' : ''), d }) : null,
          s('text', { class: 'valor', x: x0 + w + 8, y: y + alto / 2, 'dominant-baseline': 'central' }, n(f.valor)));
        svg.append(g);
      });
      svg.append(s('line', { class: 'base', x1: etiquetaW, x2: etiquetaW, y1: 4, y2: filas.length * alto - 4 }));
      caja.replaceChildren(svg, tip);
    };
    function mostrarTip(f, x, y) {
      tip.replaceChildren(h('b', {}, f.etiqueta),
        h('div', {}, h('span', {}, 'Personas'), h('span', {}, n(f.valor))),
        h('div', {}, h('span', {}, 'Estudios'), h('span', {}, n(f.extra.estudios))),
        h('div', {}, h('span', {}, 'Anormales'), h('span', {}, n(f.extra.anormales))),
        h('div', {}, h('span', {}, 'Pend. patología'), h('span', {}, n(f.extra.pendientesPatologia))));
      tip.style.left = Math.min(Math.max(x, 90), caja.clientWidth - 90) + 'px';
      tip.style.top = y + 'px';
      tip.hidden = false;
    }
    if (!filas.length) { caja.append(h('p', { class: 'tenue' }, 'Sin datos con este filtro.')); return caja; }
    const ro = new ResizeObserver(() => { if (caja.isConnected) dibujar(); });
    ro.observe(caja);
    requestAnimationFrame(dibujar);
    return caja;
  }

  // ---------- 3. Patología ----------
  const BETHESDA = ['Negativa', 'ASC-US', 'LSIL', 'HSIL', 'ASC-H', 'AGC', 'Carcinoma'];

  async function vistaPatologia(vista, q = {}) {
    const soloLectura = usuario.rol !== 'patologia';
    document.title = 'Por interpretar · Expediente Rosa';
    let muestras = [], elegida = null, usandoEjemplo = false;
    const cuenta = h('p', {}, '');
    const ejemplo = h('span', { class: 'pildora ejemplo', hidden: true, title: 'La API todavía no tiene /api/patologia' }, h('span', { class: 'punto' }), 'Datos de ejemplo');
    const ul = h('ul', { 'aria-label': 'Muestras por interpretar' });
    const lista = h('section', { class: 'panel lista', 'aria-labelledby': 't-lista' },
      h('div', { class: 'panel-cabeza' }, h('h2', { class: 'panel-titulo', id: 't-lista' }, 'Papanicolaous'), cuenta),
      ul);
    const detalle = h('section', { class: 'panel detalle', 'aria-live': 'polite' }, h('p', { class: 'cargando' }, 'Cargando…'));
    vista.append(
      h('div', { class: 'encabezado' }, h('div', {}, h('h1', {}, 'Por interpretar'), h('p', { class: 'meta' }, 'La que más espera va primero.', ejemplo))),
      h('div', { class: 'patologia' }, lista, detalle));

    async function cargar() {
      const r = await pedir('/api/patologia');
      if (!r.ok) { detalle.replaceChildren(h('p', { class: 'error' }, `No se pudo leer la lista (${r.status}).`)); return; }
      usandoEjemplo = r.ejemplo;
      ejemplo.hidden = !r.ejemplo;
      muestras = (r.datos || []).slice().sort((a, b) => b.diasEsperando - a.diasEsperando);
      pintarLista();
      const pedida = q.folio && muestras.find((m) => m.paciente.folio === q.folio);
      elegir(pedida || muestras[0] || null, !!pedida);
    }

    function pintarLista() {
      cuenta.textContent = plural(muestras.length, 'muestra', 'muestras');
      marcarCuenta('patologia', muestras.length);
      ul.replaceChildren(...muestras.map((m) => h('li', { 'data-id': m.estudio.id },
        h('button', {
          class: 'muestra', type: 'button', 'aria-current': elegida?.estudio.id === m.estudio.id ? 'true' : 'false',
          onclick: () => elegir(m, true),
        },
          h('span', { class: 'quien-es' }, h('span', { class: 'mono' }, m.paciente.folio), ' · ', nombreCompleto(m.paciente)),
          h('span', { class: 'donde' }, `${m.paciente.comunidad} · tomada el ${fechaCorta(m.estudio.fecha)}`),
          h('span', { class: 'espera' + (m.diasEsperando >= 10 ? ' larga' : '') }, h('b', {}, n(m.diasEsperando)), m.diasEsperando === 1 ? 'día' : 'días')))));
      if (!muestras.length) ul.replaceChildren();
    }

    function elegir(m, enfocar) {
      elegida = m;
      ul.querySelectorAll('.muestra').forEach((b) => b.setAttribute('aria-current', b.closest('li').dataset.id === m?.estudio.id ? 'true' : 'false'));
      if (!m) {
        detalle.replaceChildren(vacioConMascota('No hay muestras por interpretar', 'Cuando una brigada regrese con papanicolaous, aparecen aquí.'));
        return;
      }
      pintarFormulario(m);
      // Si la lista no trae la edad, se calcula de la fecha de nacimiento del expediente.
      if (m.paciente.edad == null && !m.edadBuscada) {
        m.edadBuscada = true;
        pedir(`/api/pacientes/${encodeURIComponent(m.paciente.id)}`).then((r) => {
          const nac = r.ok && r.datos?.nacimiento;
          const edad = r.ok && (r.datos?.edad ?? (nac ? edadDe(nac) : null));
          if (edad == null || elegida !== m) return;
          m.paciente.edad = edad;
          const dd = detalle.querySelector('[data-campo="edad"]');
          if (dd) dd.textContent = `${edad} años`;
        });
      }
      if (enfocar) {
        if (matchMedia('(max-width: 900px)').matches) detalle.scrollIntoView({ behavior: reducido.matches ? 'auto' : 'smooth', block: 'start' });
        detalle.querySelector('input[name="bethesda"]')?.focus({ preventScroll: true });
        if (soloLectura) ul.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
      }
    }

    function pintarFormulario(m) {
      let clasificacion = null, guardando = false;
      const resultado = h('p', { class: 'resultado vacio', id: 'resultado' }, 'El resultado sale de la clasificación.');
      const falta = h('span', { class: 'falta' }, 'Falta: clasificación');
      const nota = h('textarea', { name: 'nota', maxlength: '500', placeholder: 'Ej. muestra con escasa celularidad' });
      const boton = h('button', { class: 'boton principal', type: 'submit', disabled: true }, 'Guardar interpretación');
      const errorEl = h('p', { class: 'error', hidden: true, role: 'alert' });

      const pintarResultado = () => {
        boton.disabled = !clasificacion;
        falta.hidden = !!clasificacion;
        if (!clasificacion) return;
        const anormal = clasificacion !== 'Negativa';
        resultado.className = 'resultado';
        resultado.replaceChildren(icono(anormal ? 'anormal' : 'normal'),
          anormal ? 'Anormal: entra a seguimiento al guardar' : 'Normal');
      };

      const form = h('form', {
        class: 'detalle-form', style: 'display:grid;gap:24px',
        onsubmit: async (ev) => {
          ev.preventDefault();
          if (!clasificacion || guardando) return;
          guardando = true;
          boton.setAttribute('aria-busy', 'true'); boton.textContent = 'Guardando…';
          errorEl.hidden = true;
          const anormal = clasificacion !== 'Negativa';
          const cuerpo = { resultado: anormal ? 'anormal' : 'normal', clasificacion, patologo: usuario.nombre };
          if (nota.value.trim()) cuerpo.nota = nota.value.trim();
          if (usuario.cedula) cuerpo.cedula = usuario.cedula;
          const r = await pedir(`/api/estudios/${encodeURIComponent(m.estudio.id)}/interpretacion`, { metodo: 'POST', cuerpo });
          guardando = false;
          boton.removeAttribute('aria-busy'); boton.textContent = 'Guardar interpretación';
          if (r.ok || r.status === 409) {
            if (r.status === 409) avisar(`${m.paciente.folio} ya estaba interpretada.`, { tipo: 'pendiente', detalle: 'Alguien más la guardó antes. Sale de la lista.' });
            else if (anormal) avisar(`${m.paciente.folio} guardada como anormal (${clasificacion}).`, { tipo: 'anormal', detalle: 'Entró a seguimiento: coordinación la ve para avisarle.' });
            else avisar(`${m.paciente.folio} guardada como normal.`, { tipo: 'normal' });
            const i = muestras.indexOf(m);
            muestras.splice(i, 1);
            const siguiente = muestras[i] || muestras[i - 1] || null;
            await sacar(ul.querySelector(`li[data-id="${CSS.escape(m.estudio.id)}"]`));
            cuenta.textContent = plural(muestras.length, 'muestra', 'muestras');
            marcarCuenta('patologia', muestras.length);
            elegir(siguiente, false);
            if (siguiente) detalle.querySelector('input[name="bethesda"]')?.focus({ preventScroll: true });
            return;
          }
          errorEl.textContent = `No se guardó (${r.status}). ${r.datos?.error ? (typeof r.datos.error === 'string' ? r.datos.error : 'Revisa los datos.') : 'Intenta otra vez.'}`;
          errorEl.hidden = false;
        },
      },
        h('fieldset', { class: 'bethesda', 'aria-describedby': 'resultado' },
          h('legend', {}, 'Clasificación Bethesda'),
          h('div', { class: 'opciones' }, BETHESDA.map((b) => h('div', { class: 'opcion' },
            h('input', { type: 'radio', name: 'bethesda', id: 'b-' + b, value: b, onchange: () => { clasificacion = b; pintarResultado(); } }),
            h('label', { for: 'b-' + b }, b)))),
          resultado),
        h('label', { class: 'campo' }, h('span', {}, 'Nota (opcional)'), nota),
        h('div', { class: 'acciones' }, boton, falta,
          h('span', { class: 'firma', style: 'margin-left:auto' }, `Firma: ${usuario.nombre}${usuario.cedula ? ` · Cédula ${usuario.cedula}` : ''}`)),
        errorEl,
      );

      const p = m.paciente;
      detalle.replaceChildren(
        h('div', { style: 'display:grid;gap:16px' },
          h('div', {}, h('p', { class: 'nota' }, `Papanicolaou tomado el ${fechaCorta(m.estudio.fecha)} · espera ${plural(m.diasEsperando, 'día', 'días')}`), h('h2', {}, nombreCompleto(p))),
          h('dl', { class: 'ficha' },
            h('div', {}, h('dt', {}, 'Folio'), h('dd', { class: 'mono' }, p.folio)),
            h('div', {}, h('dt', {}, 'Edad'), h('dd', { 'data-campo': 'edad' }, p.edad != null ? `${p.edad} años` : 'Sin dato')),
            h('div', {}, h('dt', {}, 'Comunidad'), h('dd', {}, p.comunidad)),
            m.estado ? h('div', {}, h('dt', {}, 'Estado'), h('dd', {}, m.estado)) : null)),
        h('hr', { class: 'separa' }),
        soloLectura ? h('p', { class: 'tenue' }, 'Solo Patología captura el resultado.') : form);
    }

    await cargar();
  }

  // ---------- Jornadas programadas ----------
  // Coordinación dice a qué comunidad va la brigada y cuándo. Los teléfonos
  // bajan solos a las pacientes de esa comunidad antes de salir.
  const DIAS_JORNADAS = 60;
  const fechaDia = (dia) => new Date(dia + 'T12:00:00-06:00');
  const partesFecha = (dia) => {
    const d = fechaDia(dia);
    const f = (o) => new Intl.DateTimeFormat('es-MX', { ...o, timeZone: TZ }).format(d).replace('.', '');
    return { semana: f({ weekday: 'short' }), dia: f({ day: 'numeric' }), mes: f({ month: 'short' }), largo: f({ weekday: 'long', day: 'numeric', month: 'long' }) };
  };
  const hoyDia = () => diaDe(new Date().toISOString());
  const diasHasta = (dia) => Math.round((fechaDia(dia) - fechaDia(hoyDia())) / 86400000);
  const faltan = (dia) => {
    const k = diasHasta(dia);
    if (k === 0) return 'Hoy';
    if (k === 1) return 'Mañana';
    if (k < 0) return `Hace ${plural(-k, 'día', 'días')}`;
    return `En ${plural(k, 'día', 'días')}`;
  };

  async function vistaJornadas(vista) {
    document.title = 'Jornadas · Expediente Rosa';
    let jornadas = [], comunidades = [], cerrado = false;
    const autor = `${usuario.nombre} (coordinación)`;

    const meta = h('span', {}, 'Cargando…');
    const ejemplo = h('span', { class: 'pildora ejemplo', hidden: true, title: 'La API todavía no tiene /api/jornadas' }, h('span', { class: 'punto' }), 'Datos de ejemplo');
    const programar = h('button', { class: 'boton principal', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'form-jornada', onclick: () => abrirForm() },
      'Programar jornada');
    const formCaja = h('div', { id: 'form-jornada', class: 'form-jornada-caja', hidden: true });
    const ul = h('ol', { class: 'jornadas', 'aria-label': 'Próximas jornadas, por fecha' });
    const cuerpo = h('section', { class: 'panel lista-jornadas', 'aria-live': 'polite' }, esqueletoJornadas());

    vista.append(
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, 'Jornadas'), h('p', { class: 'meta' }, meta, ejemplo)),
        h('div', { class: 'derecha' }, programar)),
      formCaja,
      cuerpo,
    );

    async function cargar() {
      const [rj, rr] = await Promise.all([
        pedir(conQuery('/api/jornadas', { dias: String(DIAS_JORNADAS) })),
        pedir('/api/resumen'),
      ]);
      if (cerrado) return;
      if (rr.ok) comunidades = (rr.datos?.porComunidad || []).filter((c) => c.estado !== 'Sin estado');
      if (!rj.ok) {
        cuerpo.replaceChildren(h('p', { class: 'error' }, `No se pudieron leer las jornadas (${rj.status}). `), h('button', { class: 'boton secundario chico', type: 'button', onclick: cargar }, 'Reintentar'));
        meta.textContent = '';
        return;
      }
      ejemplo.hidden = !rj.ejemplo;
      jornadas = (rj.datos || []).slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
      pintar();
    }

    function contar() {
      meta.textContent = jornadas.length
        ? `${plural(jornadas.length, 'jornada', 'jornadas')} en los próximos ${DIAS_JORNADAS} días. Los teléfonos de la brigada bajan solos a las pacientes de cada comunidad antes de salir.`
        : `Próximos ${DIAS_JORNADAS} días.`;
      marcarCuenta('jornadas', jornadas.length || null);
    }

    function pintar() {
      contar();
      if (!jornadas.length) { cuerpo.replaceChildren(vacio()); return; }
      ul.replaceChildren(...jornadas.map((j, i) => fila(j, i === 0)));
      cuerpo.replaceChildren(ul);
    }

    const vacio = () => vacioConMascota('Sin jornadas programadas',
      'Programa la siguiente. Los teléfonos de la brigada bajan a las pacientes de esa comunidad antes de salir.',
      h('button', { class: 'boton secundario', type: 'button', onclick: () => abrirForm() }, 'Programar jornada'));

    function fila(j, siguiente) {
      const f = partesFecha(j.fecha);
      const li = h('li', { class: 'jornada' + (siguiente ? ' siguiente' : ''), 'data-id': j.id, tabindex: '-1' });
      const mostrarMunicipio = j.municipio && clave(j.municipio) !== clave(`${j.comunidad}, ${j.estado}`) && clave(j.municipio) !== clave(j.comunidad);
      const pend = j.estudiosPendientes ?? 0;
      const accion = h('div', { class: 'accion' });
      const pintarAccion = () => accion.replaceChildren(h('button', {
        class: 'boton quieto', type: 'button', 'aria-label': `Cancelar la jornada en ${j.comunidad} del ${f.largo}`,
        onclick: () => confirmar(),
      }, 'Cancelar'));
      function confirmar() {
        let reloj;
        const no = h('button', { class: 'boton quieto', type: 'button', onclick: () => { clearTimeout(reloj); pintarAccion(); accion.querySelector('button').focus(); } }, 'No');
        const si = h('button', { class: 'boton peligro chico', type: 'button', onclick: async () => {
          clearTimeout(reloj);
          si.disabled = true; no.disabled = true; si.setAttribute('aria-busy', 'true'); si.textContent = 'Cancelando…';
          const r = await pedir(conQuery(`/api/jornadas/${encodeURIComponent(j.id)}`, { autor }), { metodo: 'DELETE' });
          if (r.ok || r.status === 404) {
            avisar(`Jornada en ${j.comunidad} cancelada.`, { tipo: 'normal', detalle: r.ok ? 'Queda en la bitácora.' : 'Ya estaba cancelada.' });
            jornadas.splice(jornadas.indexOf(j), 1);
            await sacar(li);
            if (jornadas.length) ul.querySelectorAll('.jornada').forEach((x, i) => x.classList.toggle('siguiente', i === 0));
            pintarSiHaceFalta();
          } else {
            avisar('No se canceló la jornada.', { tipo: 'error', detalle: `La API respondió ${r.status}. Intenta otra vez.` });
            pintarAccion();
          }
        } }, 'Sí, cancelar');
        accion.replaceChildren(h('div', { class: 'confirmar', role: 'group', 'aria-label': `Confirmar cancelación de ${j.comunidad}` },
          h('span', { class: 'pregunta' }, `¿Cancelar ${j.comunidad}?`), si, no));
        no.focus();
        accion.onkeydown = (ev) => { if (ev.key === 'Escape') no.click(); };
        reloj = setTimeout(() => { if (accion.contains(no) && !si.disabled) pintarAccion(); }, 6000);
      }
      pintarAccion();

      li.append(
        h('div', { class: 'fecha-bloque', 'aria-hidden': 'true' },
          h('span', { class: 'semana' }, f.semana), h('b', {}, f.dia), h('span', { class: 'mes' }, f.mes)),
        h('div', { class: 'que' },
          h('div', { class: 'linea-1' },
            h('h2', {}, h('span', { class: 'solo-lector' }, `${f.largo}: `), j.comunidad),
            h('span', { class: 'pildora faltan' }, faltan(j.fecha))),
          h('p', { class: 'donde' }, [j.estado, mostrarMunicipio ? j.municipio : null].filter(Boolean).join(' · ')),
          j.equipo?.length ? h('p', { class: 'equipo' }, h('span', { class: 'tenue' }, 'Equipo: '), j.equipo.join(', ')) : null,
          j.nota ? h('p', { class: 'nota-jornada' }, j.nota) : null),
        h('dl', { class: 'conteos' },
          h('div', {}, h('dt', {}, 'Pacientes con expediente'), h('dd', { 'data-conteo': 'previas' }, n(j.pacientesPrevias ?? 0))),
          h('div', { class: 'pendientes' + (pend ? ' hay' : ''), 'data-caja': 'pendientes', title: 'Papanicolaous en laboratorio y resultados anormales sin avisar' }, h('dt', {}, icono('pendiente'), 'Estudios pendientes'), h('dd', { 'data-conteo': 'pendientes' }, n(pend)))),
        accion,
      );
      return li;
    }
    function pintarSiHaceFalta() { contar(); if (!jornadas.length) cuerpo.replaceChildren(vacio()); }

    // ----- Formulario corto, en línea arriba de la lista -----
    function abrirForm() {
      if (!formCaja.hidden) { formCaja.querySelector('select, input')?.focus(); return; }
      programar.setAttribute('aria-expanded', 'true');
      formCaja.replaceChildren(formulario());
      formCaja.hidden = false;
      formCaja.querySelector('select').focus();
    }
    function cerrarForm() {
      formCaja.hidden = true;
      formCaja.replaceChildren();
      programar.setAttribute('aria-expanded', 'false');
      programar.focus();
    }

    function formulario() {
      const estados = [...new Set([...ESTADOS, ...comunidades.map((c) => c.estado)])].sort((a, b) => a.localeCompare(b, 'es'));
      const selEstado = h('select', { name: 'estado', required: true },
        h('option', { value: '' }, 'Elige un estado'), estados.map((e) => h('option', { value: e }, e)));
      const lista = h('datalist', { id: 'comunidades-sugeridas' });
      const comunidad = h('input', { name: 'comunidad', list: 'comunidades-sugeridas', required: true, autocomplete: 'off', maxlength: '80', placeholder: 'Escribe o elige' });
      const pista = h('small', { class: 'pista', id: 'pista-comunidad' }, ' ');
      comunidad.setAttribute('aria-describedby', 'pista-comunidad');
      const fecha = h('input', { name: 'fecha', type: 'date', required: true, min: hoyDia() });
      const equipo = h('input', { name: 'equipo', autocomplete: 'off', maxlength: '400', placeholder: 'Ej. Dra. Laura Méndez, Enf. Rosa Ortiz' });
      const nota = h('input', { name: 'nota', autocomplete: 'off', maxlength: '300', placeholder: 'Ej. Salida de Ciudad Guzmán a las 6:00' });
      const guardar = h('button', { class: 'boton principal', type: 'submit', disabled: true }, 'Guardar jornada');
      const falta = h('span', { class: 'falta' });
      const errorEl = h('p', { class: 'error', role: 'alert', hidden: true });
      let guardando = false;

      const conocida = () => comunidades.find((c) => clave(c.comunidad) === clave(comunidad.value));
      const llenarLista = () => lista.replaceChildren(...comunidades
        .filter((c) => !selEstado.value || c.estado === selEstado.value)
        .sort((a, b) => a.comunidad.localeCompare(b.comunidad, 'es'))
        .map((c) => h('option', { value: c.comunidad }, `${c.estado} · ${plural(c.personas, 'paciente', 'pacientes')}`)));
      const revisar = () => {
        const c = conocida();
        if (c && !selEstado.value) { selEstado.value = c.estado; llenarLista(); }
        pista.textContent = !comunidad.value.trim() ? ' '
          : c ? `${plural(c.personas, 'paciente tiene', 'pacientes tienen')} expediente en ${c.comunidad}.`
          : 'Comunidad nueva: todavía no hay pacientes registradas.';
        const faltantes = [!selEstado.value && 'estado', !comunidad.value.trim() && 'comunidad', !fecha.value && 'fecha'].filter(Boolean);
        const pasada = fecha.value && fecha.value < hoyDia();
        guardar.disabled = guardando || faltantes.length > 0 || pasada;
        falta.textContent = pasada ? 'La fecha ya pasó' : faltantes.length ? `Falta: ${faltantes.join(', ')}` : '';
      };
      selEstado.addEventListener('change', () => { llenarLista(); revisar(); });
      for (const el of [comunidad, fecha]) { el.addEventListener('input', revisar); el.addEventListener('change', revisar); }
      llenarLista(); revisar();

      const form = h('form', {
        class: 'panel form-jornada', 'aria-labelledby': 't-form-jornada',
        onkeydown: (ev) => { if (ev.key === 'Escape') cerrarForm(); },
        onsubmit: async (ev) => {
          ev.preventDefault();
          revisar();
          if (guardar.disabled) return;
          guardando = true; guardar.setAttribute('aria-busy', 'true'); guardar.textContent = 'Guardando…'; errorEl.hidden = true;
          const c = conocida();
          const cuerpoJ = {
            comunidad: c ? c.comunidad : comunidad.value.trim(),
            estado: selEstado.value,
            fecha: fecha.value,
            equipo: equipo.value.split(',').map((x) => x.trim()).filter(Boolean),
            autor,
          };
          if (nota.value.trim()) cuerpoJ.nota = nota.value.trim();
          const r = await pedir('/api/jornadas', { metodo: 'POST', cuerpo: cuerpoJ });
          guardando = false; guardar.removeAttribute('aria-busy'); guardar.textContent = 'Guardar jornada';
          if (!r.ok) {
            errorEl.textContent = `No se guardó (${r.status}). ${typeof r.datos?.error === 'string' ? r.datos.error : 'Revisa los datos e intenta otra vez.'}`;
            errorEl.hidden = false; revisar();
            return;
          }
          if (r.ejemplo) ejemplo.hidden = false;
          // La lista trae los conteos; si el POST no los trae, se toman del resumen.
          const j = { pacientesPrevias: c ? c.personas : 0, estudiosPendientes: 0, ...r.datos };
          cerrarForm();
          agregar(j);
          const largo = partesFecha(j.fecha).largo;
          avisar(`Jornada en ${j.comunidad} programada.`, { tipo: 'normal', detalle: largo[0].toUpperCase() + largo.slice(1) + '.' });
          // Conteos reales de pendientes desde la lista.
          refrescarConteos(j.id);
        },
      },
        h('div', { class: 'panel-cabeza' }, h('h2', { class: 'panel-titulo', id: 't-form-jornada' }, 'Nueva jornada')),
        h('div', { class: 'campos-jornada' },
          h('label', { class: 'campo' }, h('span', {}, 'Estado'), selEstado),
          h('label', { class: 'campo' }, h('span', {}, 'Comunidad'), comunidad, pista),
          h('label', { class: 'campo' }, h('span', {}, 'Fecha'), fecha),
          h('label', { class: 'campo ancho' }, h('span', {}, 'Equipo (opcional, separado por comas)'), equipo),
          h('label', { class: 'campo ancho' }, h('span', {}, 'Nota (opcional)'), nota)),
        lista,
        h('div', { class: 'acciones' }, guardar, h('button', { class: 'boton quieto', type: 'button', onclick: cerrarForm }, 'Cerrar'), falta),
        errorEl,
      );
      return form;
    }

    function agregar(j) {
      jornadas.push(j);
      jornadas.sort((a, b) => a.fecha.localeCompare(b.fecha));
      if (!ul.isConnected) cuerpo.replaceChildren(ul);
      const i = jornadas.indexOf(j);
      const li = fila(j, i === 0);
      li.classList.add('nueva');
      const antes = ul.children[i];
      ul.insertBefore(li, antes || null);
      ul.querySelectorAll('.jornada').forEach((x, k) => x.classList.toggle('siguiente', k === 0));
      contar();
      li.scrollIntoView({ behavior: reducido.matches ? 'auto' : 'smooth', block: 'nearest' });
      li.focus({ preventScroll: true });
      setTimeout(() => li.classList.remove('nueva'), 2000);
    }

    async function refrescarConteos(id) {
      const r = await pedir(conQuery('/api/jornadas', { dias: String(DIAS_JORNADAS) }));
      if (cerrado || !r.ok) return;
      const x = (r.datos || []).find((y) => y.id === id);
      const j = jornadas.find((y) => y.id === id);
      if (!x || !j) return;
      j.pacientesPrevias = x.pacientesPrevias; j.estudiosPendientes = x.estudiosPendientes;
      const li = ul.querySelector(`li[data-id="${CSS.escape(id)}"]`);
      if (!li) return;
      li.querySelector('[data-conteo="previas"]').textContent = n(j.pacientesPrevias);
      li.querySelector('[data-conteo="pendientes"]').textContent = n(j.estudiosPendientes);
      li.querySelector('[data-caja="pendientes"]').classList.toggle('hay', j.estudiosPendientes > 0);
    }

    await cargar();
    return () => { cerrado = true; };
  }
  const clave = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  function esqueletoJornadas() {
    return h('div', { 'aria-hidden': 'true', style: 'display:grid;gap:16px' }, [1, 2, 3].map(() => h('div', { style: 'display:grid;grid-template-columns:64px 1fr;gap:24px;align-items:center' },
      h('div', { class: 'hueso', style: 'height:64px' }), h('div', { style: 'display:grid;gap:8px' }, h('div', { class: 'hueso', style: 'height:20px;width:40%' }), h('div', { class: 'hueso', style: 'height:14px;width:25%' })))));
  }

  // ---------- 4. Seguimiento ----------
  async function vistaSeguimiento(vista, q) {
    document.title = 'Seguimiento · Expediente Rosa';
    const comunidad = q.comunidad || '';
    const sel = h('select', { 'aria-label': 'Comunidad', onchange: (ev) => ir('seguimiento', { comunidad: ev.target.value }) }, h('option', { value: '' }, 'Todas'));
    const resumenEl = h('span', {}, 'Cargando…');
    const ejemplo = h('span', { class: 'pildora ejemplo', hidden: true }, h('span', { class: 'punto' }), 'Datos de ejemplo');
    const cuerpo = h('section', { class: 'panel' }, h('p', { class: 'cargando' }, 'Cargando…'));
    vista.append(
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, 'Seguimiento'), h('p', { class: 'meta' }, resumenEl, ejemplo)),
        h('div', { class: 'derecha' }, h('label', { class: 'campo' }, h('span', {}, 'Comunidad'), sel))),
      cuerpo);

    // Opciones de comunidad: de lo que ya conoce el tablero o de la lista sin filtro.
    const r = await pedir(conQuery('/api/seguimiento', { comunidad }));
    if (!r.ok) { cuerpo.replaceChildren(h('p', { class: 'error' }, `No se pudo leer el seguimiento (${r.status}).`)); return; }
    ejemplo.hidden = !r.ejemplo;
    const filas = (r.datos || []).slice().sort((a, b) => (b.vencido - a.vencido) || (a.diasRestantes - b.diasRestantes));
    const nombres = new Set(comunidadesConocidas.map((c) => c.comunidad));
    filas.forEach((f) => nombres.add(f.paciente.comunidad));
    if (comunidad) nombres.add(comunidad);
    sel.append(...[...nombres].sort((a, b) => a.localeCompare(b, 'es')).map((c) => h('option', { value: c, selected: c === comunidad }, c)));

    const contar = () => {
      const vencidas = filas.filter((f) => f.vencido).length;
      resumenEl.textContent = filas.length ? `${plural(filas.length, 'paciente', 'pacientes')} sin avisar · ${n(vencidas)} ${vencidas === 1 ? 'vencida' : 'vencidas'}` : 'Nadie pendiente';
      marcarCuenta('seguimiento', filas.length || null);
    };
    contar();

    if (!filas.length) {
      vistaSeguimientoVacia(cuerpo);
      return;
    }

    const autor = `${usuario.nombre} (coordinación)`;
    const tbody = h('tbody', {}, filas.map((f) => {
      const tr = h('tr', { 'data-id': f.estudioId, class: q.folio && f.paciente.folio === q.folio ? 'elegida' : null });
      const dias = Math.abs(f.diasRestantes);
      const boton = h('button', {
        class: 'boton secundario chico', type: 'button',
        'aria-label': `Marcar avisada a ${nombreCompleto(f.paciente)}`,
        onclick: async () => {
          boton.disabled = true; boton.setAttribute('aria-busy', 'true'); boton.textContent = 'Guardando…';
          const id = encodeURIComponent(f.estudioId);
          let res = await pedirReal(`/api/estudios/${id}/avisado`, { autor });
          // La API vieja solo tiene /seguimiento/:id/atendido.
          if (res.rutaFaltante) res = await pedir(`/api/seguimiento/${id}/atendido`, { metodo: 'POST', cuerpo: { autor } });
          if (res.ok || res.status === 404) {
            avisar(`${nombreCompleto(f.paciente)} marcada como avisada.`, { tipo: 'normal', detalle: res.ok ? 'Sale de la lista y queda en la bitácora.' : 'Ya no estaba en seguimiento.' });
            filas.splice(filas.indexOf(f), 1);
            await sacar(tr);
            contar();
            if (!filas.length) vistaSeguimientoVacia(cuerpo);
          } else {
            boton.disabled = false; boton.removeAttribute('aria-busy'); boton.textContent = 'Marcar avisada';
            avisar('No se guardó el aviso.', { tipo: 'error', detalle: `La API respondió ${res.status}. Intenta otra vez.` });
          }
        },
      }, 'Marcar avisada');
      tr.append(
        h('td', {}, h('div', { class: 'limite' },
          h('b', { class: f.vencido ? 'estado-anormal' : null }, f.vencido ? icono('anormal') : null, f.vencido ? `Venció hace ${plural(dias, 'día', 'días')}` : (f.diasRestantes === 0 ? 'Vence hoy' : `Quedan ${plural(dias, 'día', 'días')}`)),
          h('small', {}, `Límite: ${fechaCorta(f.fechaLimite)}`))),
        h('td', {}, h('div', { class: 'persona' }, h('b', {}, nombreCompleto(f.paciente)), h('small', { class: 'mono' }, f.paciente.folio))),
        h('td', {}, f.paciente.comunidad),
        h('td', {}, h('div', { class: 'persona' }, h('b', { style: 'font-weight:500' }, TIPO_ESTUDIO[f.tipo] || f.tipo), h('small', {}, `del ${fechaCorta(f.fecha)}`))),
        h('td', { class: 'tenue' }, f.motivo ? f.motivo[0].toUpperCase() + f.motivo.slice(1) : 'Resultado anormal'),
        h('td', { class: 'n' }, boton));
      return tr;
    }));
    cuerpo.replaceChildren(h('div', { class: 'tabla-caja' }, h('table', {},
      h('caption', { class: 'solo-lector' }, 'Pacientes con resultado anormal sin avisar. Vencidas primero.'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Plazo'), h('th', { scope: 'col' }, 'Paciente'), h('th', { scope: 'col' }, 'Comunidad'), h('th', { scope: 'col' }, 'Estudio'), h('th', { scope: 'col' }, 'Motivo'), h('th', { scope: 'col' }, h('span', { class: 'solo-lector' }, 'Acción')))),
      tbody)));
    tbody.querySelector('tr.elegida')?.scrollIntoView({ block: 'center', behavior: reducido.matches ? 'auto' : 'smooth' });
  }
  function vistaSeguimientoVacia(cuerpo) {
    cuerpo.replaceChildren(vacioConMascota('Todas avisadas', 'Cuando patología marque un resultado anormal, la paciente aparece aquí con su fecha límite.'));
  }
  // Como pedir(), pero distingue «la ruta no existe» para probar otra ruta real antes del ejemplo.
  async function pedirReal(ruta, cuerpo) {
    try {
      const res = await fetch(ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
      if (esRutaFaltante(res)) return { rutaFaltante: true };
      let datos = null; try { datos = await res.json(); } catch { /* nada */ }
      return { ok: res.ok, status: res.status, datos };
    } catch {
      return { rutaFaltante: true };
    }
  }

  // ---------- 5. Bitácora ----------
  const QUE = {
    alta: 'Dio de alta a una paciente',
    estudio: 'Registró un estudio',
    visita: 'Registró una visita',
    actualizacion: 'Corrigió datos de una paciente',
    conflicto: 'Envió un cambio que chocó con otro',
    'conflicto-aceptar': 'Aceptó un cambio en conflicto',
    'conflicto-rechazar': 'Rechazó un cambio en conflicto',
    'duplicado-unir': 'Unió dos fichas de la misma paciente',
    'duplicado-separar': 'Marcó dos fichas como distintas',
    'seguimiento-atendido': 'Marcó a una paciente como avisada',
    avisado: 'Marcó a una paciente como avisada',
    'estudio-avisado': 'Marcó a una paciente como avisada',
    interpretacion: 'Interpretó un papanicolaou',
    'estudio-interpretado': 'Interpretó un papanicolaou',
    'jornada-programada': 'Programó una jornada',
    'jornada-cancelada': 'Canceló una jornada',
    'consulta-asistente': 'Consultó al asistente',
  };
  // Cada tipo cae en un grupo: el grupo da el ícono, la cifra del resumen y el filtro.
  // `siempre`: aparece en el resumen aunque vaya en cero (las cifras que coordinación revisa).
  const GRUPOS = [
    { id: 'alta', nombre: 'Altas', uno: 'alta', varios: 'altas', tipos: ['alta'], siempre: true },
    { id: 'visita', nombre: 'Visitas', uno: 'visita', varios: 'visitas', tipos: ['visita'], siempre: true },
    { id: 'estudio', nombre: 'Estudios', uno: 'estudio', varios: 'estudios', tipos: ['estudio'], siempre: true },
    { id: 'interpretacion', nombre: 'Interpretaciones', uno: 'interpretación', varios: 'interpretaciones', tipos: ['interpretacion', 'estudio-interpretado'], siempre: true },
    { id: 'avisado', nombre: 'Avisos', uno: 'aviso', varios: 'avisos', tipos: ['avisado', 'estudio-avisado', 'seguimiento-atendido'], siempre: true },
    { id: 'duplicado', nombre: 'Duplicados resueltos', uno: 'duplicado resuelto', varios: 'duplicados resueltos', tipos: ['duplicado-unir', 'duplicado-separar'], siempre: true },
    { id: 'conflicto', nombre: 'Conflictos', uno: 'conflicto', varios: 'conflictos', tipos: ['conflicto', 'conflicto-aceptar', 'conflicto-rechazar'], siempre: true },
    { id: 'jornada', nombre: 'Jornadas programadas', uno: 'jornada programada', varios: 'jornadas programadas', tipos: ['jornada-programada'], siempre: true },
    { id: 'jornada-cancelada', nombre: 'Jornadas canceladas', uno: 'jornada cancelada', varios: 'jornadas canceladas', tipos: ['jornada-cancelada'] },
    { id: 'actualizacion', nombre: 'Correcciones', uno: 'corrección', varios: 'correcciones', tipos: ['actualizacion'] },
    { id: 'asistente', nombre: 'Consultas al asistente', uno: 'consulta al asistente', varios: 'consultas al asistente', tipos: ['consulta-asistente'] },
    { id: 'otro', nombre: 'Otros', uno: 'otro movimiento', varios: 'otros movimientos', tipos: [] },
  ];
  const GRUPO_DE = Object.fromEntries(GRUPOS.flatMap((g) => g.tipos.map((t) => [t, g])));
  const grupoDe = (tipo) => GRUPO_DE[tipo] || GRUPOS[GRUPOS.length - 1];

  // Íconos de línea, 16×16, en gris: el color queda para los estados clínicos.
  const ICONOS_MOV = {
    alta: '<circle cx="6.5" cy="5" r="2.5"/><path d="M1.75 13.75c.4-2.7 2.3-4.25 4.75-4.25s4.35 1.55 4.75 4.25"/><path d="M12.75 4.5v4.5M10.5 6.75H15"/>',
    visita: '<path d="M8 14.5S3.5 10.4 3.5 6.75a4.5 4.5 0 0 1 9 0c0 3.65-4.5 7.75-4.5 7.75z"/><circle cx="8" cy="6.75" r="1.6"/>',
    estudio: '<path d="M5.25 1.75h5.5"/><path d="M6.25 1.75v9.75a1.75 1.75 0 0 0 3.5 0V1.75"/><path d="M6.25 7.25h3.5"/>',
    interpretacion: '<circle cx="8" cy="8" r="6.25"/><path d="M5.4 8.2l1.8 1.8 3.5-3.7"/>',
    avisado: '<path d="M3.75 11.5V7.25a4.25 4.25 0 0 1 8.5 0v4.25l1.25 1.25h-11z"/><path d="M6.5 14.5h3"/>',
    duplicado: '<circle cx="5.75" cy="8" r="4"/><circle cx="10.25" cy="8" r="4"/>',
    conflicto: '<path d="M2.25 5h10l-2.25-2.25M13.75 11h-10l2.25 2.25"/>',
    jornada: '<rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2"/><path d="M2.25 6.75h11.5M5.5 1.75v3M10.5 1.75v3"/>',
    'jornada-cancelada': '<rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2"/><path d="M2.25 6.75h11.5M5.5 1.75v3M10.5 1.75v3M6.25 9l3.5 3.25M9.75 9l-3.5 3.25"/>',
    actualizacion: '<path d="M10.75 2.25l3 3-8.25 8.25H2.5v-3z"/><path d="M9.25 3.75l3 3"/>',
    asistente: '<path d="M2.5 3.25h11v7.25h-6l-3 2.5v-2.5h-2z"/>',
    otro: '<circle cx="8" cy="8" r="6.25"/><circle cx="8" cy="8" r="1" fill="currentColor"/>',
    lote: '<path d="M8 1.75v7.5M5 6.5l3 3 3-3"/><path d="M2.25 9.75v2.75a1.25 1.25 0 0 0 1.25 1.25h9a1.25 1.25 0 0 0 1.25-1.25V9.75"/>',
  };
  const iconoMov = (clave) => {
    const el = document.createElementNS(SVGNS, 'svg');
    el.setAttribute('viewBox', '0 0 16 16');
    el.setAttribute('class', 'icono icono-mov');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '1.5');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.innerHTML = ICONOS_MOV[clave] || ICONOS_MOV.otro;
    return el;
  };

  // El autor tal cual llega. Si es un teléfono sin nombre (ios-xxxx), se dice que es un teléfono.
  const esTelefono = (a) => /^ios-/i.test(a || '');
  const quienDe = (f) => f.autor || f.dispositivo || null;
  const autorTexto = (a) => (!a ? 'Sin registro' : esTelefono(a) ? `Teléfono ${a}` : a);
  function autorEl(f) {
    const a = quienDe(f);
    if (!a) return h('span', { class: 'autor sin' }, 'Sin registro');
    if (esTelefono(a)) return h('span', { class: 'autor telefono' }, `Teléfono ${a}`);
    return h('b', { class: 'autor', title: f.dispositivo && f.dispositivo !== a ? `Desde ${f.dispositivo}` : null }, a);
  }
  const CAMPOS = { nombre: 'nombre', apellidoPaterno: 'apellido paterno', apellidoMaterno: 'apellido materno', nacimiento: 'fecha de nacimiento', comunidad: 'comunidad', municipio: 'municipio', telefono: 'teléfono', curp: 'CURP' };
  const enLista = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

  // La frase de una fila. `ctx.folio(f)` pinta el folio de la paciente; `ctx.otra(f)` el de la otra ficha;
  // con `ctx.ella` (panel de una paciente) la paciente ya se sabe y la frase no la repite.
  function frase(f, ctx) {
    const F = () => ctx.folio(f), O = () => ctx.otra(f) || 'otra ficha', ella = ctx.ella;
    const de = () => (ella ? '' : [' de ', F()]);
    const campos = f.campos?.length ? enLista(f.campos.map((c) => CAMPOS[c] || c)) : null;
    const lugar = f.comunidad ? [' en ', h('b', { class: 'lugar' }, f.comunidad)] : '';
    switch (f.tipo) {
      case 'alta': return ella ? 'la dio de alta' : ['dio de alta a ', F()];
      case 'visita': return ['registró una visita', de()];
      case 'estudio': return ['registró un estudio', de()];
      case 'actualizacion': return ['corrigió ', campos || 'datos', de()];
      case 'conflicto': return ['mandó un cambio', ella ? '' : [' a ', F()], ' que chocó con otro', campos ? ` (${campos})` : ''];
      case 'conflicto-aceptar': return ['aceptó el cambio en conflicto', de()];
      case 'conflicto-rechazar': return ['rechazó el cambio en conflicto', de()];
      case 'duplicado-unir': return ella ? ['la unió con ', O()] : ['unió ', F(), ' con ', O()];
      case 'duplicado-separar': return ella ? ['marcó que es distinta de ', O()] : ['marcó ', F(), ' y ', O(), ' como distintas'];
      case 'interpretacion': case 'estudio-interpretado': return ella ? 'interpretó su papanicolaou' : ['interpretó el papanicolaou de ', F()];
      case 'avisado': case 'estudio-avisado': case 'seguimiento-atendido': return ella ? 'la marcó como avisada' : ['marcó a ', F(), ' como avisada'];
      case 'jornada-programada': return ['programó una jornada', lugar];
      case 'jornada-cancelada': return ['canceló la jornada', lugar];
      case 'consulta-asistente': return 'consultó al asistente';
      default: {
        const t = QUE[f.tipo] || f.tipo;
        return [t[0].toLowerCase() + t.slice(1), f.pacienteId && !ella ? [' · ', F()] : ''];
      }
    }
  }

  const diaLargo = (iso) => new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date(iso));
  function nombreDia(iso) {
    const d = diaDe(iso);
    if (d === diaDe(new Date().toISOString())) return { corto: 'Hoy', largo: diaLargo(iso) };
    if (d === diaDe(new Date(Date.now() - 86400000).toISOString())) return { corto: 'Ayer', largo: diaLargo(iso) };
    const l = diaLargo(iso);
    return { corto: l[0].toUpperCase() + l.slice(1), largo: null };
  }
  // Agrupa filas (más nuevas primero) por día, conservando el orden.
  function porDia(filas) {
    const dias = [];
    for (const f of filas) {
      const d = diaDe(f.cuando);
      if (!dias.length || dias[dias.length - 1].dia !== d) dias.push({ dia: d, cuando: f.cuando, filas: [] });
      dias[dias.length - 1].filas.push(f);
    }
    return dias;
  }
  const cabezaDia = (d, total) => {
    const nom = nombreDia(d.cuando);
    return h('h2', { class: 'dia' }, h('span', {}, h('b', {}, nom.corto), nom.largo ? h('span', { class: 'tenue' }, ` · ${nom.largo}`) : null),
      h('span', { class: 'tenue num' }, plural(total, 'movimiento', 'movimientos')));
  };

  // Un teléfono que sincroniza manda muchos movimientos en el mismo minuto: se juntan en un lote.
  const MIN_LOTE = 8;
  // Con búsqueda por folio no se junta nada: se quiere ver cada fila.
  function enLotes(filas) {
    const items = [];
    for (let i = 0; i < filas.length;) {
      const f = filas[i], disp = f.dispositivo, minuto = f.cuando.slice(0, 16);
      let j = i + 1;
      if (disp) while (j < filas.length && filas[j].dispositivo === disp && filas[j].cuando.slice(0, 16) === minuto) j++;
      if (j - i >= MIN_LOTE) { items.push({ lote: filas.slice(i, j) }); i = j; } else { items.push({ fila: f }); i++; }
    }
    return items;
  }
  function contarPorGrupo(filas) {
    const c = new Map();
    for (const f of filas) { const g = grupoDe(f.tipo); c.set(g, (c.get(g) || 0) + 1); }
    return c;
  }
  const resumenGrupos = (filas) => enLista(GRUPOS.filter((g) => contarPorGrupo(filas).get(g))
    .map((g) => { const k = contarPorGrupo(filas).get(g); return `${n(k)} ${k === 1 ? g.uno : g.varios}`; }));

  async function vistaBitacora(vista, q = {}) {
    document.title = 'Bitácora · Expediente Rosa';
    let limite = 200, todas = [], ids = new Set(), recientes = new Set(), primera = true, cerrado = false;
    let fuentes = [], sondeo = null, recarga = null, abiertas = 0;
    const abiertosLotes = new Set();
    const folios = new Map(); // pacienteId → folio (de la misma bitácora o de /api/pacientes/:id)
    const pedidos = new Set();
    const filtros = { tipo: q.tipo || '', autor: q.autor || '', folio: (q.folio || '').toUpperCase() };

    // ----- Encabezado y filtros -----
    const periodo = h('span', {}, 'Cargando…');
    const vivo = h('span', { class: 'pildora', hidden: true });
    const ejemplo = h('span', { class: 'pildora ejemplo', hidden: true }, h('span', { class: 'punto' }), 'Datos de ejemplo');
    const anuncio = h('span', { class: 'solo-lector', role: 'status', 'aria-live': 'polite' });
    const buscaFolio = h('input', { type: 'search', name: 'folio', autocomplete: 'off', spellcheck: 'false', placeholder: 'Ej. HUE-004', value: filtros.folio, class: 'mono-campo' });
    const selAutor = h('select', { name: 'autor' });
    const verTodo = h('button', { class: 'boton quieto', type: 'button', onclick: () => { filtros.tipo = ''; filtros.autor = ''; filtros.folio = ''; buscaFolio.value = ''; cambio(); buscaFolio.focus(); } }, 'Ver todo');
    buscaFolio.addEventListener('input', () => { filtros.folio = buscaFolio.value.trim().toUpperCase(); cambio(); });
    buscaFolio.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && buscaFolio.value) { ev.preventDefault(); buscaFolio.value = ''; filtros.folio = ''; cambio(); } });
    selAutor.addEventListener('change', () => { filtros.autor = selAutor.value; cambio(); });

    const filtrosCaja = h('div', { class: 'derecha filtros' },
      h('label', { class: 'campo' }, h('span', {}, 'Folio'), buscaFolio),
      h('label', { class: 'campo' }, h('span', {}, 'Quién'), selAutor),
      verTodo);
    const chips = h('div', { class: 'tipos', role: 'group', 'aria-label': 'Movimientos por tipo. Elige uno para filtrar.' });
    const lista = h('div', { class: 'linea-tiempo' }, esqueletoBitacora());
    const cuerpo = h('section', { class: 'panel bitacora', 'aria-label': 'Movimientos, el más nuevo primero' }, lista);
    const cajon = cajonFolio();

    vista.append(
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, 'Bitácora'), h('p', { class: 'meta' }, periodo, vivo, ejemplo, anuncio)),
        filtrosCaja),
      chips, cuerpo, cajon.el);

    // ----- Filtros -----
    const activos = () => !!(filtros.tipo || filtros.autor || filtros.folio);
    const pasaAutor = (f) => !filtros.autor || quienDe(f) === filtros.autor;
    const pasaFolio = (f) => !filtros.folio || [f.folio, folios.get(f.otraPacienteId)].some((x) => x && x.toUpperCase().includes(filtros.folio));
    const pasaTipo = (f) => !filtros.tipo || grupoDe(f.tipo).id === filtros.tipo;

    function cambio() {
      history.replaceState(null, '', '#/' + conQuery('bitacora', { tipo: filtros.tipo, autor: filtros.autor, folio: filtros.folio }));
      pintar();
    }

    function pintarAutores() {
      const cuenta = new Map();
      for (const f of todas) { const a = quienDe(f) || ''; cuenta.set(a, (cuenta.get(a) || 0) + 1); }
      if (filtros.autor && !cuenta.has(filtros.autor)) cuenta.set(filtros.autor, 0);
      const orden = [...cuenta].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
      selAutor.replaceChildren(h('option', { value: '' }, 'Todas'),
        ...orden.filter(([a]) => a).map(([a, k]) => h('option', { value: a, selected: a === filtros.autor }, `${autorTexto(a)} (${n(k)})`)));
    }

    function pintarChips(base) {
      const cuenta = contarPorGrupo(base);
      chips.replaceChildren(...GRUPOS.filter((g) => g.siempre || cuenta.get(g) || filtros.tipo === g.id).map((g) => {
        const k = cuenta.get(g) || 0, activo = filtros.tipo === g.id;
        return h('button', {
          class: 'tipo' + (k ? '' : ' cero-tipo'), type: 'button', 'aria-pressed': activo ? 'true' : 'false',
          disabled: !k && !activo, 'aria-label': `${g.nombre}: ${n(k)}${activo ? '. Filtro activo; toca para quitarlo.' : ''}`,
          onclick: () => { filtros.tipo = activo ? '' : g.id; cambio(); },
        }, iconoMov(g.id), h('b', { class: 'num' }, n(k)), h('span', {}, g.nombre));
      }));
    }

    // ----- Línea de tiempo -----
    const ctxLista = {
      folio: (f) => botonFolio(f.folio, f.pacienteId),
      otra: (f) => (f.otraPacienteId ? botonFolio(folios.get(f.otraPacienteId), f.otraPacienteId) : null),
    };
    function botonFolio(folio, pacienteId) {
      if (!pacienteId && !folio) return h('span', { class: 'cero' }, 'sin folio');
      const texto = folio || pacienteId.slice(0, 8).toLowerCase();
      if (!pacienteId) return h('span', { class: 'mono folio' }, texto);
      return h('button', { class: 'folio-boton mono', type: 'button', 'aria-haspopup': 'dialog', title: 'Ver la bitácora de esta paciente', onclick: (ev) => cajon.abrir(folio, pacienteId, ev.currentTarget) }, texto);
    }
    const filaMov = (f, ctx) => h('li', { class: 'mov' + (recientes.has(f.id) ? ' nueva' : ''), 'data-id': f.id },
      h('time', { class: 'hora num', datetime: f.cuando }, hora(f.cuando)),
      h('span', { class: 'ico' }, iconoMov(grupoDe(f.tipo).id)),
      h('p', { class: 'texto' }, autorEl(f), ' ', [frase(f, ctx)].flat(Infinity)));

    function filaLote(filas) {
      const clave = filas[filas.length - 1].id; // el más viejo no cambia aunque lleguen más
      const abierto = abiertosLotes.has(clave);
      const autores = [...new Set(filas.map(quienDe).filter(Boolean))];
      const pacientes = new Set(filas.map((f) => f.pacienteId).filter(Boolean)).size;
      const disp = filas[0].dispositivo;
      const detalle = h('ol', { class: 'lote-filas', id: 'lote-' + clave.replace(/[^\w-]/g, ''), hidden: !abierto }, abierto ? filas.map((f) => filaMov(f, ctxLista)) : null);
      const boton = h('button', {
        class: 'boton quieto chico ver-lote', type: 'button', 'aria-expanded': abierto ? 'true' : 'false', 'aria-controls': detalle.id,
        onclick: () => {
          const abrir = !abiertosLotes.has(clave);
          if (abrir) { abiertosLotes.add(clave); detalle.replaceChildren(...filas.map((f) => filaMov(f, ctxLista))); } else abiertosLotes.delete(clave);
          detalle.hidden = !abrir;
          boton.setAttribute('aria-expanded', String(abrir));
          boton.textContent = abrir ? 'Ocultar' : `Ver los ${n(filas.length)}`;
        },
      }, abierto ? 'Ocultar' : `Ver los ${n(filas.length)}`);
      const nueva = filas.some((f) => recientes.has(f.id));
      return h('li', { class: 'mov lote' + (nueva ? ' nueva' : ''), 'data-id': clave },
        h('time', { class: 'hora num', datetime: filas[0].cuando }, hora(filas[0].cuando)),
        h('span', { class: 'ico' }, iconoMov('lote')),
        h('div', { class: 'texto' },
          h('p', {}, enLista(autores.map(autorTexto)).length ? h('b', { class: 'autor' }, enLista(autores.map(autorTexto))) : null,
            autores.length > 1 ? ' sincronizaron ' : ' sincronizó ', resumenGrupos(filas)),
          h('p', { class: 'lote-sub' }, `${plural(pacientes, 'paciente', 'pacientes')} · llegaron juntos de ${autorTexto(disp)}`)),
        boton, detalle);
    }

    function pintar() {
      verTodo.hidden = !activos();
      pintarAutores();
      const base = todas.filter((f) => pasaAutor(f) && pasaFolio(f));
      pintarChips(base);
      const filas = base.filter(pasaTipo);
      chips.hidden = filtrosCaja.hidden = !todas.length && !activos();
      if (!todas.length) {
        periodo.textContent = 'Quién hizo qué y cuándo, sin datos clínicos.';
        lista.replaceChildren(vacioConMascota('Sin movimientos todavía', 'Cada alta, visita, estudio y aviso aparece aquí en cuanto llega de las brigadas.'));
        return;
      }
      const viejo = todas[todas.length - 1].cuando;
      periodo.textContent = `${plural(todas.length, 'movimiento', 'movimientos')} desde ${cuando(viejo)} · sin datos clínicos`;
      if (!filas.length) {
        lista.replaceChildren(h('div', { class: 'sin-resultados' }, h('b', {}, 'Nada con estos filtros'),
          h('p', { class: 'tenue' }, filtros.folio ? `Ningún folio contiene «${filtros.folio}» en este periodo.` : 'Prueba con otro tipo o con otra persona.'),
          h('button', { class: 'boton secundario chico', type: 'button', onclick: () => verTodo.click() }, 'Ver todo')));
        return;
      }
      lista.replaceChildren(...porDia(filas).map((d) => h('section', { class: 'dia-bloque' },
        cabezaDia(d, d.filas.length),
        h('ol', { class: 'movs' }, (filtros.folio ? d.filas.map((fila) => ({ fila })) : enLotes(d.filas)).map((it) => (it.lote ? filaLote(it.lote) : filaMov(it.fila, ctxLista)))))),
        ...(todas.length >= limite && limite < 500 ? [h('div', { class: 'mas' }, h('button', { class: 'boton secundario chico', type: 'button', onclick: () => { limite = 500; cargar(); } }, 'Cargar anteriores'))] : []));
      // Con «Reducir movimiento» la fila nueva solo se marca un momento, sin moverse.
      if (recientes.size) {
        recientes = new Set();
        setTimeout(() => lista.querySelectorAll('.nueva').forEach((x) => x.classList.remove('nueva')), 2400);
      }
    }

    // ----- Datos -----
    async function cargar() {
      const r = await pedir(conQuery('/api/bitacora', { limite: String(limite) }));
      if (cerrado) return;
      if (!r.ok) {
        if (primera) lista.replaceChildren(h('div', { class: 'sin-resultados' }, h('p', { class: 'error' }, `No se pudo leer la bitácora (${r.status}).`), h('button', { class: 'boton secundario chico', type: 'button', onclick: cargar }, 'Reintentar')));
        return;
      }
      ejemplo.hidden = !r.ejemplo;
      const filas = (r.datos || []).slice().sort((a, b) => b.cuando.localeCompare(a.cuando));
      const nuevos = primera ? [] : filas.filter((f) => !ids.has(f.id));
      if (!primera && !nuevos.length && filas.length === todas.length) return; // nada cambió: no se repinta
      for (const f of filas) if (f.pacienteId && f.folio) folios.set(f.pacienteId, f.folio);
      todas = filas; ids = new Set(filas.map((f) => f.id)); recientes = new Set(nuevos.map((f) => f.id));
      if (nuevos.length) anuncio.textContent = nuevos.length === 1 ? 'Llegó un movimiento nuevo.' : `Llegaron ${n(nuevos.length)} movimientos nuevos.`;
      pintar();
      buscarOtras();
      if (primera) { primera = false; if (!r.ejemplo) conectarVivo(); }
    }

    // El folio de la «otra ficha» de un duplicado: de la bitácora o, si no está, del expediente (solo el folio).
    async function buscarOtras() {
      const faltan = [...new Set(todas.map((f) => f.otraPacienteId).filter((id) => id && !folios.has(id) && !pedidos.has(id)))];
      if (!faltan.length) return;
      faltan.forEach((id) => pedidos.add(id));
      const rs = await Promise.all(faltan.map((id) => pedir(`/api/pacientes/${encodeURIComponent(id)}`)));
      if (cerrado) return;
      let algo = false;
      rs.forEach((r, i) => { if (r.ok && r.datos?.folio) { folios.set(faltan[i], r.datos.folio); algo = true; } });
      if (algo) pintar();
    }

    // En vivo: el SSE de la jornada (hasta 3 comunidades, como el tablero); si no, refresco cada 15 s.
    async function conectarVivo() {
      const pedirRecarga = () => { clearTimeout(recarga); recarga = setTimeout(cargar, 500); };
      const marcar = () => {
        vivo.hidden = false;
        vivo.className = abiertas > 0 ? 'pildora vivo' : 'pildora';
        vivo.replaceChildren(...(abiertas > 0 ? [h('span', { class: 'punto' }), 'En vivo'] : ['Se actualiza cada 15 s']));
        clearInterval(sondeo);
        sondeo = setInterval(() => { if (!document.hidden) cargar(); }, abiertas > 0 ? 60000 : 15000);
      };
      marcar();
      const r = await pedir('/api/resumen');
      if (cerrado || !r.ok || !window.EventSource) return;
      const comunidades = [...new Set((r.datos?.porComunidad || []).map((c) => c.comunidad).filter(Boolean))];
      if (!comunidades.length || comunidades.length > 3) return;
      for (const c of comunidades) {
        const es = new EventSource(`/api/jornada/${encodeURIComponent(c)}/en-vivo`);
        let abierta = false;
        es.onopen = () => { if (!abierta) { abierta = true; abiertas++; marcar(); } };
        es.onerror = () => { if (abierta) { abierta = false; abiertas--; marcar(); } };
        for (const ev of ['alta', 'estudio', 'visita', 'interpretacion', 'avisado', 'duplicado', 'actualizacion', 'conflicto']) es.addEventListener(ev, pedirRecarga);
        fuentes.push(es);
      }
    }
    const alVolver = () => { if (!document.hidden && !primera) cargar(); };
    document.addEventListener('visibilitychange', alVolver);

    pintarAutores();
    await cargar();
    return () => {
      cerrado = true; fuentes.forEach((f) => f.close()); clearInterval(sondeo); clearTimeout(recarga);
      document.removeEventListener('visibilitychange', alVolver); cajon.cerrar();
    };

    // ----- Panel lateral: la bitácora de una paciente (sin datos clínicos) -----
    function cajonFolio() {
      const titulo = h('h2', { class: 'mono', id: 'cajon-titulo' });
      const meta = h('p', { class: 'nota' });
      const contenido = h('div', { class: 'cajon-cuerpo' });
      const filtrar = h('button', { class: 'boton secundario chico', type: 'button' }, 'Filtrar la lista por este folio');
      const el = h('dialog', { class: 'cajon', 'aria-labelledby': 'cajon-titulo' },
        h('div', { class: 'cajon-cabeza' },
          h('div', {}, h('p', { class: 'nota' }, 'Bitácora de la paciente'), titulo),
          h('button', { class: 'boton quieto cerrar', type: 'button', 'aria-label': 'Cerrar', onclick: () => cerrar() },
            s('svg', { viewBox: '0 0 16 16', class: 'icono', 'aria-hidden': 'true' }, s('path', { d: 'M3.5 3.5l9 9M12.5 3.5l-9 9', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round' })))),
        meta, contenido,
        h('div', { class: 'cajon-pie' }, filtrar, h('p', { class: 'nota' }, 'Solo quién, qué y cuándo. Los resultados se ven en el expediente.')));
      let origen = null, pedido = 0;
      el.addEventListener('click', (ev) => { if (ev.target === el) cerrar(); }); // clic en el fondo
      el.addEventListener('close', () => { origen?.focus?.(); });
      function cerrar() { if (el.open) el.close(); }

      async function abrir(folio, pacienteId, desde) {
        origen = desde;
        const yo = ++pedido;
        titulo.textContent = folio || pacienteId.slice(0, 8).toLowerCase();
        meta.textContent = 'Cargando…';
        contenido.replaceChildren(esqueletoBitacora(3));
        filtrar.hidden = !folio;
        filtrar.onclick = () => { filtros.folio = folio.toUpperCase(); buscaFolio.value = filtros.folio; filtros.tipo = ''; cerrar(); cambio(); };
        if (!el.open) el.showModal();
        const r = await pedir(conQuery('/api/bitacora', { limite: '200', pacienteId }));
        if (yo !== pedido || cerrado) return;
        if (!r.ok) { meta.textContent = ''; contenido.replaceChildren(h('p', { class: 'error' }, `No se pudo leer (${r.status}).`)); return; }
        const filas = (r.datos || []).filter((f) => f.pacienteId === pacienteId || f.otraPacienteId === pacienteId)
          .sort((a, b) => b.cuando.localeCompare(a.cuando));
        if (!filas.length) { meta.textContent = 'Sin movimientos.'; contenido.replaceChildren(); return; }
        const primero = filas[filas.length - 1].cuando;
        meta.textContent = `${resumenGrupos(filas)} · desde ${cuando(primero)}`;
        const ctx = {
          ella: true,
          folio: () => null,
          // Si esta paciente es la «otra» del duplicado, la otra ficha es la de la fila.
          otra: (f) => (f.otraPacienteId === pacienteId ? h('span', { class: 'mono folio' }, f.folio || 'otra ficha')
            : f.otraPacienteId ? h('span', { class: 'mono folio' }, folios.get(f.otraPacienteId) || 'otra ficha') : null),
        };
        contenido.replaceChildren(...porDia(filas).map((d) => h('section', { class: 'dia-bloque' },
          cabezaDia(d, d.filas.length),
          h('ol', { class: 'movs' }, d.filas.map((f) => filaMov(f, ctx))))));
      }
      return { el, abrir, cerrar };
    }
  }
  function esqueletoBitacora(k = 6) {
    return h('div', { 'aria-hidden': 'true', class: 'esqueleto-mov' }, Array.from({ length: k }, (_, i) => h('div', {},
      h('div', { class: 'hueso', style: 'height:14px;width:40px' }), h('div', { class: 'hueso', style: 'height:28px;width:28px;border-radius:50%' }),
      h('div', { class: 'hueso', style: `height:16px;width:${[62, 48, 70, 54, 40, 66][i % 6]}%` }))));
  }

  // ---------- 6. Asistente ----------
  // Las cifras las calcula la API; el modelo de Apple, en la Mac donde corre la API, solo redacta.
  const SUGERIDAS = [
    '¿Cuántas mujeres de San Martín Peras tienen un BI-RADS 4 sin atender?',
    'Resume la jornada de hoy',
    '¿Qué pasó con Eulalia?',
    '¿Qué papanicolaous llevan más tiempo esperando?',
  ];
  const turnos = []; // la conversación sigue ahí si cambias de vista y regresas
  let modeloCaliente = false;

  function botonPreguntar(q) {
    // La mascota es la cara del asistente; sin mascota.js queda el globo de antes.
    const cara = mascota('reposo', { tamano: 26, sobreRosa: true }) || s('svg', { viewBox: '0 0 16 16', class: 'icono', 'aria-hidden': 'true' },
      s('path', { d: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linejoin': 'round' }));
    return h('a', { class: 'boton principal flotante', href: '#/' + conQuery('asistente', { comunidad: q.comunidad }) }, cara, 'Preguntar');
  }

  async function vistaAsistente(vista, q) {
    document.title = 'Asistente · Expediente Rosa';
    let cerrado = false;
    const comunidad = q.comunidad || '';
    const sel = h('select', { 'aria-label': 'Comunidad', onchange: (ev) => ir('asistente', { comunidad: ev.target.value }) }, h('option', { value: '' }, 'Todas'));
    const llenarSel = () => {
      const nombres = new Set(comunidadesConocidas.map((c) => c.comunidad));
      if (comunidad) nombres.add(comunidad);
      sel.replaceChildren(h('option', { value: '' }, 'Todas'), ...[...nombres].sort((a, b) => a.localeCompare(b, 'es')).map((c) => h('option', { value: c, selected: c === comunidad }, c)));
    };
    llenarSel();
    if (!comunidadesConocidas.length) pedir('/api/resumen').then((r) => {
      if (cerrado || !r.ok) return;
      for (const c of r.datos?.porComunidad || []) if (c.estado !== 'Sin estado' && !comunidadesConocidas.some((x) => x.comunidad === c.comunidad)) comunidadesConocidas.push({ comunidad: c.comunidad, estado: c.estado });
      llenarSel();
    });

    // La cara del asistente, junto a donde se le pregunta: busca mientras el modelo redacta.
    const avatar = avatarAsistente = mascota(turnos.some((t) => t.estado === 'pensando') ? 'buscando' : 'reposo', { tamano: 44 });
    const campo = h('input', { id: 'pregunta', name: 'pregunta', autocomplete: 'off', maxlength: '500', required: true, placeholder: 'Escribe una pregunta' });
    const boton = h('button', { class: 'boton principal', type: 'submit' }, 'Preguntar');
    const lista = h('ol', { class: 'turnos', 'aria-label': 'Respuestas, la más nueva primero', 'aria-live': 'polite' });
    const form = h('form', {
      class: 'preguntar', role: 'search',
      onsubmit: (ev) => { ev.preventDefault(); enviar(campo.value); },
    },
      h('label', { class: 'solo-lector', for: 'pregunta' }, 'Pregunta'),
      h('div', { class: 'fila-pregunta' }, campo, boton),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Preguntas sugeridas' },
        SUGERIDAS.map((t) => h('button', { class: 'chip', type: 'button', onclick: () => { campo.value = t; enviar(t); } }, t))));

    vista.append(
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, 'Asistente'), h('p', { class: 'meta' }, 'Las cifras salen de la base. El modelo de Apple las redacta en esta Mac, sin nube.')),
        h('div', { class: 'derecha' }, h('label', { class: 'campo' }, h('span', {}, 'Comunidad'), sel))),
      h('section', { class: 'panel asistente' + (avatar ? ' con-avatar' : '') }, avatar, form),
      lista);

    function enviar(texto) {
      const pregunta = texto.trim();
      if (!pregunta) { campo.focus(); return; }
      if (turnos.some((t) => t.estado === 'pensando')) return; // una a la vez: el modelo responde en fila
      const t = { pregunta, comunidad, estado: 'pensando', inicio: Date.now(), r: null, el: null };
      turnos.unshift(t);
      campo.value = '';
      pintarLista();
      preguntarTurno(t);
    }
    alCambiar = actualizarBoton;

    function actualizarBoton() {
      const ocupado = turnos.some((t) => t.estado === 'pensando');
      boton.disabled = ocupado;
      boton.textContent = ocupado ? 'Pensando…' : 'Preguntar';
      form.querySelectorAll('.chip').forEach((c) => { c.disabled = ocupado; });
    }

    function pintarLista() {
      lista.replaceChildren(...turnos.map((t) => { t.el = h('li', { class: 'turno' }); pintarTurno(t); return t.el; }));
      actualizarBoton();
    }

    // Reloj de la espera: solo mientras hay una respuesta en camino y la vista está abierta.
    const reloj = setInterval(() => { for (const t of turnos) if (t.estado === 'pensando') pintarTurno(t); }, 1000);

    pintarLista();
    if (!turnos.length) campo.focus();
    return () => { cerrado = true; clearInterval(reloj); alCambiar = () => {}; avatarAsistente = null; };
  }

  // La vista abierta avisa aquí cuándo cambia el estado (para el botón y los chips).
  let alCambiar = () => {};
  let avatarAsistente = null;
  async function preguntarTurno(t) {
    t.estado = 'pensando'; t.inicio = Date.now();
    pintarTurno(t); alCambiar();
    if (avatarAsistente) Mascota.cambiar(avatarAsistente, 'buscando');
    const r = await pedir('/api/asistente', { metodo: 'POST', cuerpo: { pregunta: t.pregunta, comunidad: t.comunidad || undefined, autor: `${usuario.nombre} (coordinación)` } });
    if (r.ok && r.datos?.respuesta) { t.estado = 'listo'; t.r = r.datos; if (r.datos.motor === 'apple') modeloCaliente = true; }
    else {
      t.estado = 'error';
      t.error = r.ejemplo ? 'Esta API todavía no tiene el asistente. Reiníciala con el código nuevo.' : `No se pudo responder (${r.status}). Intenta otra vez.`;
    }
    pintarTurno(t); alCambiar();
    // Contenta 2 s cuando llega la respuesta; si falló, de vuelta a reposo.
    if (avatarAsistente) {
      if (t.estado === 'listo') Mascota.cambiar(avatarAsistente, 'contenta', { volver: 'reposo', tras: 2000 });
      else Mascota.cambiar(avatarAsistente, 'reposo');
    }
  }

  function pintarTurno(t) {
    if (!t.el) return;
    const preguntaEl = h('p', { class: 'turno-pregunta' }, t.pregunta, t.comunidad ? h('span', { class: 'tenue' }, ` · ${t.comunidad}`) : null);
    let tarjeta;
    if (t.estado === 'pensando') {
      const s = Math.floor((Date.now() - t.inicio) / 1000);
      tarjeta = h('div', { class: 'respuesta pensando', role: 'status' },
        h('div', { class: 'pensando-linea' }, h('span', { class: 'puntos', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('b', {}, 'Pensando en esta Mac…'), h('span', { class: 'tenue num' }, `${s} s`)),
        !modeloCaliente && s >= 5 ? h('p', { class: 'nota' }, 'La primera respuesta tarda hasta 30 s mientras el modelo carga. Las siguientes, unos segundos.') : null);
    } else if (t.estado === 'error') {
      tarjeta = h('div', { class: 'respuesta' }, h('p', { class: 'error' }, t.error),
        h('button', { class: 'boton secundario chico', type: 'button', onclick: () => reintentar(t) }, 'Reintentar'));
    } else {
      const r = t.r;
      const apple = r.motor === 'apple';
      tarjeta = h('div', { class: 'respuesta' },
        h('p', { class: 'respuesta-texto' }, conFolios(r.respuesta, r.datosUsados?.folios || {})),
        h('div', { class: 'respuesta-pie' },
          h('span', { class: 'sello ' + (apple ? 'apple' : 'cifras'), title: apple ? 'Redactado por Foundation Models en la Mac donde corre la API. Las cifras las calculó la API.' : (r.motivo ? `Sin modelo: ${r.motivo}` : 'Sin modelo') },
            h('span', { class: 'punto' }), apple ? 'Modelo de Apple · en esta Mac · sin nube' : 'Sin modelo: cifras directas'),
          !apple && r.motivo ? h('span', { class: 'nota' }, r.motivo[0].toUpperCase() + r.motivo.slice(1)) : null,
          r.ms ? h('span', { class: 'nota num' }, `${(r.ms / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} s`) : null),
        datosUsados(r.datosUsados));
    }
    t.el.replaceChildren(preguntaEl, tarjeta);
  }

  function reintentar(t) {
    if (turnos.some((x) => x.estado === 'pensando')) return; // una a la vez
    preguntarTurno(t);
  }

  // Folios clicables: llevan a Seguimiento o a Patología con la fila elegida.
  function conFolios(texto, folios) {
    const llaves = Object.keys(folios).sort((a, b) => b.length - a.length).map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!llaves.length) return texto;
    const partes = texto.split(new RegExp(`\\b(${llaves.join('|')})\\b`, 'g'));
    return partes.map((x, i) => {
      if (i % 2 === 0) return x;
      const destino = folios[x];
      if (!destino) return h('span', { class: 'mono folio' }, x);
      return h('a', { class: 'mono folio', href: '#/' + conQuery(destino, { folio: x }), title: destino === 'patologia' ? 'Ver en Patología' : 'Ver en Seguimiento' }, x);
    });
  }

  const ETIQUETA_INTENCION = { seguimiento: 'Seguimiento', patologia: 'Patología pendiente', hoy: 'Movimientos de hoy', paciente: 'Paciente', jornadas: 'Jornadas', general: 'Resumen' };
  function datosUsados(d) {
    if (!d) return null;
    const MAX = 10;
    const tabla = (titulo, cabezas, filas, celdas) => filas.length ? h('div', { class: 'du-bloque' },
      h('h3', {}, titulo, h('span', { class: 'tenue' }, ` · ${n(filas.length)}`)),
      h('div', { class: 'tabla-caja' }, h('table', {},
        h('thead', {}, h('tr', {}, cabezas.map((c) => h('th', { scope: 'col', class: c.n ? 'n' : null }, c.t || c)))),
        h('tbody', {}, filas.slice(0, MAX).map((f) => h('tr', {}, celdas(f).map((c, i) => h('td', { class: cabezas[i].n ? 'n' : null }, c))))))),
      filas.length > MAX ? h('p', { class: 'nota' }, `y ${n(filas.length - MAX)} más`) : null) : null;
    const plazo = (dias) => (dias < 0 ? `Vencido hace ${plural(-dias, 'día', 'días')}` : dias === 0 ? 'Vence hoy' : `Quedan ${plural(dias, 'día', 'días')}`);
    const filtros = [d.filtros?.comunidad, d.filtros?.estado, d.filtros?.clasificacion, d.filtros?.tipo && TIPO_ESTUDIO[d.filtros.tipo], d.filtros?.soloVencidos && 'solo vencidos'].filter(Boolean);
    const r = d.resumen || {};
    const bloques = {
      seguimiento: () => tabla('Seguimiento sin atender', ['Folio', 'Estudio', 'Clasificación', 'Plazo', 'Comunidad'], d.seguimiento || [],
        (f) => [h('span', { class: 'mono' }, f.folio), TIPO_ESTUDIO[f.tipo] || f.tipo, f.clasificacion || f.motivo, plazo(f.diasRestantes), f.comunidad]),
      patologia: () => tabla('Papanicolaous esperando', ['Folio', { t: 'Días esperando', n: true }, 'Comunidad'], d.patologia || [],
        (f) => [h('span', { class: 'mono' }, f.folio), n(f.diasEsperando), f.comunidad]),
      jornadas: () => tabla('Jornadas programadas', ['Fecha', 'Comunidad', { t: 'Pacientes', n: true }, { t: 'Pendientes', n: true }], d.jornadas || [],
        (j) => [fechaCorta(j.fecha), `${j.comunidad} · ${j.estado}`, n(j.pacientesPrevias), n(j.estudiosPendientes)]),
      hoy: () => tabla('Bitácora', ['Cuándo', 'Qué', 'Quién', 'Folio'], d.bitacora || [],
        (b) => [cuando(b.cuando), QUE[b.tipo] || b.tipo, b.autor, b.folio ? h('span', { class: 'mono' }, b.folio) : '—']),
      paciente: () => (d.pacientes || []).map((p) => h('div', { class: 'du-bloque' },
        h('h3', {}, `${p.nombre} `, h('span', { class: 'mono tenue' }, p.folio), h('span', { class: 'tenue' }, ` · ${p.comunidad}`)),
        tabla('Estudios', ['Fecha', 'Estudio', 'Resultado', 'Clasificación'], p.estudios || [],
          (e) => [fechaCorta(e.fecha), TIPO_ESTUDIO[e.tipo] || e.tipo, e.etapa === 'en-laboratorio' ? 'En laboratorio' : e.resultado, e.clasificacion || '—']),
        tabla('Visitas', ['Fecha', 'Comunidad', 'Jornada'], p.visitas || [], (v) => [fechaCorta(v.fecha), v.comunidad, v.jornada || '—']))),
    };
    const orden = { seguimiento: ['seguimiento'], patologia: ['patologia'], hoy: ['hoy', 'patologia'], paciente: ['paciente'], jornadas: ['jornadas'], general: ['seguimiento', 'patologia', 'jornadas'] }[d.intencion] || [];
    const resto = ['seguimiento', 'patologia', 'jornadas', 'hoy'].filter((k) => !orden.includes(k));
    return h('details', { class: 'datos-usados' },
      h('summary', {}, h('b', {}, 'Datos usados'), h('span', { class: 'tenue' }, ` · ${ETIQUETA_INTENCION[d.intencion] || d.intencion}${filtros.length ? ' · ' + filtros.join(', ') : ''}`)),
      h('div', { class: 'du-cuerpo' },
        d.calculada ? h('div', { class: 'du-bloque' }, h('h3', {}, 'Cifras calculadas por la API'), h('p', { class: 'du-calculada' }, d.calculada)) : null,
        h('dl', { class: 'du-resumen' },
          [['Personas', r.personas], ['Estudios', r.estudios], ['Anormales', r.anormales], ['Esperan patólogo', r.pendientesPatologia], ['En seguimiento', r.enSeguimiento], ['Vencidos', r.seguimientoVencido]]
            .map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, n(v))))),
        orden.flatMap((k) => bloques[k]()),
        h('details', { class: 'du-mas' }, h('summary', {}, 'Todo lo demás que recibió el modelo'), resto.flatMap((k) => bloques[k]())),
        h('p', { class: 'nota' }, `${n(d.caracteres)} caracteres de contexto. Nada sale de este servidor.`)));
  }

  // ---------- Arranque ----------
  // Igual al de la app (ios/.../Arranque.swift): fondo rosa, la mascota salta y saluda,
  // «Para EIRA Movimiento Rosa A.C.» abajo, y a 1 s se desvanece (0.35 s) hacia lo que hay debajo.
  // Todo con animaciones CSS; al terminar se quita. Decorativo: el contenido de abajo ya está listo.
  const arranqueListo = new Promise((listo) => {
    const cara = mascota('saluda', { tamano: 160, sobreRosa: true });
    if (!cara) return listo();
    const capa = h('div', { class: 'arranque', 'aria-hidden': 'true' },
      cara,
      h('div', { class: 'para' }, h('b', {}, 'Para'), h('img', { src: '/panel/eira-logo.png', alt: '', width: '95', height: '34' }), h('small', {}, 'Movimiento Rosa A.C.')));
    let quitada = false;
    const quitar = () => { if (quitada) return; quitada = true; capa.remove(); listo(); };
    capa.addEventListener('animationend', (ev) => { if (ev.target === capa) quitar(); });
    capa.addEventListener('click', quitar);
    setTimeout(quitar, 4000); // por si la pestaña estaba oculta y la animación no corrió
    document.body.append(capa);
  });

  // Alto real de la barra (en teléfono la navegación baja a otra fila): los encabezados fijos se pegan debajo.
  const barraEl = $('#barra');
  if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--alto-barra', `${barraEl.offsetHeight}px`)).observe(barraEl);

  window.addEventListener('hashchange', mostrar);
  mostrar();
})();
