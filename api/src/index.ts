import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import Valkey from 'iovalkey';
import { z } from 'zod';
import { comparar, llavesBloque, UMBRAL_POSIBLE, type DatosPaciente } from './coincidencias';

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

// --- Llaves de Valkey (un solo lugar) ---------------------------------------
const K = {
  paciente: (id: string) => `paciente:${id}`,
  estudios: (id: string) => `paciente:${id}:estudios`,
  todas: 'pacientes',
  comunidad: (c: string) => `pacientes:comunidad:${c.toLowerCase().trim()}`,
  bloque: (b: string) => `bloque:${b}`,
  envio: (llave: string) => `sync:envio:${llave}`,
  duplicados: 'duplicados',
  par: (a: string, b: string) => `duplicado:${[a, b].sort().join('|')}`,
  distintas: (id: string) => `distintas:${id}`,
  eventos: 'eventos',
};

async function leerPaciente(id: string): Promise<TPaciente | null> {
  const h = await valkey.hgetall(K.paciente(id));
  if (!h.id) return null;
  return { ...h, edad: h.edad ? Number(h.edad) : undefined } as unknown as TPaciente;
}

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
  const m = valkey.multi()
    .hset(K.paciente(p.id), campos)
    .sadd(K.todas, p.id)
    .sadd(K.comunidad(p.comunidad), p.id);
  for (const b of llavesBloque(p)) m.sadd(K.bloque(b), p.id);
  await m.exec();
  const candidatas = await buscarCandidatas(p);
  for (const c of candidatas) {
    await valkey.hset(K.par(p.id, c.id), { a: p.id, b: c.id, puntaje: c.puntaje.toFixed(3), razones: c.razones.join(', ') });
    await valkey.zadd(K.duplicados, c.puntaje, K.par(p.id, c.id));
  }
  return candidatas;
}

// --- Rutas ------------------------------------------------------------------
const app = new Hono().basePath('/api');
app.use('*', cors());

app.get('/salud', async (c) => c.json({ ok: true, valkey: await valkey.ping() }));

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
      await valkey.rpush(K.estudios(ev.estudio.pacienteId), JSON.stringify(ev.estudio));
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
    const estudios = (await valkey.lrange(K.estudios(id), 0, -1)).map((s) => JSON.parse(s));
    pacientes.push({ ...p, estudios });
  }
  return c.json(pacientes);
});

app.get('/pacientes/:id', async (c) => {
  const p = await leerPaciente(c.req.param('id'));
  if (!p) return c.json({ error: 'no existe' }, 404);
  const estudios = (await valkey.lrange(K.estudios(p.id), 0, -1)).map((s) => JSON.parse(s));
  return c.json({ ...p, estudios });
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
    const estudios = await valkey.lrange(K.estudios(b), 0, -1);
    const m = valkey.multi();
    for (const e of estudios) m.rpush(K.estudios(a), JSON.stringify({ ...JSON.parse(e), pacienteId: a }));
    m.del(K.estudios(b)).hset(K.paciente(b), 'fusionadaEn', a);
    await m.exec();
  } else {
    await valkey.multi().sadd(K.distintas(a), b).sadd(K.distintas(b), a).exec();
  }
  await valkey.multi().zrem(K.duplicados, K.par(a, b)).del(K.par(a, b)).exec();
  await valkey.xadd(K.eventos, '*', 'tipo', `duplicado-${decision}`, 'a', a, 'b', b);
  return c.json({ ok: true });
});

app.get('/estadisticas', async (c) => c.json({
  pacientes: await valkey.scard(K.todas),
  duplicadosPendientes: await valkey.zcard(K.duplicados),
  eventos: await valkey.xlen(K.eventos),
}));

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787), hostname: '0.0.0.0' }, (i) => console.log(`API en http://localhost:${i.port}/api`));
}
export default app;
