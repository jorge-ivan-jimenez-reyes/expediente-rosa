import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import Valkey from 'iovalkey';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { comparar, llavesBloque, normalizar, UMBRAL_POSIBLE, type DatosPaciente } from './coincidencias';
import { cifrar, descifrar, cifradoActivo } from './cifrado';
import { guardarVector, hayModuloSearch, crearIndice, knn, llaveVector } from './busqueda';

export const valkey = new Valkey(process.env.VALKEY_URL ?? 'redis://localhost:6379');

// --- Esquemas ---------------------------------------------------------------
// Datos mínimos: lo justo para reconocer a la paciente y seguir sus estudios.
const Paciente = z.object({
  id: z.string().min(8),
  folio: z.string(),
  nombre: z.string().min(1),
  apellidoPaterno: z.string().min(1),
  apellidoMaterno: z.string().optional(),
  nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  edad: z.number().int().min(0).max(120).optional(),
  comunidad: z.string().min(1),
  municipio: z.string().optional(),
  consentimiento: z.string(), // fecha ISO en que la paciente aceptó
  creadaPor: z.string(),
  creada: z.string(),
  // Reto 1 (formato oficial de EIRA): opcionales.
  entidadNacimiento: z.string().min(1).optional(),
  idEira: z.string().min(1).optional(),
});
const Estudio = z.object({
  id: z.string(),
  pacienteId: z.string(),
  tipo: z.enum(['mastografia', 'ultrasonido', 'papanicolaou', 'exploracion']),
  fecha: z.string(),
  resultado: z.enum(['pendiente', 'normal', 'anormal']).default('pendiente'),
  nota: z.string().max(500).optional(),
  registradoPor: z.string(),
  // Reto 1: opcionales. clasificacion es texto libre («BI-RADS 4», «Bethesda: LSIL»).
  visitaId: z.string().optional(),
  clasificacion: z.string().max(100).optional(),
  conducta: z.enum(['rutina-1-anio', 'mastografia-tamizaje', 'imagen-complementaria', 'evaluacion-6-meses', 'referencia']).optional(),
  // Brigada: en qué paso va el estudio. Si no viene, se deduce (ver etapaDe).
  etapa: z.enum(['tomado', 'en-laboratorio', 'interpretado', 'avisado']).optional(),
});
const fechaISO = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'fecha ISO inválida');
const Visita = z.object({
  id: z.string().min(1),
  pacienteId: z.string(),
  fecha: fechaISO,
  comunidad: z.string().min(1),
  motivo: z.string().max(200).optional(),
  registradaPor: z.string(),
  // Brigada: entidad federativa de la jornada («Jalisco») y nombre de la jornada.
  estado: z.string().min(1).max(60).optional(),
  jornada: z.string().min(1).max(120).optional(),
});
// Campos de la paciente que se pueden corregir después del alta (no id, folio ni consentimiento).
const CamposEditables = Paciente.pick({
  nombre: true, apellidoPaterno: true, apellidoMaterno: true, nacimiento: true, edad: true,
  comunidad: true, municipio: true, entidadNacimiento: true, idEira: true,
}).partial().refine((o) => Object.values(o).some((v) => v !== undefined), 'campos vacío');
const Actualizacion = z.object({
  pacienteId: z.string(),
  campos: CamposEditables,
  versionBase: z.number().int().min(1),
  autor: z.string(),
});
const Evento = z.discriminatedUnion('tipo', [
  z.object({ llave: z.string(), tipo: z.literal('alta'), paciente: Paciente }),
  z.object({ llave: z.string(), tipo: z.literal('estudio'), estudio: Estudio }),
  z.object({ llave: z.string(), tipo: z.literal('visita'), visita: Visita }),
  z.object({ llave: z.string(), tipo: z.literal('actualizacion'), actualizacion: Actualizacion }),
]);
const Sync = z.object({ dispositivo: z.string(), eventos: z.array(Evento).max(500) });
type TPaciente = z.infer<typeof Paciente>;
type TEstudio = z.infer<typeof Estudio>;
type TVisita = z.infer<typeof Visita>;
type TActualizacion = z.infer<typeof Actualizacion>;
type TCampos = z.infer<typeof CamposEditables>;
type TEtapa = NonNullable<TEstudio['etapa']>;
// Lo que el servidor agrega al estudio después (patología y aviso); el teléfono no lo manda.
type TEstudioGuardado = TEstudio & {
  interpretadoPor?: string; interpretadoEn?: string; cedula?: string; avisadoPor?: string; avisadoEn?: string;
};

// --- Llaves de Valkey (un solo lugar) ---------------------------------------
const norm = (c: string) => c.toLowerCase().trim();
const K = {
  paciente: (id: string) => `paciente:${id}`,
  estudios: (id: string) => `paciente:${id}:estudios`,
  todas: 'pacientes',
  comunidad: (c: string) => `pacientes:comunidad:${norm(c)}`,
  bloque: (b: string) => `bloque:${b}`,
  envio: (llave: string) => `sync:envio:${llave}`,
  duplicados: 'duplicados',
  par: (a: string, b: string) => `duplicado:${[a, b].sort().join('|')}`,
  distintas: (id: string) => `distintas:${id}`,
  eventos: 'eventos',
  // C1: estudios anormales por atender, ordenados por fecha límite (score = epoch ms).
  seguimiento: 'seguimiento',
  segEstudio: (estudioId: string) => `seguimiento:estudio:${estudioId}`,
  // C2: contadores del día por comunidad (hash) y canal pub/sub del tablero.
  jornada: (c: string, dia: string) => `jornada:${norm(c)}:${dia}`,
  canal: (c: string) => `canal:jornada:${norm(c)}`,
  // Reto 1: visitas (hash por id + sorted set por paciente, score = fecha) y conflictos.
  visita: (id: string) => `visita:${id}`,
  visitas: (pacienteId: string) => `paciente:${pacienteId}:visitas`,
  conflicto: (id: string) => `conflicto:${id}`,
  conflictos: 'conflictos',
  // Brigada: papanicolaous esperando al patólogo (score = fecha de toma, epoch ms)
  // y a qué paciente pertenece cada estudio (hash estudioId → pacienteId).
  patologia: 'patologia:pendientes',
  estudioPaciente: 'estudios:paciente',
};

export const DIAS_SEGUIMIENTO = 15;
const DIA_MS = 24 * 60 * 60 * 1000;
const fechaMs = (f: string) => { const t = Date.parse(f); return Number.isNaN(t) ? Date.now() : t; };
const chunk2 = (xs: string[]) => Array.from({ length: xs.length / 2 }, (_, i) => [xs[2 * i], xs[2 * i + 1]] as const);
// Las jornadas son en México: el «día» se corta a medianoche de la CDMX.
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

