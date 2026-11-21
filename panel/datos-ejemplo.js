// Datos ficticios para el panel. Solo se cargan si la API responde 404
// (endpoint todavía no existe) o no hay API. Nombres inventados; las
// comunidades son reales solo como lugar. Responde con la misma forma que
// el contrato de /api/resumen, /api/patologia, /api/seguimiento, /api/bitacora y /api/jornadas.
(function () {
  'use strict';

  const DIA = 86400000;
  const HOY = Date.parse('2026-11-21T13:00:00-06:00');

  // Generador con semilla: los mismos datos en cada carga.
  let semilla = 20261121;
  const azar = () => {
    semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const uno = (lista) => lista[Math.floor(azar() * lista.length)];
  const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(azar() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
  const dia = (ms) => new Date(ms - 6 * 3600000).toISOString().slice(0, 10);

  const COMUNIDADES = [
    { comunidad: 'Huejuquilla', estado: 'Jalisco', clave: 'HUE', personas: 38 },
    { comunidad: 'Mezquitic', estado: 'Jalisco', clave: 'MEZ', personas: 22 },
    { comunidad: 'San Martín Peras', estado: 'Oaxaca', clave: 'SMP', personas: 46 },
    { comunidad: 'Santiago Juxtlahuaca', estado: 'Oaxaca', clave: 'JUX', personas: 31 },
    { comunidad: 'Coicoyán de las Flores', estado: 'Oaxaca', clave: 'COI', personas: 17 },
    { comunidad: 'Metlatónoc', estado: 'Guerrero', clave: 'MET', personas: 41 },
    { comunidad: 'Cochoapa el Grande', estado: 'Guerrero', clave: 'COC', personas: 26 },
  ];
  const NOMBRES = ['María', 'Juana', 'Guadalupe', 'Rosa', 'Bertha', 'Eulalia', 'Margarita', 'Petra', 'Lucía', 'Josefina', 'Teresa', 'Catalina', 'Isabel', 'Felipa', 'Antonia', 'Rufina', 'Herminia', 'Socorro', 'Elena', 'Martha', 'Ofelia', 'Paula', 'Reyna', 'Silvia', 'Natalia', 'Irma'];
  const APELLIDOS = ['López', 'Hernández', 'García', 'Martínez', 'Vázquez', 'Ruiz', 'Santiago', 'Morales', 'Jiménez', 'Cruz', 'Ramírez', 'Mendoza', 'Bautista', 'Reyes', 'Flores', 'Gómez', 'Sánchez', 'Ortiz', 'Aguilar', 'Castillo', 'de la Cruz', 'Carrillo'];
  const BETHESDA_ANORMAL = ['ASC-US', 'LSIL', 'HSIL', 'ASC-H', 'AGC'];
  const ENFERMERIA = { HUE: 'enf-hue', MEZ: 'enf-mez', SMP: 'enf-smp', JUX: 'enf-jux', COI: 'enf-coi', MET: 'enf-met', COC: 'enf-coc' };

  const pacientes = [];
  const estudios = [];
  const visitas = [];
  const bitacora = [];

  const evento = (cuando, tipo, autor, extra) => bitacora.push({
    id: `${cuando}-${bitacora.length}`, cuando: new Date(cuando).toISOString(), tipo, autor, dispositivo: null, pacienteId: null, ...extra,
  });

  for (const c of COMUNIDADES) {
    // Cada comunidad tuvo su jornada en los últimos 3 a 20 días.
    const jornada = HOY - entre(3, 20) * DIA;
    for (let i = 1; i <= c.personas; i++) {
      const edad = entre(25, 69);
      const p = {
        id: uuid(), folio: `${c.clave}-${String(i).padStart(3, '0')}`,
        nombre: uno(NOMBRES), apellidoPaterno: uno(APELLIDOS), apellidoMaterno: uno(APELLIDOS),
        edad, comunidad: c.comunidad, estado: c.estado, version: 1,
      };
      pacientes.push(p);
      const fecha = jornada + entre(8, 15) * 3600000 + entre(0, 59) * 60000;
      const v = { id: uuid(), pacienteId: p.id, fecha: new Date(fecha).toISOString(), comunidad: c.comunidad, motivo: 'jornada de tamizaje', registradaPor: ENFERMERIA[c.clave] };
      visitas.push(v);
      evento(fecha, 'alta', ENFERMERIA[c.clave], { pacienteId: p.id });
      evento(fecha + 60000, 'visita', ENFERMERIA[c.clave], { pacienteId: p.id, visitaId: v.id });

      const tipos = ['exploracion', edad >= 40 ? 'mastografia' : 'ultrasonido'];
      if (azar() < 0.75) tipos.push('papanicolaou');
      for (const tipo of tipos) {
        const e = { id: uuid(), pacienteId: p.id, visitaId: v.id, tipo, fecha: dia(fecha), resultado: 'pendiente', etapa: 'tomado', registradoPor: 'med-' + c.clave.toLowerCase() };
        if (tipo === 'papanicolaou') {
          const r = azar();
          if (r < 0.12) e.etapa = 'tomado';
          else if (r < 0.42) e.etapa = 'en-laboratorio';
          else {
            e.etapa = r < 0.8 ? 'interpretado' : 'avisado';
            const anormal = azar() < 0.14;
            e.resultado = anormal ? 'anormal' : 'normal';
            e.clasificacion = anormal ? `Bethesda: ${uno(BETHESDA_ANORMAL)}` : 'Bethesda: Negativa';
            if (anormal && e.etapa === 'avisado' && azar() < 0.5) e.etapa = 'interpretado';
          }
        } else {
          const r = azar();
          if (tipo === 'mastografia' && r < 0.15) e.etapa = 'en-laboratorio';
          else {
            e.etapa = azar() < 0.55 ? 'interpretado' : 'avisado';
            const anormal = azar() < 0.07;
            e.resultado = anormal ? 'anormal' : 'normal';
            if (anormal) e.etapa = azar() < 0.7 ? 'interpretado' : 'avisado';
          }
        }
        estudios.push(e);
        evento(fecha + 120000 + estudios.length * 1000, 'estudio', e.registradoPor, { pacienteId: p.id, estudioId: e.id });
      }
    }
  }
  bitacora.sort((a, b) => Date.parse(b.cuando) - Date.parse(a.cuando));

  const porId = new Map(pacientes.map((p) => [p.id, p]));
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const filtra = (q) => (p) => (!q.estado || norm(p.estado) === norm(q.estado)) && (!q.comunidad || norm(p.comunidad) === norm(q.comunidad));
  const enSeguimiento = (e) => e.resultado === 'anormal' && e.etapa !== 'avisado';
  const limiteDe = (e) => Date.parse(e.fecha + 'T00:00:00-06:00') + 15 * DIA;
  const pendientePatologia = (e) => e.tipo === 'papanicolaou' && (e.etapa === 'tomado' || e.etapa === 'en-laboratorio');

  function resumen(q) {
    const ps = pacientes.filter(filtra(q));
    const ids = new Set(ps.map((p) => p.id));
    const es = estudios.filter((e) => ids.has(e.pacienteId));
    const contar = (lista, campo, llaves) => Object.fromEntries(llaves.map((k) => [k, lista.filter((e) => e[campo] === k).length]));
    const agrupa = (llave) => {
      const m = new Map();
      for (const p of ps) {
        const k = llave(p);
        if (!m.has(k.id)) m.set(k.id, { ...k.datos, personas: 0, estudios: 0, anormales: 0, pendientesPatologia: 0 });
        m.get(k.id).personas++;
      }
      for (const e of es) {
        const fila = m.get(llave(porId.get(e.pacienteId)).id);
        fila.estudios++;
        if (e.resultado === 'anormal') fila.anormales++;
        if (pendientePatologia(e)) fila.pendientesPatologia++;
      }
      return [...m.values()].sort((a, b) => b.personas - a.personas);
    };
    return {
      corte: new Date().toISOString(),
      filtros: { estado: q.estado || null, comunidad: q.comunidad || null },
      personasUnicas: ps.length,
      visitas: visitas.filter((v) => ids.has(v.pacienteId)).length,
      estudios: {
        total: es.length,
        porTipo: contar(es, 'tipo', ['mastografia', 'ultrasonido', 'papanicolaou', 'exploracion']),
        porResultado: contar(es, 'resultado', ['normal', 'anormal', 'pendiente']),
        porEtapa: contar(es, 'etapa', ['tomado', 'en-laboratorio', 'interpretado', 'avisado']),
      },
      anormales: es.filter((e) => e.resultado === 'anormal').length,
      pendientesPatologia: es.filter(pendientePatologia).length,
      seguimientoVencido: es.filter((e) => enSeguimiento(e) && limiteDe(e) < Date.now()).length,
      duplicadosPendientes: 6,
      porEstado: agrupa((p) => ({ id: p.estado, datos: { estado: p.estado } })),
      porComunidad: agrupa((p) => ({ id: p.comunidad, datos: { comunidad: p.comunidad, estado: p.estado } })),
    };
  }

  function patologia(q) {
    return estudios
      .filter((e) => pendientePatologia(e) && filtra(q)(porId.get(e.pacienteId)))
      .map((e) => {
        const p = porId.get(e.pacienteId);
        return {
          estudio: { id: e.id, tipo: e.tipo, fecha: e.fecha, etapa: e.etapa },
          paciente: { id: p.id, folio: p.folio, nombre: p.nombre, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno, edad: p.edad, comunidad: p.comunidad },
          estado: p.estado,
          diasEsperando: Math.floor((Date.now() - Date.parse(e.fecha + 'T08:00:00-06:00')) / DIA),
        };
      })
      .sort((a, b) => b.diasEsperando - a.diasEsperando);
  }

  function seguimiento(q) {
    return estudios
      .filter((e) => enSeguimiento(e) && filtra(q)(porId.get(e.pacienteId)))
      .map((e) => {
        const p = porId.get(e.pacienteId);
        const limite = limiteDe(e);
        return {
          estudioId: e.id, tipo: e.tipo, fecha: e.fecha, motivo: e.clasificacion && e.clasificacion !== 'Bethesda: Negativa' ? 'Bethesda anormal' : 'resultado anormal',
          fechaLimite: new Date(limite).toISOString(), vencido: limite < Date.now(), diasRestantes: Math.ceil((limite - Date.now()) / DIA),
          paciente: { id: p.id, folio: p.folio, nombre: p.nombre, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno, comunidad: p.comunidad },
        };
      })
      .sort((a, b) => Date.parse(a.fechaLimite) - Date.parse(b.fechaLimite));
  }

  function interpretar(id, cuerpo) {
    const e = estudios.find((x) => x.id === id);
    if (!e) return { status: 404, datos: { error: 'no existe el estudio' } };
    if (e.etapa === 'interpretado' || e.etapa === 'avisado') return { status: 409, datos: { error: 'ya estaba interpretado' } };
    const resultado = cuerpo.clasificacion && cuerpo.clasificacion !== 'Negativa' ? 'anormal' : (cuerpo.resultado || 'normal');
    e.resultado = resultado;
    e.clasificacion = cuerpo.clasificacion ? `Bethesda: ${cuerpo.clasificacion}` : undefined;
    e.etapa = 'interpretado';
    bitacora.unshift({ id: `${Date.now()}-0`, cuando: new Date().toISOString(), tipo: 'interpretacion', autor: cuerpo.patologo || null, dispositivo: 'panel', pacienteId: e.pacienteId, estudioId: e.id });
    return { status: 200, datos: { ok: true, resultado, seguimiento: resultado === 'anormal' } };
  }

  function avisado(id, cuerpo) {
    const e = estudios.find((x) => x.id === id);
    if (!e || !enSeguimiento(e)) return { status: 404, datos: { error: 'no está en seguimiento' } };
    e.etapa = 'avisado';
    bitacora.unshift({ id: `${Date.now()}-0`, cuando: new Date().toISOString(), tipo: 'avisado', autor: (cuerpo && cuerpo.autor) || null, dispositivo: 'panel', pacienteId: e.pacienteId, estudioId: e.id });
    return { status: 200, datos: { ok: true } };
  }

  function paciente(id) {
    const p = porId.get(id);
    if (!p) return { status: 404, datos: { error: 'no existe' } };
    return { status: 200, datos: { ...p, estudios: estudios.filter((e) => e.pacienteId === id), visitas: visitas.filter((v) => v.pacienteId === id) } };
  }

  // Jornadas programadas (misma forma que GET/POST/DELETE /api/jornadas).
  const jornadas = [
    { comunidad: 'San Martín Peras', estado: 'Oaxaca', municipio: 'San Martín Peras, Oaxaca', fecha: '2026-11-25', equipo: ['Dra. Laura Méndez', 'Enf. Rosa Ortiz'], nota: null },
    { comunidad: 'Huejuquilla', estado: 'Jalisco', municipio: 'Huejuquilla el Alto, Jalisco', fecha: '2026-12-02', equipo: [], nota: null },
    { comunidad: 'Metlatónoc', estado: 'Guerrero', municipio: 'Metlatónoc, Guerrero', fecha: '2026-12-09', equipo: [], nota: null },
  ].map((j) => ({ id: uuid(), autor: 'Coordinación EIRA', creada: new Date(HOY - 2 * DIA).toISOString(), ...j }));
  const conConteos = (j) => {
    const ps = pacientes.filter((p) => norm(p.comunidad) === norm(j.comunidad));
    const ids = new Set(ps.map((p) => p.id));
    const pend = estudios.filter((e) => ids.has(e.pacienteId) && (e.etapa === 'en-laboratorio' || enSeguimiento(e))).length;
    return { ...j, pacientesPrevias: ps.length, estudiosPendientes: pend };
  };
  function listaJornadas(q) {
    const desde = Date.parse((q.desde || dia(Date.now())) + 'T00:00:00-06:00');
    const hasta = desde + (Number(q.dias) || 30) * DIA;
    return jornadas.filter((j) => { const t = Date.parse(j.fecha + 'T00:00:00-06:00'); return t >= desde && t < hasta; })
      .sort((a, b) => a.fecha.localeCompare(b.fecha)).map(conConteos);
  }
  function programar(c) {
    if (!c || !c.comunidad || !c.estado || !/^\d{4}-\d{2}-\d{2}$/.test(c.fecha || '') || !c.autor) return { status: 400, datos: { error: 'cuerpo inválido' } };
    const j = { id: uuid(), comunidad: c.comunidad, estado: c.estado, municipio: c.municipio || null, fecha: c.fecha, equipo: c.equipo || [], nota: c.nota || null, autor: c.autor, creada: new Date().toISOString() };
    jornadas.push(j);
    bitacora.unshift({ id: `${Date.now()}-0`, cuando: j.creada, tipo: 'jornada-programada', autor: c.autor, dispositivo: null, pacienteId: null, jornadaId: j.id, comunidad: j.comunidad });
    return { status: 201, datos: j };
  }
  function cancelar(id, q) {
    const i = jornadas.findIndex((j) => j.id === id);
    if (i < 0) return { status: 404, datos: { error: 'no existe' } };
    const [j] = jornadas.splice(i, 1);
    bitacora.unshift({ id: `${Date.now()}-0`, cuando: new Date().toISOString(), tipo: 'jornada-cancelada', autor: q.autor || 'coordinadora', dispositivo: null, pacienteId: null, jornadaId: id, comunidad: j.comunidad });
    return { status: 200, datos: { ok: true } };
  }

  // Enrutador con la misma forma que la API: (método, ruta con query, cuerpo) → { status, datos }.
  function responder(metodo, ruta, cuerpo) {
    const url = new URL(ruta, 'http://ejemplo');
    const q = Object.fromEntries(url.searchParams);
    const partes = url.pathname.replace(/^\/api\//, '').split('/').map(decodeURIComponent);
    if (metodo === 'GET' && partes[0] === 'resumen') return { status: 200, datos: resumen(q) };
    if (metodo === 'GET' && partes[0] === 'patologia') return { status: 200, datos: patologia(q) };
    if (metodo === 'GET' && partes[0] === 'seguimiento') return { status: 200, datos: seguimiento(q) };
    if (metodo === 'GET' && partes[0] === 'bitacora') return { status: 200, datos: bitacora.slice(0, Number(q.limite) || 50) };
    if (metodo === 'GET' && partes[0] === 'pacientes' && partes[1]) return paciente(partes[1]);
    if (metodo === 'GET' && partes[0] === 'jornadas') return { status: 200, datos: listaJornadas(q) };
    if (metodo === 'POST' && partes[0] === 'jornadas') return programar(cuerpo);
    if (metodo === 'DELETE' && partes[0] === 'jornadas' && partes[1]) return cancelar(partes[1], q);
    if (metodo === 'POST' && partes[0] === 'estudios' && partes[2] === 'interpretacion') return interpretar(partes[1], cuerpo || {});
    if (metodo === 'POST' && partes[0] === 'estudios' && partes[2] === 'avisado') return avisado(partes[1], cuerpo);
    if (metodo === 'POST' && partes[0] === 'seguimiento' && partes[2] === 'atendido') return avisado(partes[1], cuerpo);
    return { status: 404, datos: { error: 'sin datos de ejemplo para ' + url.pathname } };
  }

  window.DatosEjemplo = { responder };
})();
