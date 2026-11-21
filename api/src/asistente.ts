// Asistente de coordinación. Regla de oro: las cifras las calcula la API; el modelo
// de Apple (en la Mac, binario `asistente/`) solo redacta. Aquí todo es puro y se
// prueba sin Valkey: index.ts junta los datos y llama a armar().
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// --- Datos de entrada (los junta index.ts) ----------------------------------
export type EstudioA = { id: string; tipo: string; fecha: string; resultado?: string; clasificacion?: string; etapa?: string };
export type VisitaA = { fecha: string; comunidad?: string; estado?: string; jornada?: string };
export type PacienteA = {
  id: string; folio: string; nombre: string; apellidoPaterno: string; apellidoMaterno?: string;
  comunidad: string; estado: string; edad?: number; visitas: VisitaA[]; estudios: EstudioA[];
};
export type SeguimientoCrudo = { estudioId: string; pacienteId: string; tipo: string; fecha: string; motivo?: string; limite: number };
export type PatologiaCruda = { estudioId: string; pacienteId: string; desde: number };
export type BitacoraA = { cuando: string; tipo: string; autor?: string | null; pacienteId?: string | null; estudioId?: string | null; folio?: string | null; comunidad?: string | null };
export type JornadaA = { fecha: string; comunidad: string; estado: string; equipo?: string[] };

export type Fuente = {
  ahora: number;
  pacientes: PacienteA[];      // sin fusionadas
  seguimiento: SeguimientoCrudo[];
  patologia: PatologiaCruda[];
  bitacora: BitacoraA[];       // más nueva primero
  jornadas: JornadaA[];        // desde hoy, por fecha
};

