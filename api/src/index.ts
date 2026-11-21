import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import Valkey from 'iovalkey';
import { z } from 'zod';
import { comparar, llavesBloque, UMBRAL_POSIBLE, type DatosPaciente } from './coincidencias';
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
});
const Estudio = z.object({
  id: z.string(),
  pacienteId: z.string(),
  tipo: z.enum(['mastografia', 'ultrasonido', 'papanicolaou', 'exploracion']),
  fecha: z.string(),
  resultado: z.enum(['pendiente', 'normal', 'anormal']).default('pendiente'),
  nota: z.string().max(500).optional(),
  registradoPor: z.string(),
});
const Evento = z.discriminatedUnion('tipo', [
  z.object({ llave: z.string(), tipo: z.literal('alta'), paciente: Paciente }),
  z.object({ llave: z.string(), tipo: z.literal('estudio'), estudio: Estudio }),
]);
const Sync = z.object({ dispositivo: z.string(), eventos: z.array(Evento).max(500) });
type TPaciente = z.infer<typeof Paciente>;
type TEstudio = z.infer<typeof Estudio>;

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
};

export const DIAS_SEGUIMIENTO = 15;
const DIA_MS = 24 * 60 * 60 * 1000;
// Las jornadas son en México: el «día» se corta a medianoche de la CDMX.
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

// --- Lectura / escritura (aquí se cifra y descifra, C3) ---------------------
async function leerPaciente(id: string): Promise<TPaciente | null> {
  const h = await valkey.hgetall(K.paciente(id));
  if (!h.id) return null;
  if (h.consentimiento) h.consentimiento = descifrar(h.consentimiento);
  return { ...h, edad: h.edad ? Number(h.edad) : undefined } as unknown as TPaciente;
}

const serializarEstudio = (e: TEstudio) => JSON.stringify(e.nota ? { ...e, nota: cifrar(e.nota) } : e);
function leerEstudio(s: string): TEstudio {
  const e = JSON.parse(s) as TEstudio;
  return e.nota ? { ...e, nota: descifrar(e.nota) } : e;
}
const leerEstudios = async (id: string) => (await valkey.lrange(K.estudios(id), 0, -1)).map(leerEstudio);

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
async function registrarSeguimiento(e: TEstudio) {
  const base = Date.parse(e.fecha);
  const limite = (Number.isNaN(base) ? Date.now() : base) + DIAS_SEGUIMIENTO * DIA_MS;
  await valkey.multi()
    .hset(K.segEstudio(e.id), { estudioId: e.id, pacienteId: e.pacienteId, tipo: e.tipo, fecha: e.fecha })
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
    if (r.puntaje >= UMBRAL_POSIBLE) out.push({ id, ...r });
  }
  return out.sort((a, b) => b.puntaje - a.puntaje);
}

async function aplicarAlta(p: TPaciente) {
  const campos = Object.fromEntries(Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  campos.consentimiento = cifrar(campos.consentimiento);
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

async function aplicarEstudio(e: TEstudio) {
  await valkey.rpush(K.estudios(e.pacienteId), serializarEstudio(e));
  if (e.resultado === 'anormal') await registrarSeguimiento(e);
  const p = await leerPaciente(e.pacienteId);
  if (p) {
    await avisarJornada(p.comunidad,
      { tipo: 'estudio', pacienteId: e.pacienteId, estudio: e.tipo, resultado: e.resultado },
      { estudios: 1, [`tipo:${e.tipo}`]: 1, ...(e.resultado === 'anormal' ? { anormales: 1 } : {}) });
  }
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
  for (const ev of body.data.eventos) {
    const nuevo = await valkey.set(K.envio(ev.llave), body.data.dispositivo, 'EX', 60 * 60 * 24 * 30, 'NX');
    if (!nuevo) { repetidos++; continue; }
    if (ev.tipo === 'alta') {
      for (const d of await aplicarAlta(ev.paciente)) posiblesDuplicados.push({ pacienteId: ev.paciente.id, con: d.id, puntaje: d.puntaje, razones: d.razones });
    } else {
      await aplicarEstudio(ev.estudio);
    }
    await valkey.xadd(K.eventos, 'MAXLEN', '~', '10000', '*', 'tipo', ev.tipo, 'dispositivo', body.data.dispositivo, 'llave', ev.llave);
    aplicados++;
  }
  return c.json({ aplicados, repetidos, posiblesDuplicados });
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
    pacientes.push({ ...p, estudios: await leerEstudios(id) });
  }
  return c.json(pacientes);
});

app.get('/pacientes/:id', async (c) => {
  const p = await leerPaciente(c.req.param('id'));
  if (!p) return c.json({ error: 'no existe' }, 404);
  return c.json({ ...p, estudios: await leerEstudios(p.id) });
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

const Resolver = z.object({ a: z.string(), b: z.string(), decision: z.enum(['unir', 'separar']) });
app.post('/duplicados/resolver', async (c) => {
  const body = Resolver.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.issues }, 400);
  const { a, b, decision } = body.data;
  if (decision === 'unir') {
    // b se une en a: sus estudios pasan a a y b queda marcada, no se borra.
    // La nota viaja cifrada tal cual: no hace falta descifrar para moverla.
    const estudios = await valkey.lrange(K.estudios(b), 0, -1);
    const m = valkey.multi();
    for (const s of estudios) {
      const e = JSON.parse(s) as TEstudio;
      m.rpush(K.estudios(a), JSON.stringify({ ...e, pacienteId: a }));
      if (await valkey.zscore(K.seguimiento, e.id)) m.hset(K.segEstudio(e.id), 'pacienteId', a);
    }
    m.del(K.estudios(b)).del(llaveVector(b)).hset(K.paciente(b), 'fusionadaEn', a);
    await m.exec();
  } else {
    await valkey.multi().sadd(K.distintas(a), b).sadd(K.distintas(b), a).exec();
  }
  await valkey.multi().zrem(K.duplicados, K.par(a, b)).del(K.par(a, b)).exec();
  await valkey.xadd(K.eventos, '*', 'tipo', `duplicado-${decision}`, 'a', a, 'b', b);
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
      estudioId, tipo: info.tipo, fecha: info.fecha,
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
  const quitado = await valkey.zrem(K.seguimiento, id);
  if (!quitado) return c.json({ error: 'no está en seguimiento' }, 404);
  await valkey.del(K.segEstudio(id));
  await valkey.xadd(K.eventos, '*', 'tipo', 'seguimiento-atendido', 'estudio', id);
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
  return obtenerMotor();
}

app.get('/estadisticas', async (c) => c.json({
  pacientes: await valkey.scard(K.todas),
  duplicadosPendientes: await valkey.zcard(K.duplicados),
  eventos: await valkey.xlen(K.eventos),
  seguimientoPendiente: await valkey.zcard(K.seguimiento),
  seguimientoVencido: await valkey.zcount(K.seguimiento, '-inf', Date.now()),
}));

export async function cerrar() {
  await suscriptor?.quit();
  suscriptor = null;
  await valkey.quit();
}

if (process.env.NODE_ENV !== 'test') {
  cifradoActivo(); // carga la llave al arrancar: avisa en el log si falta CLAVE_DATOS
  preparar().then((m) => console.log(`[busqueda] motor: ${m}`)).catch((e) => console.error('[preparar]', e));
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787), hostname: '0.0.0.0' }, (i) => console.log(`API en http://localhost:${i.port}/api`));
}
export default app;