// --- Lectura / escritura (aquí se cifra y descifra, C3) ---------------------
async function leerPaciente(id: string): Promise<TPaciente | null> {
  const h = await valkey.hgetall(K.paciente(id));
  if (!h.id) return null;
  if (h.consentimiento) h.consentimiento = descifrar(h.consentimiento);
  // version: las pacientes dadas de alta antes del Reto 1 no la tienen; cuentan como 1.
  return { ...h, edad: h.edad ? Number(h.edad) : undefined, version: Number(h.version ?? 1) } as unknown as TPaciente & { version: number };
}

const serializarEstudio = (e: TEstudio) => JSON.stringify(e.nota ? { ...e, nota: cifrar(e.nota) } : e);
function leerEstudio(s: string): TEstudioGuardado {
  const e = conEtapa(JSON.parse(s) as TEstudioGuardado);
  return e.nota ? { ...e, nota: descifrar(e.nota) } : e;
}

// Brigada: el papanicolaou se toma en campo y lo interpreta un patólogo después.
// Si el estudio no trae etapa (teléfonos viejos o datos de antes), se deduce al leer.
export function etapaDe(e: Pick<TEstudio, 'tipo' | 'resultado' | 'etapa'>): TEtapa {
  if (e.etapa) return e.etapa;
  if (e.resultado === 'normal' || e.resultado === 'anormal') return 'interpretado';
  return e.tipo === 'papanicolaou' ? 'en-laboratorio' : 'tomado';
}
const conEtapa = <T extends TEstudio>(e: T): T => (e.etapa ? e : { ...e, etapa: etapaDe(e) });
const leerEstudios = async (id: string) => (await valkey.lrange(K.estudios(id), 0, -1)).map(leerEstudio);

async function leerVisitas(pacienteId: string): Promise<TVisita[]> {
  const ids = await valkey.zrange(K.visitas(pacienteId), 0, -1);
  if (!ids.length) return [];
  const p = valkey.pipeline();
  for (const id of ids) p.hgetall(K.visita(id));
  const filas = (await p.exec()) ?? [];
  return filas.map(([, h]) => h as Record<string, string>).filter((h) => h?.id) as unknown as TVisita[];
}

// --- Bitácora (stream `eventos`) -------------------------------------------
// Solo quién, qué, cuándo y de quién: nunca resultados, clasificaciones ni notas.
async function bitacora(campos: Record<string, string | number | undefined>) {
  const plano = Object.entries(campos).filter(([, v]) => v !== undefined && v !== '').flatMap(([k, v]) => [k, String(v)]);
  await valkey.xadd(K.eventos, 'MAXLEN', '~', '10000', '*', ...plano);
}

// --- Tablero en vivo (C2): contar y avisar por pub/sub ----------------------
async function avisarJornada(comunidad: string, evento: Record<string, unknown>, incrementos: Record<string, number>) {
  const llave = K.jornada(comunidad, hoy());
  const m = valkey.multi();
  for (const [campo, n] of Object.entries(incrementos)) m.hincrby(llave, campo, n);
  await m.expire(llave, 60 * 60 * 24 * 7).exec();
  const conteo = await leerConteo(comunidad);
  await valkey.publish(K.canal(comunidad), JSON.stringify({ ...evento, conteo }));
}

async function leerConteo(comunidad: string, dia = hoy()) {
  const h = await valkey.hgetall(K.jornada(comunidad, dia));
  const n = (k: string) => Number(h[k] ?? 0);
  return {
    comunidad: norm(comunidad), dia,
    altas: n('altas'),
    estudios: n('estudios'),
    porTipo: { mastografia: n('tipo:mastografia'), ultrasonido: n('tipo:ultrasonido'), papanicolaou: n('tipo:papanicolaou'), exploracion: n('tipo:exploracion') },
    anormales: n('anormales'),
    duplicados: n('duplicados'),
  };
}

// Un solo cliente suscriptor para todo el proceso; cada SSE se cuelga de él.
let suscriptor: Valkey | null = null;
const oyentes = new Map<string, Set<(msg: string) => void>>();
async function escuchar(canal: string, fn: (msg: string) => void) {
  if (!suscriptor) {
    suscriptor = valkey.duplicate();
    suscriptor.on('message', (ch: string, msg: string) => oyentes.get(ch)?.forEach((f) => f(msg)));
  }
  let set = oyentes.get(canal);
  if (!set) { set = new Set(); oyentes.set(canal, set); await suscriptor.subscribe(canal); }
  set.add(fn);
  return async () => {
    set!.delete(fn);
    if (!set!.size) { oyentes.delete(canal); await suscriptor?.unsubscribe(canal); }
  };
}

// --- Seguimiento de anormales (C1) ------------------------------------------
// Reto 1, formato de EIRA: cuándo un estudio entra a seguimiento y con qué plazo.
//   resultado anormal, BI-RADS 4/5, Bethesda anormal o conducta «referencia» → 15 días
//   BI-RADS 3 o conducta «evaluacion-6-meses» → 6 meses
export function reglaSeguimiento(e: Pick<TEstudio, 'resultado' | 'clasificacion' | 'conducta'>): { plazo: '15-dias' | '6-meses'; motivo: string } | null {
  const c = e.clasificacion ?? '';
  const birads = c.match(/bi-?rads\s*:?\s*([0-6])/i)?.[1];
  const bethesdaAnormal = /bethesda/i.test(c) && /\b(asc-?us|asc-?h|lsil|hsil|agc|carcinoma)\b/i.test(c);
  if (birads === '4' || birads === '5') return { plazo: '15-dias', motivo: `BI-RADS ${birads}` };
  if (e.resultado === 'anormal') return { plazo: '15-dias', motivo: 'resultado anormal' };
  if (bethesdaAnormal) return { plazo: '15-dias', motivo: 'Bethesda anormal' };
  if (e.conducta === 'referencia') return { plazo: '15-dias', motivo: 'referencia' };
  if (birads === '3') return { plazo: '6-meses', motivo: 'BI-RADS 3' };
  if (e.conducta === 'evaluacion-6-meses') return { plazo: '6-meses', motivo: 'evaluación a 6 meses' };
  return null;
}

async function registrarSeguimiento(e: TEstudio, regla = reglaSeguimiento(e) ?? { plazo: '15-dias' as const, motivo: 'resultado anormal' }, desde = e.fecha) {
  const parsed = Date.parse(desde);
  const base = Number.isNaN(parsed) ? Date.now() : parsed;
  let limite = base + DIAS_SEGUIMIENTO * DIA_MS;
  if (regla.plazo === '6-meses') { const d = new Date(base); d.setUTCMonth(d.getUTCMonth() + 6); limite = d.getTime(); }
  await valkey.multi()
    .hset(K.segEstudio(e.id), { estudioId: e.id, pacienteId: e.pacienteId, tipo: e.tipo, fecha: e.fecha, motivo: regla.motivo })
    .zadd(K.seguimiento, limite, e.id)
    .exec();
}