// --- Utilidades ---------------------------------------------------------------
const DIA_MS = 24 * 60 * 60 * 1000;
const TZ = 'America/Mexico_City';
export const LIMITE_CONTEXTO = 6000;
export const clave = (s: string) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const aFecha = (iso: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00-06:00` : iso);
export const diaDe = (iso: string | number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(typeof iso === 'number' ? new Date(iso) : aFecha(iso));
const fechaTxt = (iso: string) => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }).format(aFecha(iso)).replace(/\./g, '').replace(/ de /g, ' ');
const horaTxt = (iso: string) => new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(iso));
const TIPO: Record<string, string> = { mastografia: 'mastografía', ultrasonido: 'ultrasonido', papanicolaou: 'papanicolaou', exploracion: 'exploración' };
const tipoTxt = (t: string) => TIPO[t] ?? t;
const nombreDe = (p: Pick<PacienteA, 'nombre' | 'apellidoPaterno' | 'apellidoMaterno'>) => [p.nombre, p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' ');
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
// «A», «A y B», «A, B y C»
export const enumerar = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
// «vencida» habla de la paciente; «vencido», del estudio.
const plazoTxt = (dias: number, o = 'a') => (dias < 0 ? `vencid${o} hace ${plural(-dias, 'día', 'días')}` : dias === 0 ? 'vence hoy' : `quedan ${plural(dias, 'día', 'días')}`);

// --- Filas ya calculadas (lo que ve el modelo y la tabla «Datos usados») -----
export type FilaSeguimiento = { folio: string; pacienteId: string; nombre: string; comunidad: string; estado: string; tipo: string; clasificacion: string | null; motivo: string; diasRestantes: number; vencido: boolean };
export type FilaPatologia = { folio: string; pacienteId: string; nombre: string; comunidad: string; estado: string; diasEsperando: number };
export type FilaBitacora = { cuando: string; tipo: string; autor: string; folio: string | null };
export type FilaJornada = { fecha: string; comunidad: string; estado: string; pacientesPrevias: number; estudiosPendientes: number };
export type Resumen = { personas: number; visitas: number; estudios: number; anormales: number; pendientesPatologia: number; enSeguimiento: number; seguimientoVencido: number };
export type LineaDeTiempo = {
  folio: string; nombre: string; comunidad: string; estado: string; edad: number | null;
  visitas: { fecha: string; comunidad: string; jornada: string | null }[];
  estudios: { tipo: string; fecha: string; resultado: string; clasificacion: string | null; etapa: string | null }[];
  seguimiento: { tipo: string; motivo: string; plazo: string }[];
  bitacora: FilaBitacora[];
};
export type Intencion = 'paciente' | 'seguimiento' | 'patologia' | 'hoy' | 'jornadas' | 'general';
export type Filtros = { comunidad?: string; estado?: string; tipo?: string; clasificacion?: string; soloVencidos?: boolean };

export type DatosUsados = {
  intencion: Intencion;
  filtros: Filtros;
  calculada: string | null;
  resumen: Resumen;
  seguimiento: FilaSeguimiento[];
  patologia: FilaPatologia[];
  jornadas: FilaJornada[];
  bitacora: FilaBitacora[];
  pacientes: LineaDeTiempo[];
  // A qué vista del panel lleva cada folio que aparece aquí.
  folios: Record<string, 'seguimiento' | 'patologia' | null>;
  caracteres: number;
};

// --- Leer la pregunta (sin modelo: reglas) -------------------------------------
const PALABRAS_COMUNES = new Set(('cuantas cuantos cuales quien quienes que paso pasa paciente pacientes mujeres senora senoras tiene tienen ' +
  'estan esta estudios estudio sobre todas todos para desde hasta hace dias resume resumen jornada jornadas papanicolaou papanicolaous ' +
  'mastografia ultrasonido exploracion seguimiento atender atendida atendidas vencida vencidas tiempo llevan lleva esperando patologo ' +
  'laboratorio anormal anormales birads bethesda comunidad estado proxima proximas programadas hola dime decir sabes hubo cual donde ' +
  'cuando como mucho mucha muchos muchas mas menos alguna alguno ninguna ninguno entre avisar avisada avisadas pendiente pendientes ' +
  'brigada brigadas registro registros ultima ultimo historia historial recorrido').split(' '));

export function interpretar(pregunta: string, f: Fuente, comunidadElegida?: string) {
  const q = clave(pregunta);
  const filtros: Filtros = {};
  // Comunidad: la elegida en el panel, o la que se nombre (la más larga gana).
  const comunidades = new Map<string, string>();
  for (const p of f.pacientes) if (!comunidades.has(clave(p.comunidad)) || /^\p{Lu}/u.test(p.comunidad)) comunidades.set(clave(p.comunidad), p.comunidad);
  for (const j of f.jornadas) if (!comunidades.has(clave(j.comunidad))) comunidades.set(clave(j.comunidad), j.comunidad);
  const nombrada = [...comunidades.keys()].filter((c) => c.length >= 4 && new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)).sort((a, b) => b.length - a.length)[0];
  if (comunidadElegida?.trim()) filtros.comunidad = comunidades.get(clave(comunidadElegida)) ?? comunidadElegida.trim();
  else if (nombrada) filtros.comunidad = comunidades.get(nombrada);
  const estados = [...new Set(f.pacientes.map((p) => p.estado).concat(f.jornadas.map((j) => j.estado)))].filter((e) => e && e !== 'Sin estado');
  const estado = estados.find((e) => new RegExp(`\\b${clave(e)}\\b`).test(q));
  if (estado && !filtros.comunidad) filtros.estado = estado;

  if (/mastograf/.test(q)) filtros.tipo = 'mastografia';
  else if (/ultrason/.test(q)) filtros.tipo = 'ultrasonido';
  else if (/papanicol|\bpap\b|citolog/.test(q)) filtros.tipo = 'papanicolaou';
  else if (/exploraci/.test(q)) filtros.tipo = 'exploracion';
  const birads = q.match(/bi-?\s?rads\s*:?\s*([0-6])/)?.[1];
  const bethesda = q.match(/\b(asc-?us|asc-?h|lsil|hsil|agc|carcinoma)\b/)?.[1];
  if (birads) filtros.clasificacion = `BI-RADS ${birads}`;
  else if (bethesda) filtros.clasificacion = bethesda.toUpperCase().replace(/^ASC-?/, 'ASC-');
  if (/vencid/.test(q)) filtros.soloVencidos = true;

  // Paciente: por folio o por nombre. Las palabras de la comunidad no cuentan como nombre.
  const ignorar = new Set([...(filtros.comunidad ? clave(filtros.comunidad).split(/\s+/) : []), ...(estado ? [clave(estado)] : [])]);
  const folios = new Set((q.match(/\b[a-z]{2,4}-[a-z0-9]{3,8}\b/g) ?? []).filter((x) => !/^(bi-rads|asc-us|asc-h)$/.test(x)));
  const palabras = q.split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !PALABRAS_COMUNES.has(w) && !ignorar.has(w));
  let mencionadas = f.pacientes.filter((p) => folios.has(clave(p.folio)));
  if (!mencionadas.length && palabras.length) {
    const puntos = f.pacientes.map((p) => {
      const suyas = new Set([...clave(p.nombre).split(/\s+/), clave(p.apellidoPaterno), clave(p.apellidoMaterno ?? '')].filter(Boolean));
      return { p, n: palabras.filter((w) => suyas.has(w)).length };
    }).filter((x) => x.n > 0);
    const mejor = Math.max(0, ...puntos.map((x) => x.n));
    mencionadas = puntos.filter((x) => x.n === mejor).map((x) => x.p);
  }

  let intencion: Intencion = 'general';
  const habla = (re: RegExp) => re.test(q);
  if (mencionadas.length && mencionadas.length <= 5) intencion = 'paciente';
  else if (filtros.clasificacion || habla(/seguimiento|sin atender|anormal|vencid|avisar|sin avisar/)) intencion = 'seguimiento';
  else if (habla(/patolog|laboratorio|esperando|interpretar|sin leer/) || (filtros.tipo === 'papanicolaou' && habla(/esper|tiempo|llevan|pendient/))) intencion = 'patologia';
  else if (habla(/\bhoy\b|resum|que paso|actividad/)) intencion = 'hoy';
  else if (habla(/proxim|programad|siguiente|jornadas|cuando (va|sale|vamos)/)) intencion = 'jornadas';
  return { intencion, filtros, mencionadas: mencionadas.slice(0, 3) };
}

// --- Calcular -------------------------------------------------------------------
function coincide(fl: Filtros, l: { comunidad: string; estado: string }) {
  return (!fl.comunidad || clave(fl.comunidad) === clave(l.comunidad)) && (!fl.estado || clave(fl.estado) === clave(l.estado));
}

export function calcular(f: Fuente, fl: Filtros) {
  const porId = new Map(f.pacientes.map((p) => [p.id, p]));
  const estudio = new Map<string, EstudioA>();
  for (const p of f.pacientes) for (const e of p.estudios) estudio.set(e.id, e);
  const lugar = { comunidad: fl.comunidad, estado: fl.estado };

  const seguimiento: FilaSeguimiento[] = [];
  for (const s of [...f.seguimiento].sort((a, b) => a.limite - b.limite)) {
    const p = porId.get(s.pacienteId);
    if (!p || !coincide(lugar, p)) continue;
    const dias = Math.ceil((s.limite - f.ahora) / DIA_MS);
    seguimiento.push({
      folio: p.folio, pacienteId: p.id, nombre: nombreDe(p), comunidad: p.comunidad, estado: p.estado,
      tipo: s.tipo, clasificacion: estudio.get(s.estudioId)?.clasificacion ?? null, motivo: s.motivo ?? 'resultado anormal',
      diasRestantes: dias, vencido: s.limite < f.ahora,
    });
  }
  const patologia: FilaPatologia[] = [];
  for (const x of [...f.patologia].sort((a, b) => a.desde - b.desde)) {
    const p = porId.get(x.pacienteId);
    if (!p || !coincide(lugar, p)) continue;
    patologia.push({ folio: p.folio, pacienteId: p.id, nombre: nombreDe(p), comunidad: p.comunidad, estado: p.estado, diasEsperando: Math.max(0, Math.floor((f.ahora - x.desde) / DIA_MS)) });
  }
  const dentro = f.pacientes.filter((p) => coincide(lugar, p));
  const resumen: Resumen = {
    personas: dentro.length,
    visitas: dentro.reduce((a, p) => a + p.visitas.length, 0),
    estudios: dentro.reduce((a, p) => a + p.estudios.length, 0),
    anormales: dentro.reduce((a, p) => a + p.estudios.filter((e) => e.resultado === 'anormal').length, 0),
    pendientesPatologia: patologia.length,
    enSeguimiento: seguimiento.length,
    seguimientoVencido: seguimiento.filter((s) => s.vencido).length,
  };
  const enSeg = new Set(f.seguimiento.map((s) => s.estudioId));
  const jornadas: FilaJornada[] = f.jornadas.filter((j) => coincide(lugar, j)).map((j) => {
    const ps = f.pacientes.filter((p) => clave(p.comunidad) === clave(j.comunidad));
    return {
      fecha: j.fecha, comunidad: j.comunidad, estado: j.estado, pacientesPrevias: ps.length,
      estudiosPendientes: ps.reduce((a, p) => a + p.estudios.filter((e) => e.etapa === 'en-laboratorio' || enSeg.has(e.id)).length, 0),
    };
  });
  const bitacora: FilaBitacora[] = f.bitacora
    .filter((b) => b.tipo !== 'consulta-asistente')
    .filter((b) => !fl.comunidad || (b.pacienteId ? (porId.get(b.pacienteId) && coincide(lugar, porId.get(b.pacienteId)!)) : (!b.comunidad || clave(b.comunidad) === clave(fl.comunidad))))
    .slice(0, 40)
    .map((b) => ({ cuando: b.cuando, tipo: b.tipo, autor: b.autor || 'sin registro', folio: b.folio ?? null }));
  return { seguimiento, patologia, resumen, jornadas, bitacora };
}

export function lineaDeTiempo(p: PacienteA, f: Fuente): LineaDeTiempo {
  const porEstudio = new Map(p.estudios.map((e) => [e.id, e]));
  return {
    folio: p.folio, nombre: nombreDe(p), comunidad: p.comunidad, estado: p.estado, edad: p.edad ?? null,
    visitas: [...p.visitas].sort((a, b) => aFecha(a.fecha).getTime() - aFecha(b.fecha).getTime()).map((v) => ({ fecha: v.fecha, comunidad: v.comunidad ?? p.comunidad, jornada: v.jornada ?? null })),
    estudios: [...p.estudios].sort((a, b) => aFecha(a.fecha).getTime() - aFecha(b.fecha).getTime()).map((e) => ({ tipo: e.tipo, fecha: e.fecha, resultado: e.resultado ?? 'pendiente', clasificacion: e.clasificacion ?? null, etapa: e.etapa ?? null })),
    seguimiento: f.seguimiento.filter((s) => s.pacienteId === p.id).sort((a, b) => a.limite - b.limite).map((s) => ({
      tipo: s.tipo, motivo: porEstudio.get(s.estudioId)?.clasificacion ?? s.motivo ?? 'resultado anormal', plazo: plazoTxt(Math.ceil((s.limite - f.ahora) / DIA_MS), 'o'),
    })),
    bitacora: f.bitacora.filter((b) => b.pacienteId === p.id && b.tipo !== 'consulta-asistente').slice(0, 8)
      .map((b) => ({ cuando: b.cuando, tipo: b.tipo, autor: b.autor || 'sin registro', folio: b.folio ?? null })),
  };
}

// --- Redactar sin modelo (también es la RESPUESTA CALCULADA que recibe el modelo) ---
const QUE: Record<string, [string, string]> = {
  alta: ['dio de alta a 1 paciente', 'dio de alta a {n} pacientes'],
  visita: ['registró 1 visita', 'registró {n} visitas'],
  estudio: ['registró 1 estudio', 'registró {n} estudios'],
  actualizacion: ['corrigió datos 1 vez', 'corrigió datos {n} veces'],
  conflicto: ['envió 1 cambio en conflicto', 'envió {n} cambios en conflicto'],
  'conflicto-aceptar': ['aceptó 1 cambio en conflicto', 'aceptó {n} cambios en conflicto'],
  'conflicto-rechazar': ['rechazó 1 cambio en conflicto', 'rechazó {n} cambios en conflicto'],
  'duplicado-unir': ['unió 1 par de fichas duplicadas', 'unió {n} pares de fichas duplicadas'],
  'duplicado-separar': ['separó 1 par de fichas', 'separó {n} pares de fichas'],
  'seguimiento-atendido': ['marcó 1 paciente como avisada', 'marcó {n} pacientes como avisadas'],
  avisado: ['marcó 1 paciente como avisada', 'marcó {n} pacientes como avisadas'],
  interpretacion: ['interpretó 1 papanicolaou', 'interpretó {n} papanicolaous'],
  'jornada-programada': ['programó 1 jornada', 'programó {n} jornadas'],
  'jornada-cancelada': ['canceló 1 jornada', 'canceló {n} jornadas'],
};
const quien = (autor: string) => (/^ios-/.test(autor) ? `el teléfono ${autor}` : autor);

function describirFiltro(fl: Filtros) {
  return [fl.comunidad ? `de ${fl.comunidad}` : fl.estado ? `de ${fl.estado}` : '', fl.clasificacion ? `con ${fl.clasificacion}` : fl.tipo ? `con ${tipoTxt(fl.tipo)}` : ''].filter(Boolean).join(' ');
}

function textoSeguimiento(filas: FilaSeguimiento[], fl: Filtros) {
  const filtradas = filas.filter((s) =>
    (!fl.soloVencidos || s.vencido) &&
    (!fl.tipo || s.tipo === fl.tipo) &&
    (!fl.clasificacion || clave(`${s.clasificacion ?? ''} ${s.motivo}`).replace(/\s+/g, ' ').includes(clave(fl.clasificacion))));
  // Una línea por paciente, con su plazo más urgente (las filas ya vienen por límite).
  const porPaciente = new Map<string, FilaSeguimiento>();
  for (const s of filtradas) if (!porPaciente.has(s.pacienteId)) porPaciente.set(s.pacienteId, s);
  const ps = [...porPaciente.values()];
  const desc = describirFiltro(fl);
  const sujeto = `${plural(ps.length, 'paciente', 'pacientes')}${desc ? ' ' + desc : ''}`;
  const que = fl.soloVencidos ? 'con seguimiento vencido' : 'sin atender en seguimiento';
  if (!ps.length) return `0 pacientes${desc ? ' ' + desc : ''} ${que}.`;
  const vencidas = ps.filter((s) => s.vencido).length;
  const cuenta = fl.soloVencidos || !vencidas ? '' : ` (${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'})`;
  const lista = ps.slice(0, 8).map((s) => `${s.folio} (${plazoTxt(s.diasRestantes)})`);
  const resto = ps.length - lista.length;
  return `${sujeto} ${que}${cuenta}: ${enumerar(resto > 0 ? [...lista, `${resto} más`] : lista)}.`;
}

function textoPatologia(filas: FilaPatologia[], fl: Filtros) {
  const desc = fl.comunidad ? ` de ${fl.comunidad}` : fl.estado ? ` de ${fl.estado}` : '';
  if (!filas.length) return `0 papanicolaous${desc} esperan al patólogo.`;
  const grupos = new Map<number, string[]>();
  for (const x of [...filas].sort((a, b) => b.diasEsperando - a.diasEsperando)) grupos.set(x.diasEsperando, [...(grupos.get(x.diasEsperando) ?? []), x.folio]);
  const [primero, segundo] = [...grupos.entries()];
  const dias = (d: number) => plural(d, 'día', 'días');
  let t = `${plural(filas.length, 'papanicolaou espera', 'papanicolaous esperan')} al patólogo${desc}. ${primero[1].length === 1 ? 'El que más espera es' : 'Los que más esperan son'} ${enumerar(primero[1])}, con ${dias(primero[0])}`;
  if (segundo) t += `; ${segundo[1].length === 1 ? 'le sigue' : 'les siguen'} ${enumerar(segundo[1])}, con ${dias(segundo[0])}`;
  return t + '.';
}

function textoHoy(f: Fuente, c: ReturnType<typeof calcular>, fl: Filtros) {
  const hoy = diaDe(f.ahora);
  const porId = new Map(f.pacientes.map((p) => [p.id, p]));
  const deHoy = f.bitacora.filter((b) => b.tipo !== 'consulta-asistente' && diaDe(b.cuando) === hoy)
    .filter((b) => !fl.comunidad || (b.pacienteId && porId.get(b.pacienteId) && clave(porId.get(b.pacienteId)!.comunidad) === clave(fl.comunidad)) || (b.comunidad && clave(b.comunidad) === clave(fl.comunidad)));
  const pend = c.resumen.pendientesPatologia;
  const cola = `Quedan ${plural(pend, 'papanicolaou', 'papanicolaous')} esperando al patólogo.`;
  if (!deHoy.length) return `Hoy no hay movimientos en la bitácora${fl.comunidad ? ` de ${fl.comunidad}` : ''}. ${cola}`;
  const porAutor = new Map<string, Map<string, number>>();
  for (const b of deHoy) {
    const a = b.autor || 'sin registro';
    const m = porAutor.get(a) ?? new Map<string, number>();
    m.set(b.tipo, (m.get(b.tipo) ?? 0) + 1);
    porAutor.set(a, m);
  }
  // La bitácora viene de la más nueva a la más vieja: quien actuó más reciente va primero.
  const autores = [...porAutor.entries()].slice(0, 2);
  const frases = autores.map(([a, m]) => {
    const todos = [...m.entries()].filter(([t]) => QUE[t]).map(([t, n]) => (n === 1 ? QUE[t][0] : QUE[t][1].replace('{n}', String(n))));
    // «registró 2 estudios y 2 visitas» en vez de repetir el verbo.
    const registros = todos.filter((x) => x.startsWith('registró ')).map((x) => x.slice('registró '.length));
    const hechos = [...(registros.length ? [`registró ${enumerar(registros)}`] : []), ...todos.filter((x) => !x.startsWith('registró '))];
    return hechos.length ? `${quien(a)} ${enumerar(hechos)}` : '';
  }).filter(Boolean);
  // Estudios registrados o interpretados hoy que quedaron en seguimiento.
  const idsHoy = new Set(f.bitacora.filter((b) => diaDe(b.cuando) === hoy && (b.tipo === 'estudio' || b.tipo === 'interpretacion')).map((b) => b.estudioId).filter(Boolean));
  const nuevos = f.seguimiento.filter((s) => idsHoy.has(s.estudioId) && (!fl.comunidad || clave(porId.get(s.pacienteId)?.comunidad ?? '') === clave(fl.comunidad))).length;
  const seg = nuevos ? `${plural(nuevos, 'estudio anormal entró', 'estudios anormales entraron')} a seguimiento.` : '';
  return [frases.length ? `Hoy: ${frases.join('; ')}.` : '', seg, cola].filter(Boolean).join(' ');
}

function textoPaciente(ls: LineaDeTiempo[]) {
  if (ls.length > 1) return `Coinciden ${ls.length} pacientes: ${enumerar(ls.map((l) => `${l.folio} (${l.nombre}, ${l.comunidad})`))}.`;
  const l = ls[0];
  const ultimaV = l.visitas[l.visitas.length - 1];
  const partes = [`${l.nombre} (${l.folio}, ${l.comunidad}) tiene ${plural(l.visitas.length, 'visita', 'visitas')}${ultimaV ? `, la última el ${fechaTxt(ultimaV.fecha)}` : ''}, y ${plural(l.estudios.length, 'estudio', 'estudios')}.`];
  const ultimoE = l.estudios[l.estudios.length - 1];
  if (ultimoE) partes.push(`El más reciente es ${tipoTxt(ultimoE.tipo)} del ${fechaTxt(ultimoE.fecha)}, ${ultimoE.etapa === 'en-laboratorio' ? 'en laboratorio' : ultimoE.resultado}${ultimoE.clasificacion ? ` (${ultimoE.clasificacion})` : ''}.`);
  const vencidos = l.seguimiento.filter((s) => s.plazo.startsWith('vencido')).length;
  partes.push(l.seguimiento.length ? `Tiene ${plural(l.seguimiento.length, 'estudio', 'estudios')} en seguimiento sin atender${vencidos ? `, ${vencidos} ${vencidos === 1 ? 'vencido' : 'vencidos'}` : ''}.` : 'No tiene estudios en seguimiento.');
  return partes.join(' ');
}

function textoJornadas(js: FilaJornada[]) {
  if (!js.length) return 'No hay jornadas programadas en los próximos 30 días.';
  const t = js.slice(0, 3).map((j) => `${j.comunidad} (${j.estado}) el ${fechaTxt(j.fecha)}, con ${plural(j.pacientesPrevias, 'paciente', 'pacientes')} con expediente y ${plural(j.estudiosPendientes, 'estudio pendiente', 'estudios pendientes')}`);
  return `${js.length === 1 ? 'Próxima jornada' : 'Próximas jornadas'}: ${t.join('; ')}.`;
}

function textoResumen(r: Resumen, fl: Filtros) {
  const desc = fl.comunidad ? ` en ${fl.comunidad}` : fl.estado ? ` en ${fl.estado}` : '';
  return `${plural(r.personas, 'persona', 'personas')}${desc}, ${plural(r.estudios, 'estudio', 'estudios')} y ${plural(r.anormales, 'anormal', 'anormales')}. ${plural(r.pendientesPatologia, 'papanicolaou espera', 'papanicolaous esperan')} al patólogo y ${plural(r.seguimientoVencido, 'seguimiento está vencido', 'seguimientos están vencidos')}.`;
}

// --- Contexto compacto para el modelo -------------------------------------------
function contextoTexto(f: Fuente, d: Omit<DatosUsados, 'caracteres' | 'folios'>): string {
  const hoy = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(new Date(f.ahora));
  const filtro = describirFiltro({ comunidad: d.filtros.comunidad, estado: d.filtros.estado });
  const r = d.resumen;
  // Secciones en orden de prioridad: si no cabe, se recorta desde el final.
  const fijas: string[] = [`Hoy es ${hoy}, hora de la CDMX.${filtro ? ` Datos solo ${filtro}.` : ''}`];
  fijas.push(`RESUMEN: ${r.personas} personas, ${r.visitas} visitas, ${r.estudios} estudios, ${r.anormales} anormales, ${r.pendientesPatologia} papanicolaous esperando al patólogo, ${r.enSeguimiento} estudios en seguimiento sin atender (${r.seguimientoVencido} vencidos).`);
  for (const l of d.pacientes) {
    fijas.push([
      `PACIENTE ${l.folio}: ${l.nombre}, ${l.comunidad} (${l.estado})${l.edad != null ? `, ${l.edad} años` : ''}.`,
      `Visitas: ${l.visitas.map((v) => `${fechaTxt(v.fecha)} en ${v.comunidad}${v.jornada ? ` (${v.jornada})` : ''}`).join('; ') || 'ninguna'}.`,
      `Estudios: ${l.estudios.map((e) => `${tipoTxt(e.tipo)} ${fechaTxt(e.fecha)}, resultado ${e.resultado}${e.clasificacion ? `, ${e.clasificacion}` : ''}${e.etapa ? `, etapa ${e.etapa}` : ''}`).join('; ') || 'ninguno'}.`,
      `Seguimiento: ${l.seguimiento.map((s) => `${tipoTxt(s.tipo)} por ${s.motivo}, ${s.plazo}`).join('; ') || 'nada pendiente'}.`,
      `Bitácora de ella: ${l.bitacora.map((b) => `${fechaTxt(b.cuando)} ${horaTxt(b.cuando)} ${b.tipo} por ${b.autor}`).join('; ') || 'sin movimientos'}.`,
    ].join('\n'));
  }
  const listas: [string, string[]][] = [
    ['SEGUIMIENTO SIN ATENDER (folio | estudio | clasificación | plazo | comunidad):',
      d.seguimiento.map((s) => `${s.folio} | ${tipoTxt(s.tipo)} | ${s.clasificacion ?? s.motivo} | ${plazoTxt(s.diasRestantes, 'o')} | ${s.comunidad}`)],
    ['PAPANICOLAOUS ESPERANDO AL PATÓLOGO (folio | días esperando | comunidad):',
      d.patologia.map((x) => `${x.folio} | ${x.diasEsperando} | ${x.comunidad}`)],
    ['JORNADAS PROGRAMADAS (fecha | comunidad | estado | pacientes con expediente | estudios pendientes):',
      d.jornadas.map((j) => `${fechaTxt(j.fecha)} | ${j.comunidad} | ${j.estado} | ${j.pacientesPrevias} | ${j.estudiosPendientes}`)],
    ['BITÁCORA, MÁS NUEVA PRIMERO (cuándo | qué | quién | folio):',
      d.bitacora.map((b) => `${fechaTxt(b.cuando)} ${horaTxt(b.cuando)} | ${b.tipo} | ${b.autor} | ${b.folio ?? '-'}`)],
  ];
  // La RESPUESTA CALCULADA va al final, junto a la pregunta: el modelo chico le hace más caso ahí.
  const final = d.calculada ? [`RESPUESTA CALCULADA: ${d.calculada}`] : [];
  const armar = () => [...fijas, ...listas.map(([t, xs]) => `${t}\n${xs.length ? xs.join('\n') : '(ninguno)'}`), ...final].join('\n\n');
  let texto = armar();
  // Recorta primero la bitácora, luego jornadas, patología y seguimiento.
  for (let i = listas.length - 1; i >= 0 && texto.length > LIMITE_CONTEXTO; i--) {
    while (listas[i][1].length && texto.length > LIMITE_CONTEXTO) { listas[i][1].pop(); texto = armar(); }
  }
  return texto.length > LIMITE_CONTEXTO ? texto.slice(0, LIMITE_CONTEXTO) : texto;
}

export type Armado = { contexto: string; datos: DatosUsados; sinModelo: string };

export function armar(pregunta: string, f: Fuente, comunidad?: string): Armado {
  const { intencion, filtros, mencionadas } = interpretar(pregunta, f, comunidad);
  const c = calcular(f, filtros);
  const pacientes = intencion === 'paciente' ? mencionadas.map((p) => lineaDeTiempo(p, f)) : [];
  let calculada: string | null = null;
  if (intencion === 'seguimiento') calculada = textoSeguimiento(c.seguimiento, filtros);
  else if (intencion === 'patologia') calculada = textoPatologia(c.patologia, filtros);
  else if (intencion === 'hoy') calculada = textoHoy(f, c, filtros);
  else if (intencion === 'paciente') calculada = textoPaciente(pacientes);
  else if (intencion === 'jornadas') calculada = textoJornadas(c.jornadas);
  const base = { intencion, filtros, calculada, ...c, pacientes };
  const contexto = contextoTexto(f, base);
  const folios: DatosUsados['folios'] = {};
  for (const x of c.patologia) folios[x.folio] = 'patologia';
  for (const s of c.seguimiento) if (!(s.folio in folios) || intencion !== 'patologia') folios[s.folio] = 'seguimiento';
  for (const l of pacientes) if (!(l.folio in folios)) folios[l.folio] = null;
  for (const b of c.bitacora) if (b.folio && !(b.folio in folios)) folios[b.folio] = null;
  return { contexto, datos: { ...base, folios, caracteres: contexto.length }, sinModelo: calculada ?? textoResumen(c.resumen, filtros) };
}

// --- Revisar lo que redactó el modelo ------------------------------------------
// Si escribe un folio o un número que no está en el contexto, no se usa.
const NO_FOLIO = /^(BI-RADS|ASC-US|ASC-H)$/i;
export function revisar(respuesta: string, contexto: string): { ok: boolean; motivo?: string } {
  // Copió un renglón de tabla en vez de redactar.
  if (respuesta.includes('|')) return { ok: false, motivo: 'copió una tabla' };
  // Folio = mayúsculas y números con guion (JUX-007, ER-9NLRAS). Los autores («enf-hue») no cuentan.
  const ctx = contexto.toUpperCase();
  const foliosResp = (respuesta.match(/\b[A-Z]{2,4}-[A-Z0-9]{3,8}\b/g) ?? []).filter((x) => !NO_FOLIO.test(x));
  for (const fo of foliosResp) if (!new RegExp(`\\b${fo}\\b`).test(ctx)) return { ok: false, motivo: `folio ${fo}` };
  const sinFolios = (t: string) => t.replace(/\b[A-Za-z]{2,4}-[A-Za-z0-9]{3,8}\b/g, ' ');
  const numsCtx = new Set(sinFolios(contexto).match(/\d+/g) ?? []);
  for (const n of sinFolios(respuesta).match(/\d+/g) ?? []) if (!numsCtx.has(n)) return { ok: false, motivo: `número ${n}` };
  return { ok: true };
}

// --- Binario de Apple -------------------------------------------------------------
export type ResultadoModelo = { ok: true; respuesta: string; ms: number } | { ok: false; codigo: number | null; error: string; ms: number };
let cola: Promise<unknown> = Promise.resolve();

// Una llamada a la vez: el modelo del sistema rechaza peticiones simultáneas.
export function llamarModelo(bin: string, entrada: object, timeoutMs = 45_000): Promise<ResultadoModelo> {
  const tarea = cola.then(() => correr(bin, entrada, timeoutMs));
  cola = tarea.catch(() => undefined);
  return tarea;
}

function correr(bin: string, entrada: object, timeoutMs: number): Promise<ResultadoModelo> {
  const t0 = Date.now();
  if (!existsSync(bin)) return Promise.resolve({ ok: false, codigo: null, error: 'sin binario', ms: 0 });
  return new Promise((listo) => {
    const hijo = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', fin = false;
    const terminar = (r: ResultadoModelo) => { if (!fin) { fin = true; clearTimeout(reloj); listo(r); } };
    const reloj = setTimeout(() => { hijo.kill('SIGKILL'); terminar({ ok: false, codigo: null, error: 'tiempo agotado', ms: Date.now() - t0 }); }, timeoutMs);
    hijo.stdout.on('data', (d) => { out += d; });
    hijo.stderr.on('data', (d) => { err += d; });
    hijo.on('error', (e) => terminar({ ok: false, codigo: null, error: e.message, ms: Date.now() - t0 }));
    hijo.on('close', (codigo) => {
      if (codigo === 0) {
        try {
          const r = JSON.parse(out) as { respuesta?: string };
          if (r.respuesta?.trim()) return terminar({ ok: true, respuesta: r.respuesta.trim(), ms: Date.now() - t0 });
        } catch { /* cae abajo */ }
        return terminar({ ok: false, codigo, error: 'salida inválida', ms: Date.now() - t0 });
      }
      let error = err.trim();
      try { error = (JSON.parse(err) as { error: string }).error; } catch { /* texto */ }
      terminar({ ok: false, codigo, error: error || `código ${codigo}`, ms: Date.now() - t0 });
    });
    hijo.stdin.on('error', () => { /* el proceso pudo salir antes de leer */ });
    hijo.stdin.end(JSON.stringify(entrada));
  });
}
