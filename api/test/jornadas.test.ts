// Jornadas programadas: alta, lista con conteos por comunidad, cancelación y bitácora.
// Valkey real en la DB 12 (se limpia al empezar y al terminar).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

process.env.VALKEY_URL = process.env.VALKEY_URL_TEST_JORNADAS ?? 'redis://localhost:6379/12';

const { default: app, valkey, cerrar } = await import('../src/index');

const DIA = 24 * 60 * 60 * 1000;
const hoyCDMX = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const masDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const paciente = (o: Record<string, unknown>) => ({
  id: randomUUID(), folio: 'F' + Math.floor(Math.random() * 1e5), consentimiento: '2026-11-21T10:00:00Z',
  creadaPor: 'enf-1', creada: '2026-11-21T10:00:00Z', nombre: 'Ana', apellidoPaterno: 'Prueba', ...o,
});
const estudio = (pacienteId: string, o: Record<string, unknown> = {}) => ({
  id: randomUUID(), pacienteId, tipo: 'mastografia', fecha: '2026-11-10', resultado: 'normal', registradoPor: 'med-1', ...o,
});
const json = (metodo: string, ruta: string, body?: object) =>
  app.request(ruta, { method: metodo, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
const get = async (ruta: string) => (await app.request(ruta)).json() as Promise<any>;

beforeAll(async () => {
  expect(process.env.VALKEY_URL).toMatch(/\/12$/); // nunca borrar la DB de la demo
  await valkey.flushdb();
});
afterAll(async () => {
  await valkey.flushdb();
  await cerrar();
});

describe('jornadas programadas', () => {
  const hoy = hoyCDMX();
  const ids: Record<string, string> = {};

  it('valida el cuerpo', async () => {
    expect((await json('POST', '/api/jornadas', { comunidad: 'X', estado: 'Oaxaca', fecha: '2026-02-30', autor: 'a' })).status).toBe(400);
    expect((await json('POST', '/api/jornadas', { comunidad: 'X', estado: 'Oaxaca', fecha: '25/11/2026', autor: 'a' })).status).toBe(400);
    expect((await json('POST', '/api/jornadas', { comunidad: '', estado: 'Oaxaca', fecha: hoy, autor: 'a' })).status).toBe(400);
    expect((await json('POST', '/api/jornadas', { comunidad: 'X', estado: 'Oaxaca', fecha: hoy })).status).toBe(400);
    expect((await app.request('/api/jornadas?dias=0')).status).toBe(400);
  });

  it('crea, guarda en hash + sorted set y deja bitácora sin datos clínicos', async () => {
    // Pacientes: 2 de San Martín Peras (una fusionada no cuenta), 1 de otra comunidad.
    const a = paciente({ comunidad: 'San Martín Peras' });
    const b = paciente({ comunidad: 'san martin peras', nombre: 'Bea' });
    const fusionada = paciente({ comunidad: 'San Martín Peras', nombre: 'Ana', apellidoPaterno: 'Prueva' });
    const otra = paciente({ comunidad: 'Huejuquilla' });
    const pap = estudio(a.id, { tipo: 'papanicolaou', resultado: 'pendiente' }); // en laboratorio
    const anormal = estudio(b.id, { resultado: 'anormal' }); // en seguimiento
    const normal = estudio(b.id); // no cuenta
    const papOtra = estudio(otra.id, { tipo: 'papanicolaou', resultado: 'pendiente' });
    const ev = (tipo: string, x: object) => ({ llave: randomUUID(), tipo, [tipo === 'alta' ? 'paciente' : 'estudio']: x });
    const r = await json('POST', '/api/sync', { dispositivo: 'test', eventos: [ev('alta', a), ev('alta', b), ev('alta', fusionada), ev('alta', otra), ev('estudio', pap), ev('estudio', anormal), ev('estudio', normal), ev('estudio', papOtra)] });
    expect(r.status).toBe(200);
    await valkey.hset(`paciente:${fusionada.id}`, 'fusionadaEn', a.id);

    const lejos = await json('POST', '/api/jornadas', { comunidad: 'Metlatónoc', estado: 'Guerrero', fecha: masDias(hoy, 18), autor: 'Coord Prueba' });
    const cerca = await json('POST', '/api/jornadas', {
      comunidad: 'San Martín Peras', estado: 'Oaxaca', municipio: 'San Martín Peras, Oaxaca', fecha: masDias(hoy, 4),
      equipo: ['Dra. Prueba', 'Enf. Prueba'], nota: 'Salida 6:00', autor: 'Coord Prueba',
    });
    const fuera = await json('POST', '/api/jornadas', { comunidad: 'Huejuquilla', estado: 'Jalisco', fecha: masDias(hoy, 45), autor: 'Coord Prueba' });
    const ayer = await json('POST', '/api/jornadas', { comunidad: 'Huejuquilla', estado: 'Jalisco', fecha: masDias(hoy, -1), autor: 'Coord Prueba' });
    for (const x of [lejos, cerca, fuera, ayer]) expect(x.status).toBe(201);
    const j = await cerca.json() as any;
    expect(j).toMatchObject({ comunidad: 'San Martín Peras', estado: 'Oaxaca', municipio: 'San Martín Peras, Oaxaca', fecha: masDias(hoy, 4), equipo: ['Dra. Prueba', 'Enf. Prueba'], nota: 'Salida 6:00' });
    expect(j.id).toMatch(/^[0-9a-f-]{36}$/);
    ids.cerca = j.id; ids.lejos = (await lejos.json() as any).id; ids.fuera = (await fuera.json() as any).id;

    expect(await valkey.hget(`jornada:${j.id}`, 'comunidad')).toBe('San Martín Peras');
    expect(Number(await valkey.zscore('jornadas', j.id))).toBe(Date.parse(`${masDias(hoy, 4)}T00:00:00-06:00`));

    const bit = await get('/api/bitacora?limite=10');
    const prog = bit.filter((f: any) => f.tipo === 'jornada-programada');
    expect(prog).toHaveLength(4);
    expect(prog.find((f: any) => f.jornadaId === j.id)).toMatchObject({ autor: 'Coord Prueba', comunidad: 'San Martín Peras', pacienteId: null });
    // Sin nota ni equipo en la bitácora.
    expect(JSON.stringify(prog)).not.toContain('Salida');
    expect(JSON.stringify(prog)).not.toContain('Dra. Prueba');
  });

  it('lista desde hoy 30 días, ordenada por fecha, con pacientes previas y pendientes', async () => {
    const lista = await get('/api/jornadas');
    expect(lista.map((x: any) => x.id)).toEqual([ids.cerca, ids.lejos]);
    expect(lista[0]).toEqual({
      id: ids.cerca, comunidad: 'San Martín Peras', estado: 'Oaxaca', municipio: 'San Martín Peras, Oaxaca', fecha: masDias(hoy, 4),
      equipo: ['Dra. Prueba', 'Enf. Prueba'], nota: 'Salida 6:00', autor: 'Coord Prueba', creada: expect.any(String),
      pacientesPrevias: 2, estudiosPendientes: 2,
    });
    expect(lista[1]).toMatchObject({ comunidad: 'Metlatónoc', municipio: null, equipo: [], nota: null, pacientesPrevias: 0, estudiosPendientes: 0 });
    // Rango explícito: desde ayer, 60 días → las 4; desde dentro de 5 días, 10 días → solo la de 18 no entra.
    expect(await get(`/api/jornadas?desde=${masDias(hoy, -1)}&dias=60`)).toHaveLength(4);
    expect(await get(`/api/jornadas?desde=${masDias(hoy, 5)}&dias=10`)).toEqual([]);
    expect((await get(`/api/jornadas?desde=${masDias(hoy, 5)}&dias=14`)).map((x: any) => x.id)).toEqual([ids.lejos]);
  });

  it('cancela con autor en query o body; 404 si no existe', async () => {
    expect((await json('DELETE', `/api/jornadas/${ids.lejos}?autor=Coord%20Query`)).status).toBe(200);
    expect((await json('DELETE', `/api/jornadas/${ids.cerca}`, { autor: 'Coord Body' })).status).toBe(200);
    expect((await json('DELETE', `/api/jornadas/${ids.cerca}`, { autor: 'Coord Body' })).status).toBe(404);
    expect(await get('/api/jornadas')).toEqual([]);
    expect(await valkey.exists(`jornada:${ids.cerca}`)).toBe(0);
    const canc = (await get('/api/bitacora?limite=10')).filter((f: any) => f.tipo === 'jornada-cancelada');
    expect(canc.map((f: any) => [f.autor, f.jornadaId, f.comunidad])).toEqual([
      ['Coord Body', ids.cerca, 'San Martín Peras'],
      ['Coord Query', ids.lejos, 'Metlatónoc'],
    ]);
  });
});
