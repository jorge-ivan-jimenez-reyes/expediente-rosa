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
    if (!permitidas.includes(ruta)) return ir(permitidas[0]);
    pintarBarra(ruta);
    vista.replaceChildren();
    if (ruta === 'tablero') limpiar = await vistaTablero(vista, q) || limpiar;
    if (ruta === 'jornadas') limpiar = await vistaJornadas(vista) || limpiar;
    if (ruta === 'patologia') limpiar = await vistaPatologia(vista) || limpiar;
    if (ruta === 'seguimiento') limpiar = await vistaSeguimiento(vista, q) || limpiar;
    if (ruta === 'bitacora') limpiar = await vistaBitacora(vista) || limpiar;
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
      h('h1', {}, '¿Quién eres?'),
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
    const ejemplo = h('span', { class: 'pildora ejemplo', hidden: true, title: 'La API todavía no tiene /api/resumen' }, h('span', { class: 'punto' }), 'Datos de ejemplo');
    const cuerpo = h('div', {}, esqueletoTablero());

    vista.append(
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, 'Tablero'), h('p', { class: 'meta' }, corte, vivo, ejemplo)),
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
        fuentes.push(es);
      }
    }

    llenarComunidades();
    cargar();
    return () => { cerrado = true; fuentes.forEach((f) => f.close()); clearInterval(sondeo); clearTimeout(recarga); };
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
        : h('p', { class: 'tenue' }, 'Sin jornadas registradas con este filtro.'));

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

  async function vistaPatologia(vista) {
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
      elegir(muestras[0] || null, false);
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
        detalle.replaceChildren(h('div', { class: 'vacio-vista' }, icono('normal'), h('b', {}, 'No hay muestras por interpretar'),
          h('p', {}, 'Cuando una brigada regrese con papanicolaous, aparecen aquí.')));
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
        form);
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

    const vacio = () => h('div', { class: 'vacio-vista' },
      h('b', {}, 'Sin jornadas programadas'),
      h('p', {}, 'Programa la siguiente. Los teléfonos de la brigada bajan a las pacientes de esa comunidad antes de salir.'),
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
      cuerpo.replaceChildren(h('div', { class: 'vacio-vista' }, icono('normal'), h('b', {}, 'Todas avisadas'),
        h('p', {}, 'Cuando patología marque un resultado anormal, la paciente aparece aquí con su fecha límite.')));
      return;
    }

    const autor = `${usuario.nombre} (coordinación)`;
    const tbody = h('tbody', {}, filas.map((f) => {
      const tr = h('tr', { 'data-id': f.estudioId });
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
  }
  function vistaSeguimientoVacia(cuerpo) {
    cuerpo.replaceChildren(h('div', { class: 'vacio-vista' }, icono('normal'), h('b', {}, 'Todas avisadas'),
      h('p', {}, 'Cuando patología marque un resultado anormal, la paciente aparece aquí con su fecha límite.')));
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
  };
  async function vistaBitacora(vista) {
    document.title = 'Bitácora · Expediente Rosa';
    let limite = 50;
    const meta = h('span', {}, 'Quién hizo qué y cuándo. Sin datos clínicos.');
    const ejemplo = h('span', { class: 'pildora ejemplo', hidden: true }, h('span', { class: 'punto' }), 'Datos de ejemplo');
    const cuerpo = h('section', { class: 'panel bitacora' }, h('p', { class: 'cargando' }, 'Cargando…'));
    vista.append(h('div', { class: 'encabezado' }, h('div', {}, h('h1', {}, 'Bitácora'), h('p', { class: 'meta' }, meta, ejemplo))), cuerpo);

    async function cargar() {
      const r = await pedir(`/api/bitacora?limite=${limite}`);
      if (!r.ok) { cuerpo.replaceChildren(h('p', { class: 'error' }, `No se pudo leer la bitácora (${r.status}).`)); return; }
      ejemplo.hidden = !r.ejemplo;
      const filas = r.datos || [];
      if (!filas.length) { cuerpo.replaceChildren(h('div', { class: 'vacio-vista' }, h('b', {}, 'Sin movimientos'), h('p', {}, 'Aquí aparece cada alta, estudio y aviso que llegue de las brigadas.'))); return; }
      cuerpo.replaceChildren(
        h('div', { class: 'tabla-caja' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Cuándo'), h('th', { scope: 'col' }, 'Quién'), h('th', { scope: 'col' }, 'Qué'), h('th', { scope: 'col' }, 'Paciente'))),
          h('tbody', {}, filas.map((f) => h('tr', {},
            h('td', { class: 'cuando' }, h('time', { datetime: f.cuando }, cuando(f.cuando))),
            h('td', { class: 'quien-fue' }, f.autor || f.dispositivo || h('span', { class: 'cero' }, 'Sin registro')),
            h('td', {}, (QUE[f.tipo] || f.tipo), f.campos?.length ? h('span', { class: 'tenue' }, `: ${f.campos.join(', ')}`) : null, f.comunidad ? h('span', { class: 'tenue' }, ` en ${f.comunidad}`) : null),
            h('td', {}, f.pacienteId ? h('span', { class: 'mono tenue', title: f.pacienteId }, f.folio || f.pacienteId.slice(0, 8).toLowerCase()) : h('span', { class: 'cero' }, '—'))))))),
        filas.length >= limite && limite < 500 ? h('div', { class: 'mas' }, h('button', { class: 'boton secundario chico', type: 'button', onclick: () => { limite = Math.min(limite * 4, 500); cargar(); } }, 'Ver más')) : null);
    }
    await cargar();
  }

  // ---------- Arranque ----------
  window.addEventListener('hashchange', mostrar);
  mostrar();
})();