// --- Altas -------------------------------------------------------------------
async function buscarCandidatas(p: TPaciente) {
  const ids = new Set<string>();
  for (const b of llavesBloque(p)) for (const id of await valkey.smembers(K.bloque(b))) if (id !== p.id) ids.add(id);
  const distintas = new Set(await valkey.smembers(K.distintas(p.id)));
  const out: { id: string; puntaje: number; razones: string[] }[] = [];
  for (const id of ids) {
    if (distintas.has(id)) continue;
    const otra = await leerPaciente(id);
    if (!otra || (otra as Record<string, unknown>).fusionadaEn) continue;
    const r = comparar(p as DatosPaciente, otra as DatosPaciente);
    if (r.puntaje >= UMBRAL_POSIBLE) out.push({ id, ...ajusteEntidad(p, otra, r) });
  }
  return out.sort((a, b) => b.puntaje - a.puntaje);
}

// Ajuste SOLO del servidor (coincidencias.ts y su gemelo Swift no cambian): si las dos
// traen entidad de nacimiento y es distinta, el par igual entra a la cola para que la
// coordinadora decida, pero con 0.1 menos y la razón a la vista.
export function ajusteEntidad(a: { entidadNacimiento?: string }, b: { entidadNacimiento?: string }, r: { puntaje: number; razones: string[] }) {
  if (!a.entidadNacimiento || !b.entidadNacimiento || normalizar(a.entidadNacimiento) === normalizar(b.entidadNacimiento)) return r;
  return { puntaje: Math.max(0, r.puntaje - 0.1), razones: [...r.razones, 'distinta entidad de nacimiento'] };
}

async function aplicarAlta(p: TPaciente) {
  const campos = Object.fromEntries(Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  campos.consentimiento = cifrar(campos.consentimiento);
  campos.version = '1';
  const m = valkey.multi()
    .hset(K.paciente(p.id), campos)
    .sadd(K.todas, p.id)
    .sadd(K.comunidad(p.comunidad), p.id);
  for (const b of llavesBloque(p)) m.sadd(K.bloque(b), p.id);
  guardarVector(m, p.id, p);
  await m.exec();
  const candidatas = await buscarCandidatas(p);
  for (const c of candidatas) {
    await valkey.hset(K.par(p.id, c.id), { a: p.id, b: c.id, puntaje: c.puntaje.toFixed(3), razones: c.razones.join(', ') });
    await valkey.zadd(K.duplicados, c.puntaje, K.par(p.id, c.id));
  }
  await avisarJornada(p.comunidad,
    { tipo: 'alta', pacienteId: p.id, folio: p.folio, duplicados: candidatas.length },
    { altas: 1, ...(candidatas.length ? { duplicados: candidatas.length } : {}) });
  return candidatas;
}

async function aplicarEstudio(recibido: TEstudio) {
  const e = conEtapa(recibido);
  const m = valkey.multi()
    .rpush(K.estudios(e.pacienteId), serializarEstudio(e))
    .hset(K.estudioPaciente, e.id, e.pacienteId);
  if (e.etapa === 'en-laboratorio') m.zadd(K.patologia, fechaMs(e.fecha), e.id);
  await m.exec();
  const regla = reglaSeguimiento(e);
  if (regla) await registrarSeguimiento(e, regla);
  const p = await leerPaciente(e.pacienteId);
  if (p) {
    await avisarJornada(p.comunidad,
      { tipo: 'estudio', pacienteId: e.pacienteId, estudio: e.tipo, resultado: e.resultado },
      { estudios: 1, [`tipo:${e.tipo}`]: 1, ...(e.resultado === 'anormal' ? { anormales: 1 } : {}) });
  }
}

// --- Visitas (Reto 1): la visita es el día que vino; los estudios cuelgan de ella ---
async function aplicarVisita(v: TVisita) {
  const campos = Object.fromEntries(Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => [k, String(x)]));
  await valkey.multi()
    .hset(K.visita(v.id), campos)
    .zadd(K.visitas(v.pacienteId), Date.parse(v.fecha), v.id)
    .exec();
}

// --- Actualizaciones con versión (Reto 1) -----------------------------------
// Compara y aplica en Valkey de un golpe: si alguien más ya cambió a la paciente
// (versionBase ≠ version actual) no se toca nada.
const SCRIPT_VERSION = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {-1, 0} end
local v = tonumber(redis.call('HGET', KEYS[1], 'version') or '1')
if v ~= tonumber(ARGV[1]) then return {0, v} end
if #ARGV > 1 then redis.call('HSET', KEYS[1], unpack(ARGV, 2)) end
redis.call('HSET', KEYS[1], 'version', v + 1)
return {1, v + 1}`;

const aTexto = (campos: TCampos) => Object.entries(campos).filter(([, v]) => v !== undefined).flatMap(([k, v]) => [k, String(v)]);

// Después de cambiar nombre, edad o comunidad hay que mover los índices.
async function reindexar(antes: TPaciente, despues: TPaciente) {
  const m = valkey.multi();
  for (const b of llavesBloque(antes)) m.srem(K.bloque(b), antes.id);
  for (const b of llavesBloque(despues)) m.sadd(K.bloque(b), despues.id);
  if (norm(antes.comunidad) !== norm(despues.comunidad)) m.srem(K.comunidad(antes.comunidad), antes.id).sadd(K.comunidad(despues.comunidad), despues.id);
  guardarVector(m, despues.id, despues);
  await m.exec();
}

async function forzarCampos(pacienteId: string, campos: TCampos) {
  const antes = await leerPaciente(pacienteId);
  if (!antes) return null;
  await valkey.multi().hset(K.paciente(pacienteId), ...aTexto(campos)).hincrby(K.paciente(pacienteId), 'version', 1).exec();
  const despues = (await leerPaciente(pacienteId))!;
  await reindexar(antes, despues);
  return despues as TPaciente & { version: number };
}

type ResultadoActualizacion = { aplicada: true; version: number } | { aplicada: false; conflictoId: string; campos: string[] };
async function aplicarActualizacion(a: TActualizacion, dispositivo: string): Promise<ResultadoActualizacion> {
  const antes = await leerPaciente(a.pacienteId);
  const r = (await valkey.eval(SCRIPT_VERSION, 1, K.paciente(a.pacienteId), String(a.versionBase), ...aTexto(a.campos))) as [number, number];
  const nombres = Object.keys(a.campos).filter((k) => (a.campos as Record<string, unknown>)[k] !== undefined);
  if (r[0] === 1) {
    await reindexar(antes!, (await leerPaciente(a.pacienteId))!);
    return { aplicada: true, version: r[1] };
  }
  // Conflicto: se guarda lo actual y lo propuesto; decide la coordinadora.
  const id = randomUUID();
  const actual = antes ? Object.fromEntries(nombres.map((k) => [k, (antes as Record<string, unknown>)[k] ?? null])) : null;
  await valkey.multi()
    .hset(K.conflicto(id), {
      id, pacienteId: a.pacienteId, autor: a.autor, dispositivo, versionBase: String(a.versionBase),
      versionActual: String(r[1]), motivo: r[0] === -1 ? 'paciente-no-existe' : 'version-distinta',
      propuesto: JSON.stringify(a.campos), actual: JSON.stringify(actual), creado: new Date().toISOString(),
    })
    .zadd(K.conflictos, Date.now(), id)
    .exec();
  return { aplicada: false, conflictoId: id, campos: nombres };
}

// --- Rutas ------------------------------------------------------------------
const app = new Hono().basePath('/api');
app.use('*', cors());

app.get('/salud', async (c) => c.json({ ok: true, valkey: await valkey.ping(), cifrado: cifradoActivo() }));

// El teléfono manda todo lo que juntó sin señal. Cada evento trae una llave
// única: si el envío se corta y se repite, Valkey lo detecta y no duplica.
app.post('/sync', async (c) => {
  const body = Sync.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  let aplicados = 0, repetidos = 0;
  const posiblesDuplicados: { pacienteId: string; con: string; puntaje: number; razones: string[] }[] = [];
  const conflictos: { pacienteId: string; campos: string[] }[] = [];
  const dispositivo = body.data.dispositivo;
  for (const ev of body.data.eventos) {
    const nuevo = await valkey.set(K.envio(ev.llave), dispositivo, 'EX', 60 * 60 * 24 * 30, 'NX');
    if (!nuevo) { repetidos++; continue; }
    const base = { dispositivo, llave: ev.llave };
    if (ev.tipo === 'alta') {
      for (const d of await aplicarAlta(ev.paciente)) posiblesDuplicados.push({ pacienteId: ev.paciente.id, con: d.id, puntaje: d.puntaje, razones: d.razones });
      await bitacora({ ...base, tipo: 'alta', pacienteId: ev.paciente.id, autor: ev.paciente.creadaPor });
    } else if (ev.tipo === 'estudio') {
      await aplicarEstudio(ev.estudio);
      await bitacora({ ...base, tipo: 'estudio', pacienteId: ev.estudio.pacienteId, autor: ev.estudio.registradoPor, estudioId: ev.estudio.id, visitaId: ev.estudio.visitaId });
    } else if (ev.tipo === 'visita') {
      await aplicarVisita(ev.visita);
      await bitacora({ ...base, tipo: 'visita', pacienteId: ev.visita.pacienteId, autor: ev.visita.registradaPor, visitaId: ev.visita.id });
    } else {
      const a = ev.actualizacion;
      const r = await aplicarActualizacion(a, dispositivo);
      if (r.aplicada) await bitacora({ ...base, tipo: 'actualizacion', pacienteId: a.pacienteId, autor: a.autor, campos: Object.keys(a.campos).join(','), version: r.version });
      else {
        conflictos.push({ pacienteId: a.pacienteId, campos: r.campos });
        await bitacora({ ...base, tipo: 'conflicto', pacienteId: a.pacienteId, autor: a.autor, campos: r.campos.join(','), conflictoId: r.conflictoId });
      }
    }
    aplicados++;
  }
  return c.json({ aplicados, repetidos, posiblesDuplicados, conflictos });
});

// Antes de salir a la jornada: el teléfono baja las pacientes de esa comunidad
// para poder reconocerlas sin señal.
app.get('/pacientes', async (c) => {
  const comunidad = c.req.query('comunidad');
  const ids = comunidad ? await valkey.smembers(K.comunidad(comunidad)) : await valkey.smembers(K.todas);
  const pacientes = [];
  for (const id of ids) {
    const p = await leerPaciente(id);
    if (!p || (p as Record<string, unknown>).fusionadaEn) continue;
    pacientes.push({ ...p, estudios: await leerEstudios(id), visitas: await leerVisitas(id) });
  }
  return c.json(pacientes);
});

app.get('/pacientes/:id', async (c) => {
  const p = await leerPaciente(c.req.param('id'));
  if (!p) return c.json({ error: 'no existe' }, 404);
  return c.json({ ...p, estudios: await leerEstudios(p.id), visitas: await leerVisitas(p.id) });
});

// Cola de revisión para la coordinadora: ella decide, nunca el sistema solo.
app.get('/duplicados', async (c) => {
  const pares = await valkey.zrevrange(K.duplicados, 0, 50);
  const out = [];
  for (const llave of pares) {
    const d = await valkey.hgetall(llave);
    out.push({ llave, puntaje: Number(d.puntaje), razones: d.razones, a: await leerPaciente(d.a), b: await leerPaciente(d.b) });
  }
  return c.json(out);
});

const Resolver = z.object({ a: z.string(), b: z.string(), decision: z.enum(['unir', 'separar']), autor: z.string().optional() });
app.post('/duplicados/resolver', async (c) => {
  const body = Resolver.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const { a, b, decision, autor } = body.data;
  if (decision === 'unir') {
    // b se une en a: sus estudios pasan a a y b queda marcada, no se borra.
    // La nota viaja cifrada tal cual: no hace falta descifrar para moverla.
    const estudios = await valkey.lrange(K.estudios(b), 0, -1);
    const m = valkey.multi();
    for (const s of estudios) {
      const e = JSON.parse(s) as TEstudio;
      m.rpush(K.estudios(a), JSON.stringify({ ...e, pacienteId: a })).hset(K.estudioPaciente, e.id, a);
      if (await valkey.zscore(K.seguimiento, e.id)) m.hset(K.segEstudio(e.id), 'pacienteId', a);
    }
    // Las visitas de b también pasan a a.
    for (const [vid, score] of chunk2(await valkey.zrange(K.visitas(b), 0, -1, 'WITHSCORES'))) {
      m.zadd(K.visitas(a), score, vid).hset(K.visita(vid), 'pacienteId', a);
    }
    m.del(K.estudios(b)).del(K.visitas(b)).del(llaveVector(b)).hset(K.paciente(b), 'fusionadaEn', a);
    await m.exec();
  } else {
    await valkey.multi().sadd(K.distintas(a), b).sadd(K.distintas(b), a).exec();
  }
  await valkey.multi().zrem(K.duplicados, K.par(a, b)).del(K.par(a, b)).exec();
  await bitacora({ tipo: `duplicado-${decision}`, pacienteId: a, otraPacienteId: b, autor: autor ?? 'coordinadora' });
  return c.json({ ok: true });
});

// C1: lo anormal tiene que llegar a tratamiento. Vencidos primero.
app.get('/seguimiento', async (c) => {
  const comunidad = c.req.query('comunidad');
  const ahora = Date.now();
  const filas = await valkey.zrange(K.seguimiento, 0, -1, 'WITHSCORES');
  const out = [];
  for (let i = 0; i < filas.length; i += 2) {
    const estudioId = filas[i], limite = Number(filas[i + 1]);
    const info = await valkey.hgetall(K.segEstudio(estudioId));
    const p = info.pacienteId ? await leerPaciente(info.pacienteId) : null;
    if (!p) continue;
    if (comunidad && norm(p.comunidad) !== norm(comunidad)) continue;
    out.push({
      estudioId, tipo: info.tipo, fecha: info.fecha, motivo: info.motivo ?? 'resultado anormal',
      fechaLimite: new Date(limite).toISOString(),
      vencido: limite < ahora,
      diasRestantes: Math.ceil((limite - ahora) / DIA_MS),
      paciente: { id: p.id, folio: p.folio, nombre: p.nombre, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno, comunidad: p.comunidad },
    });
  }
  return c.json(out);
});

app.post('/seguimiento/:estudioId/atendido', async (c) => {
  const id = c.req.param('estudioId');
  const cuerpo = (await c.req.json().catch(() => ({}))) as { autor?: unknown };
  const pacienteId = await valkey.hget(K.segEstudio(id), 'pacienteId');
  const quitado = await valkey.zrem(K.seguimiento, id);
  if (!quitado) return c.json({ error: 'no está en seguimiento' }, 404);
  await valkey.del(K.segEstudio(id));
  await bitacora({ tipo: 'seguimiento-atendido', pacienteId: pacienteId ?? undefined, estudioId: id, autor: typeof cuerpo.autor === 'string' ? cuerpo.autor : 'medico' });
  return c.json({ ok: true });
});

// C2: tablero de la jornada. Foto del día y, en vivo, cada alta/estudio/duplicado.
app.get('/jornada/:comunidad', async (c) => c.json(await leerConteo(c.req.param('comunidad'), c.req.query('dia') ?? hoy())));

app.get('/jornada/:comunidad/en-vivo', (c) => {
  const comunidad = c.req.param('comunidad');
  return streamSSE(c, async (stream) => {
    const cola: string[] = [];
    let despertar: (() => void) | null = null;
    const soltar = await escuchar(K.canal(comunidad), (msg) => { cola.push(msg); despertar?.(); });
    let abierto = true;
    stream.onAbort(() => { abierto = false; despertar?.(); });
    await stream.writeSSE({ event: 'estado', data: JSON.stringify(await leerConteo(comunidad)) });
    while (abierto) {
      if (!cola.length) {
        // Espera un mensaje o 15 s para mandar un latido y que el proxy no corte.
        await new Promise<void>((r) => { despertar = r; setTimeout(r, 15_000); });
        despertar = null;
        if (!cola.length && abierto) await stream.writeSSE({ event: 'latido', data: '{}' });
      }
      while (cola.length && abierto) {
        const msg = cola.shift()!;
        await stream.writeSSE({ event: (JSON.parse(msg) as { tipo: string }).tipo, data: msg });
      }
    }
    await soltar();
  });
});

// C4: buscar sin dar de alta. Con valkey-bundle usa KNN de valkey-search sobre
// vectores de trigramas fonéticos; sin el módulo, los sets de bloque. En los dos
// casos el puntaje final y las razones salen de coincidencias.ts.
let motor: Promise<'valkey-search' | 'bloques'> | null = null;
const obtenerMotor = () => (motor ??= (async () => {
  if (!(await hayModuloSearch(valkey))) return 'bloques' as const;
  await crearIndice(valkey);
  return 'valkey-search' as const;
})());

const Buscar = z.object({
  nombre: z.string().min(1), apellidoPaterno: z.string().min(1), apellidoMaterno: z.string().optional(),
  edad: z.coerce.number().int().min(0).max(120).optional(), nacimiento: z.string().optional(),
  comunidad: z.string().optional(), k: z.coerce.number().int().min(1).max(50).default(10),
});
app.get('/buscar', async (c) => {
  const q = Buscar.safeParse(c.req.query());
  if (!q.success) return c.json({ error: q.error.issues }, 400);
  const { k, ...datos } = q.data;
  const m = await obtenerMotor();
  const distancias = new Map<string, number>();
  if (m === 'valkey-search') for (const r of await knn(valkey, datos, k * 3)) distancias.set(r.id, r.distancia);
  else for (const b of llavesBloque(datos)) for (const id of await valkey.smembers(K.bloque(b))) distancias.set(id, NaN);
  const resultados = [];
  for (const [id, distancia] of distancias) {
    const p = await leerPaciente(id);
    if (!p || (p as Record<string, unknown>).fusionadaEn) continue;
    const r = comparar(datos, p as DatosPaciente);
    resultados.push({ paciente: p, puntaje: r.puntaje, razones: r.razones, posible: r.puntaje >= UMBRAL_POSIBLE, ...(Number.isNaN(distancia) ? {} : { distancia }) });
  }
  resultados.sort((a, b) => b.puntaje - a.puntaje);
  return c.json({ motor: m, resultados: resultados.slice(0, k) });
});

// Al arrancar: completa lo que se cargó antes de C1/C4 (anormales sin seguimiento,
// pacientes sin vector). Cada migración corre una sola vez (llave bandera).
export async function preparar() {
  if (await valkey.set('migracion:seguimiento-v1', new Date().toISOString(), 'NX')) {
    for (const id of await valkey.smembers(K.todas))
      for (const e of await leerEstudios(id)) if (e.resultado === 'anormal' && (await valkey.zscore(K.seguimiento, e.id)) == null) await registrarSeguimiento(e);
  }
  if (await valkey.set('migracion:vectores-v1', new Date().toISOString(), 'NX')) {
    for (const id of await valkey.smembers(K.todas)) {
      const p = await leerPaciente(id);
      if (!p || (p as Record<string, unknown>).fusionadaEn) continue;
      const m = valkey.multi(); guardarVector(m, id, p); await m.exec();
    }
  }
  // Brigada: estudios cargados antes de tener etapa → mapa estudio→paciente y cola del patólogo.
  if (await valkey.set('migracion:patologia-v1', new Date().toISOString(), 'NX')) {
    for (const id of await valkey.smembers(K.todas)) {
      const m = valkey.multi();
      for (const e of await leerEstudios(id)) {
        m.hset(K.estudioPaciente, e.id, id);
        if (e.etapa === 'en-laboratorio') m.zadd(K.patologia, 'NX', fechaMs(e.fecha), e.id);
      }
      await m.exec();
    }
  }
  return obtenerMotor();
}

// --- Conflictos (Reto 1): la coordinadora decide qué versión queda ----------
async function leerConflicto(id: string) {
  const h = await valkey.hgetall(K.conflicto(id));
  if (!h.id) return null;
  const propuesto = JSON.parse(h.propuesto) as Record<string, unknown>;
  const alRecibir = JSON.parse(h.actual) as Record<string, unknown> | null;
  const p = await leerPaciente(h.pacienteId) as (TPaciente & { version: number }) | null;
  return {
    id: h.id, pacienteId: h.pacienteId, autor: h.autor, dispositivo: h.dispositivo, creado: h.creado, motivo: h.motivo,
    versionBase: Number(h.versionBase), versionActual: p?.version ?? null,
    // actual = lo que la paciente tiene hoy; alRecibir = lo que tenía cuando llegó el cambio.
    campos: Object.keys(propuesto).map((campo) => ({
      campo, propuesto: propuesto[campo],
      actual: p ? (p as Record<string, unknown>)[campo] ?? null : null,
      alRecibir: alRecibir ? alRecibir[campo] ?? null : null,
    })),
    paciente: p ? { id: p.id, folio: p.folio, nombre: p.nombre, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno, comunidad: p.comunidad } : null,
  };
}

app.get('/conflictos', async (c) => {
  const out = [];
  for (const id of await valkey.zrange(K.conflictos, 0, 100)) {
    const cf = await leerConflicto(id);
    if (cf) out.push(cf);
  }
  return c.json(out);
});

const ResolverConflicto = z.object({ decision: z.enum(['aceptar', 'rechazar']), autor: z.string().optional() });
app.post('/conflictos/:id/resolver', async (c) => {
  const body = ResolverConflicto.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const id = c.req.param('id');
  if ((await valkey.zscore(K.conflictos, id)) == null) return c.json({ error: 'no está pendiente' }, 404);
  const h = await valkey.hgetall(K.conflicto(id));
  let version: number | undefined;
  if (body.data.decision === 'aceptar') {
    const p = await forzarCampos(h.pacienteId, JSON.parse(h.propuesto) as TCampos);
    if (!p) return c.json({ error: 'la paciente no existe' }, 409);
    version = p.version;
  }
  await valkey.multi().zrem(K.conflictos, id).hset(K.conflicto(id), { estado: body.data.decision, resuelto: new Date().toISOString() }).expire(K.conflicto(id), 60 * 60 * 24 * 30).exec();
  await bitacora({ tipo: `conflicto-${body.data.decision}`, pacienteId: h.pacienteId, conflictoId: id, campos: Object.keys(JSON.parse(h.propuesto)).join(','), autor: body.data.autor ?? 'coordinadora', version });
  return c.json({ ok: true, ...(version ? { version } : {}) });
});

// --- Bitácora (Reto 1): quién, qué, cuándo, de qué paciente. Sin datos clínicos.
const Bitacora = z.object({ limite: z.coerce.number().int().min(1).max(500).default(50), pacienteId: z.string().optional() });
app.get('/bitacora', async (c) => {
  const q = Bitacora.safeParse(c.req.query());
  if (!q.success) return c.json({ error: q.error.issues }, 400);
  const { limite, pacienteId } = q.data;
  const out: Record<string, unknown>[] = [];
  let fin = '+';
  while (out.length < limite) {
    const filas = (await valkey.xrevrange(K.eventos, fin, '-', 'COUNT', 500)) as [string, string[]][];
    for (const [sid, plano] of filas) {
      const f: Record<string, string> = {};
      for (let i = 0; i < plano.length; i += 2) f[plano[i]] = plano[i + 1];
      // Entradas viejas (antes del Reto 1) usaban a/b/estudio.
      const fila = {
        id: sid,
        cuando: new Date(Number(sid.split('-')[0])).toISOString(),
        tipo: f.tipo,
        autor: f.autor ?? null,
        dispositivo: f.dispositivo ?? null,
        pacienteId: f.pacienteId ?? f.a ?? null,
        ...(f.otraPacienteId ?? f.b ? { otraPacienteId: f.otraPacienteId ?? f.b } : {}),
        ...(f.estudioId ?? f.estudio ? { estudioId: f.estudioId ?? f.estudio } : {}),
        ...(f.visitaId ? { visitaId: f.visitaId } : {}),
        ...(f.conflictoId ? { conflictoId: f.conflictoId } : {}),
        ...(f.campos ? { campos: f.campos.split(',') } : {}),
        ...(f.version ? { version: Number(f.version) } : {}),
      };
      if (pacienteId && fila.pacienteId !== pacienteId && fila.otraPacienteId !== pacienteId) continue;
      out.push(fila);
      if (out.length >= limite) break;
    }
    if (filas.length < 500) break;
    fin = '(' + filas[filas.length - 1][0];
  }
  return c.json(out);
});

// --- Brigada: estado de la jornada, patología y resumen al regresar ----------
// Estado efectivo = estado de la visita; si no hay, lo que va después de la última
// coma en el municipio («San Martín Peras, Oaxaca» → «Oaxaca»); si no, «Sin estado».
export const SIN_ESTADO = 'Sin estado';
const clave = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
export function estadoDeMunicipio(municipio?: string) {
  if (!municipio || !municipio.includes(',')) return undefined;
  return municipio.slice(municipio.lastIndexOf(',') + 1).trim() || undefined;
}

type Expediente = { p: TPaciente; estudios: TEstudioGuardado[]; visitas: TVisita[]; estado: string };

// Lee pacientes con estudios y visitas en dos pipelines. Las fusionadas no cuentan.
async function cargarExpedientes(ids: string[]): Promise<Expediente[]> {
  if (!ids.length) return [];
  const p1 = valkey.pipeline();
  for (const id of ids) p1.hgetall(K.paciente(id)).lrange(K.estudios(id), 0, -1).zrange(K.visitas(id), 0, -1);
  const r1 = ((await p1.exec()) ?? []).map(([, v]) => v);
  const crudos = ids.map((_, i) => ({ h: r1[3 * i] as Record<string, string>, est: r1[3 * i + 1] as string[], vids: r1[3 * i + 2] as string[] }))
    .filter((x) => x.h?.id && !x.h.fusionadaEn);
  const p2 = valkey.pipeline();
  for (const x of crudos) for (const v of x.vids) p2.hgetall(K.visita(v));
  const visitas = ((await p2.exec()) ?? []).map(([, v]) => v as Record<string, string>);
  let i = 0;
  return crudos.map((x) => {
    const vs = x.vids.map(() => visitas[i++]).filter((v) => v?.id) as unknown as TVisita[];
    const p = { ...x.h, edad: x.h.edad ? Number(x.h.edad) : undefined } as unknown as TPaciente;
    // La paciente queda en el estado de su visita más reciente que lo diga.
    const ultima = [...vs].reverse().find((v) => v.estado?.trim());
    const estado = ultima?.estado?.trim() || estadoDeMunicipio(p.municipio) || SIN_ESTADO;
    return { p, visitas: vs, estado, estudios: x.est.map((s) => conEtapa(JSON.parse(s) as TEstudioGuardado)) };
  });
}

// Estado y comunidad de un estudio: los de su visita; si no, los de la paciente.
function lugarEstudio(x: Expediente, e: TEstudio) {
  const v = e.visitaId ? x.visitas.find((v) => v.id === e.visitaId) : undefined;
  return { estado: v?.estado?.trim() || x.estado, comunidad: v?.comunidad || x.p.comunidad };
}
function lugarVisita(x: Expediente, v: TVisita) {
  return { estado: v.estado?.trim() || estadoDeMunicipio(x.p.municipio) || SIN_ESTADO, comunidad: v.comunidad || x.p.comunidad };
}

const Filtros = z.object({ estado: z.string().trim().min(1).optional(), comunidad: z.string().trim().min(1).optional() });
type TFiltros = z.infer<typeof Filtros>;
const coincide = (f: TFiltros, l: { estado: string; comunidad: string }) =>
  (!f.estado || clave(f.estado) === clave(l.estado)) && (!f.comunidad || clave(f.comunidad) === clave(l.comunidad));

// Busca en qué lista vive un estudio. Primero el mapa; si falla (datos viejos o
// unión), recorre a todas las pacientes y lo corrige.
async function ubicarEstudio(id: string): Promise<{ pacienteId: string; crudo: string; e: TEstudioGuardado } | null> {
  const enLista = async (pacienteId: string) => {
    for (const crudo of await valkey.lrange(K.estudios(pacienteId), 0, -1)) {
      const e = JSON.parse(crudo) as TEstudioGuardado;
      if (e.id === id) return { pacienteId, crudo, e: conEtapa(e) };
    }
    return null;
  };
  const guardado = await valkey.hget(K.estudioPaciente, id);
  if (guardado) { const r = await enLista(guardado); if (r) return r; }
  for (const pid of await valkey.smembers(K.todas)) {
    const r = await enLista(pid);
    if (r) { await valkey.hset(K.estudioPaciente, id, pid); return r; }
  }
  return null;
}

// Cambia un estudio dentro de la lista solo si sigue igual que cuando se leyó
// (compare-and-swap por valor en Lua): dos patólogos a la vez no se pisan.
const SCRIPT_CAMBIAR_ESTUDIO = `
local xs = redis.call('LRANGE', KEYS[1], 0, -1)
for i, v in ipairs(xs) do
  if v == ARGV[1] then redis.call('LSET', KEYS[1], i - 1, ARGV[2]); redis.call('ZREM', KEYS[2], ARGV[3]); return 1 end
end
return 0`;

type Cambio = { error: 'no-existe' | 'conflicto'; etapa?: TEtapa } | { estudio: TEstudioGuardado; antes: TEstudioGuardado };
async function cambiarEstudio(id: string, fn: (e: TEstudioGuardado) => TEstudioGuardado | { conflicto: TEtapa }): Promise<Cambio> {
  for (let intento = 0; intento < 5; intento++) {
    const u = await ubicarEstudio(id);
    if (!u) return { error: 'no-existe' };
    const antes = leerEstudio(u.crudo);
    const nuevo = fn(antes);
    if ('conflicto' in nuevo) return { error: 'conflicto', etapa: nuevo.conflicto };
    const ok = await valkey.eval(SCRIPT_CAMBIAR_ESTUDIO, 2, K.estudios(u.pacienteId), K.patologia, u.crudo, serializarEstudio(nuevo), id);
    if (ok === 1) return { estudio: nuevo, antes };
  }
  return { error: 'conflicto' };
}

// Cola del patólogo: papanicolaous en laboratorio, el que más espera primero.
app.get('/patologia', async (c) => {
  const f = Filtros.safeParse(c.req.query());
  if (!f.success) return c.json({ error: f.error.issues }, 400);
  const filas = await valkey.zrange(K.patologia, 0, -1, 'WITHSCORES');
  if (!filas.length) return c.json([]);
  const ids = chunk2(filas).map(([id]) => id);
  const pacientes = await valkey.hmget(K.estudioPaciente, ...ids);
  const exps = new Map((await cargarExpedientes([...new Set(pacientes.filter((x): x is string => !!x))])).map((x) => [x.p.id, x]));
  const ahora = Date.now();
  const out = [];
  for (const [i, [id, score]] of chunk2(filas).entries()) {
    const x = exps.get(pacientes[i] ?? '');
    const e = x?.estudios.find((e) => e.id === id);
    if (!x || !e || e.etapa !== 'en-laboratorio') continue;
    const lugar = lugarEstudio(x, e);
    if (!coincide(f.data, lugar)) continue;
    const p = x.p;
    out.push({
      estudio: { id: e.id, tipo: e.tipo, fecha: e.fecha, etapa: e.etapa },
      paciente: { id: p.id, folio: p.folio, nombre: p.nombre, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno, edad: p.edad, comunidad: p.comunidad },
      estado: lugar.estado,
      diasEsperando: Math.max(0, Math.floor((ahora - Number(score)) / DIA_MS)),
    });
  }
  return c.json(out);
});

// Bethesda «Negativa» (o NILM) es lo único que no pide seguimiento.
export const bethesdaNegativa = (c?: string) => !c || /^(negativ|nilm)/.test(clave(c));

const Interpretacion = z.object({
  resultado: z.enum(['normal', 'anormal']),
  clasificacion: z.string().trim().min(1).max(100).optional(),
  nota: z.string().max(500).optional(),
  patologo: z.string().trim().min(1),
  cedula: z.string().trim().min(1).max(30).optional(),
});
app.post('/estudios/:id/interpretacion', async (c) => {
  const body = Interpretacion.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const { resultado, clasificacion, nota, patologo, cedula } = body.data;
  const ahora = new Date().toISOString();
  const r = await cambiarEstudio(c.req.param('id'), (e) => {
    if (e.etapa === 'interpretado' || e.etapa === 'avisado') return { conflicto: e.etapa };
    return {
      ...e, resultado, etapa: 'interpretado', interpretadoPor: patologo, interpretadoEn: ahora,
      ...(clasificacion ? { clasificacion } : {}), ...(nota ? { nota } : {}), ...(cedula ? { cedula } : {}),
    };
  });
  if ('error' in r) return r.error === 'no-existe'
    ? c.json({ error: 'no existe' }, 404)
    : c.json({ error: 'ya estaba interpretado', etapa: r.etapa }, 409);
  const e = r.estudio;
  // Anormal o Bethesda distinta de «Negativa» → seguimiento a 15 días desde hoy.
  const seguimiento = resultado === 'anormal' || !bethesdaNegativa(clasificacion);
  if (seguimiento) {
    const motivo = bethesdaNegativa(clasificacion) ? 'resultado anormal' : `Bethesda ${clasificacion}`;
    await registrarSeguimiento(e, { plazo: '15-dias', motivo }, ahora);
  }
  await bitacora({ tipo: 'interpretacion', pacienteId: e.pacienteId, estudioId: e.id, autor: patologo });
  return c.json({ ok: true, seguimiento, estudio: e });
});

const Avisado = z.object({ autor: z.string().trim().min(1).optional() });
app.post('/estudios/:id/avisado', async (c) => {
  const body = Avisado.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const autor = body.data.autor ?? 'brigada';
  const r = await cambiarEstudio(c.req.param('id'), (e) => {
    if (e.etapa !== 'interpretado') return { conflicto: e.etapa ?? etapaDe(e) };
    return { ...e, etapa: 'avisado', avisadoPor: autor, avisadoEn: new Date().toISOString() };
  });
  if ('error' in r) return r.error === 'no-existe'
    ? c.json({ error: 'no existe' }, 404)
    : c.json({ error: r.etapa === 'avisado' ? 'ya estaba avisado' : 'todavía no hay resultado', etapa: r.etapa }, 409);
  await bitacora({ tipo: 'avisado', pacienteId: r.estudio.pacienteId, estudioId: r.estudio.id, autor });
  return c.json({ ok: true, estudio: r.estudio });
});

// Lo que la brigada ve al regresar: personas, estudios y pendientes por estado y comunidad.
app.get('/resumen', async (c) => {
  const q = Filtros.safeParse(c.req.query());
  if (!q.success) return c.json({ error: q.error.issues }, 400);
  const f = q.data;
  const hayFiltro = !!(f.estado || f.comunidad);
  const exps = await cargarExpedientes(await valkey.smembers(K.todas));

  const cero = () => ({ personas: 0, estudios: 0, anormales: 0, pendientesPatologia: 0 });
  const porEstado = new Map<string, { estado: string } & ReturnType<typeof cero>>();
  const porComunidad = new Map<string, { comunidad: string; estado: string } & ReturnType<typeof cero>>();
  const fila = (estado: string, comunidad: string) => {
    const ke = clave(estado), kc = `${clave(comunidad)}|${ke}`;
    if (!porEstado.has(ke)) porEstado.set(ke, { estado, ...cero() });
    if (!porComunidad.has(kc)) porComunidad.set(kc, { comunidad, estado, ...cero() });
    return [porEstado.get(ke)!, porComunidad.get(kc)!];
  };
  const tipos = { mastografia: 0, ultrasonido: 0, papanicolaou: 0, exploracion: 0 };
  const resultados = { normal: 0, anormal: 0, pendiente: 0 };
  const etapas = { tomado: 0, 'en-laboratorio': 0, interpretado: 0, avisado: 0 };
  let personasUnicas = 0, visitas = 0, total = 0, anormales = 0;
  const personas = new Set<string>();

  for (const x of exps) {
    const lugarP = { estado: x.estado, comunidad: x.p.comunidad };
    if (coincide(f, lugarP)) {
      personasUnicas++; personas.add(x.p.id);
      for (const g of fila(lugarP.estado, lugarP.comunidad)) g.personas++;
    }
    for (const v of x.visitas) if (coincide(f, lugarVisita(x, v))) visitas++;
    for (const e of x.estudios) {
      const l = lugarEstudio(x, e);
      if (!coincide(f, l)) continue;
      total++;
      tipos[e.tipo]++;
      resultados[e.resultado ?? 'pendiente']++;
      etapas[e.etapa!]++;
      const anormal = e.resultado === 'anormal';
      if (anormal) anormales++;
      for (const g of fila(l.estado, l.comunidad)) {
        g.estudios++;
        if (anormal) g.anormales++;
        if (e.etapa === 'en-laboratorio') g.pendientesPatologia++;
      }
    }
  }

  // Seguimiento vencido y duplicados: sin filtro, el conteo directo; con filtro,
  // solo los de las pacientes que entran.
  let seguimientoVencido: number, duplicadosPendientes: number;
  if (!hayFiltro) {
    seguimientoVencido = await valkey.zcount(K.seguimiento, '-inf', Date.now());
    duplicadosPendientes = await valkey.zcard(K.duplicados);
  } else {
    const venc = await valkey.zrangebyscore(K.seguimiento, '-inf', Date.now());
    const pv = valkey.pipeline();
    for (const id of venc) pv.hget(K.segEstudio(id), 'pacienteId');
    seguimientoVencido = ((await pv.exec()) ?? []).filter(([, pid]) => personas.has(pid as string)).length;
    const pares = await valkey.zrange(K.duplicados, 0, -1);
    const pd = valkey.pipeline();
    for (const llave of pares) pd.hmget(llave, 'a', 'b');
    duplicadosPendientes = ((await pd.exec()) ?? []).filter(([, ab]) => (ab as string[]).some((id) => personas.has(id))).length;
  }

  const orden = <T extends { personas: number; estudios: number }>(xs: T[]) => xs.filter((g) => g.personas || g.estudios).sort((a, b) => b.personas - a.personas || b.estudios - a.estudios);
  return c.json({
    corte: new Date().toISOString(),
    filtros: { ...(f.estado ? { estado: f.estado } : {}), ...(f.comunidad ? { comunidad: f.comunidad } : {}) },
    personasUnicas,
    visitas,
    estudios: { total, porTipo: tipos, porResultado: resultados, porEtapa: etapas },
    anormales,
    pendientesPatologia: etapas['en-laboratorio'],
    seguimientoVencido,
    duplicadosPendientes,
    porEstado: orden([...porEstado.values()]),
    porComunidad: orden([...porComunidad.values()]),
  });
});

app.get('/estadisticas', async (c) => c.json({
  pacientes: await valkey.scard(K.todas),
  duplicadosPendientes: await valkey.zcard(K.duplicados),
  eventos: await valkey.xlen(K.eventos),
  seguimientoPendiente: await valkey.zcard(K.seguimiento),
  seguimientoVencido: await valkey.zcount(K.seguimiento, '-inf', Date.now()),
  conflictosPendientes: await valkey.zcard(K.conflictos),
}));

export async function cerrar() {
  await suscriptor?.quit();
  suscriptor = null;
  await valkey.quit();
}

// --- Panel web estático (carpeta panel/ en la raíz del repo) -----------------
// /panel redirige a /panel/ para que las rutas relativas del panel funcionen.
const PANEL_DIR = process.env.PANEL_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../panel');
const raiz = new Hono();
raiz.route('/', app);
raiz.get('/panel', (c) => c.redirect('/panel/'));
raiz.use('/panel/*', serveStatic({ root: PANEL_DIR, rewriteRequestPath: (p) => p.replace(/^\/panel/, '') }));

if (process.env.NODE_ENV !== 'test') {
  cifradoActivo(); // carga la llave al arrancar: avisa en el log si falta CLAVE_DATOS
  preparar().then((m) => console.log(`[busqueda] motor: ${m}`)).catch((e) => console.error('[preparar]', e));
  serve({ fetch: raiz.fetch, port: Number(process.env.PORT ?? 8787), hostname: '0.0.0.0' }, (i) => console.log(`API en http://localhost:${i.port}/api · panel en /panel`));
}
export default raiz;
