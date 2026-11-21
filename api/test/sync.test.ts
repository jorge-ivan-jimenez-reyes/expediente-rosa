// Pruebas de la API contra un Valkey real, en la DB 15 para no tocar los datos
// de la demo (DB 0). Requiere `docker compose up valkey`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.VALKEY_URL = process.env.VALKEY_URL_TEST ?? 'redis://localhost:6379/15';
process.env.CLAVE_DATOS = randomBytes(32).toString('base64');

const { default: app, valkey, cerrar, DIAS_SEGUIMIENTO } = await import('../src/index');

const DIA = 24 * 60 * 60 * 1000;
const fechaHace = (dias: number) => new Date(Date.now() - dias * DIA).toISOString().slice(0, 10);
const paciente = (o: Record<string, unknown>) => ({
  id: randomUUID(), folio: 'F' + Math.floor(Math.random() * 1e5), consentimiento: '2026-11-21T10:00:00Z',
  creadaPor: 'enfermeria-1', creada: '2026-11-21T10:00:00Z', comunidad: 'Tuxpan', ...o,
});
const estudio = (pacienteId: string, o: Record<string, unknown> = {}) => ({
  id: randomUUID(), pacienteId, tipo: 'mastografia', fecha: fechaHace(0), resultado: 'normal', registradoPor: 'medico-1', ...o,
});
const alta = (p: object) => ({ llave: randomUUID(), tipo: 'alta', paciente: p });
const est = (e: object) => ({ llave: randomUUID(), tipo: 'estudio', estudio: e });

async function sync(eventos: object[]) {
  const r = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dispositivo: 'test', eventos }) });
  expect(r.status).toBe(200);
  return r.json() as Promise<{ aplicados: number; repetidos: number; posiblesDuplicados: { pacienteId: string; con: string }[] }>;
}
const get = async (ruta: string) => (await app.request(ruta)).json() as Promise<any>;
const post = (ruta: string, body?: object) => app.request(ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  expect(process.env.VALKEY_URL).toMatch(/\/15$/); // nunca borrar la DB de la demo
  await valkey.flushdb();
});
afterAll(async () => {
  await valkey.flushdb();
  await cerrar();
});

describe('sync', () => {
  it('es idempotente: repetir el mismo envío no duplica', async () => {
    const eventos = [alta(paciente({ nombre: 'Petra', apellidoPaterno: 'Solís', edad: 40 })), alta(paciente({ nombre: 'Inés', apellidoPaterno: 'Mora', edad: 52 }))];
    const r1 = await sync(eventos);
    expect(r1).toMatchObject({ aplicados: 2, repetidos: 0 });
    const r2 = await sync(eventos);
    expect(r2).toMatchObject({ aplicados: 0, repetidos: 2 });
    expect(await valkey.scard('pacientes')).toBe(2);
  });

  it('detecta a la misma señora escrita distinto y la manda a la cola', async () => {
    const a = paciente({ nombre: 'María Guadalupe', apellidoPaterno: 'Hernández', apellidoMaterno: 'Velázquez', nacimiento: '1979-03-02' });
    const b = paciente({ nombre: 'Ma. Lupe', apellidoPaterno: 'Hdz', apellidoMaterno: 'Belasquez', edad: 47 });
    await sync([alta(a)]);
    const r = await sync([alta(b)]);
    expect(r.posiblesDuplicados).toHaveLength(1);
    expect(r.posiblesDuplicados[0]).toMatchObject({ pacienteId: b.id, con: a.id });
    const cola = await get('/api/duplicados');
    expect(cola.some((d: any) => [d.a.id, d.b.id].sort().join() === [a.id, b.id].sort().join())).toBe(true);
  });

  it('unir mueve los estudios (y su seguimiento) a la paciente que queda', async () => {
    const a = paciente({ nombre: 'Rosario', apellidoPaterno: 'Gómez', apellidoMaterno: 'Luna', edad: 61, comunidad: 'Zacualpan' });
    const b = paciente({ nombre: 'Chayo', apellidoPaterno: 'Gomez', apellidoMaterno: 'Luna', edad: 61, comunidad: 'Zacualpan' });
    const eb = estudio(b.id, { resultado: 'anormal', nota: 'nódulo 1 cm' });
    const r = await sync([alta(a), alta(b), est(estudio(a.id)), est(eb)]);
    expect(r.posiblesDuplicados).toHaveLength(1);
    expect((await post('/api/duplicados/resolver', { a: a.id, b: b.id, decision: 'unir' })).status).toBe(200);

    const pa = await get(`/api/pacientes/${a.id}`);
    expect(pa.estudios).toHaveLength(2);
    expect(pa.estudios.every((e: any) => e.pacienteId === a.id)).toBe(true);
    expect(pa.estudios.find((e: any) => e.id === eb.id).nota).toBe('nódulo 1 cm');
    expect((await get(`/api/pacientes/${b.id}`)).fusionadaEn).toBe(a.id);
    expect((await get('/api/pacientes?comunidad=zacualpan')).map((p: any) => p.id)).toEqual([a.id]);
    const seg = (await get('/api/seguimiento')).find((s: any) => s.estudioId === eb.id);
    expect(seg.paciente.id).toBe(a.id);
  });

  it('separar las marca como distintas y ya no vuelven a la cola', async () => {
    const madre = paciente({ nombre: 'Elena', apellidoPaterno: 'Ruiz', apellidoMaterno: 'Paz', edad: 50, comunidad: 'Coyutla' });
    const otra = paciente({ nombre: 'Elena', apellidoPaterno: 'Ruiz', apellidoMaterno: 'Paz', edad: 51, comunidad: 'Coyutla' });
    const r = await sync([alta(madre), alta(otra)]);
    expect(r.posiblesDuplicados).toHaveLength(1);
    await post('/api/duplicados/resolver', { a: madre.id, b: otra.id, decision: 'separar' });
    expect(await valkey.sismember(`distintas:${madre.id}`, otra.id)).toBe(1);
    expect((await get('/api/duplicados')).some((d: any) => d.a.id === madre.id || d.b.id === madre.id)).toBe(false);
  });
});

describe('seguimiento de anormales (C1)', () => {
  it('lista vencidos primero con fecha límite a +15 días y se cierra con atendido', async () => {
    const p = paciente({ nombre: 'Lucía', apellidoPaterno: 'Cano', edad: 44, comunidad: 'Huehuetla' });
    const viejo = estudio(p.id, { resultado: 'anormal', fecha: fechaHace(20), tipo: 'papanicolaou' });
    const nuevo = estudio(p.id, { resultado: 'anormal', fecha: fechaHace(1) });
    const normal = estudio(p.id, { resultado: 'normal' });
    await sync([alta(p), est(nuevo), est(viejo), est(normal)]);

    const lista = await get('/api/seguimiento?comunidad=huehuetla');
    expect(lista.map((s: any) => s.estudioId)).toEqual([viejo.id, nuevo.id]);
    expect(lista[0]).toMatchObject({ vencido: true, tipo: 'papanicolaou', paciente: { id: p.id, folio: p.folio } });
    expect(lista[1].vencido).toBe(false);
    expect(Date.parse(lista[1].fechaLimite) - Date.parse(nuevo.fecha)).toBe(DIAS_SEGUIMIENTO * DIA);

    expect((await post(`/api/seguimiento/${viejo.id}/atendido`)).status).toBe(200);
    expect((await get('/api/seguimiento?comunidad=huehuetla')).map((s: any) => s.estudioId)).toEqual([nuevo.id]);
    expect((await post(`/api/seguimiento/${viejo.id}/atendido`)).status).toBe(404);
  });
});

describe('cifrado en reposo (C3)', () => {
  it('nota y consentimiento quedan cifrados en Valkey y la API los devuelve en claro', async () => {
    const p = paciente({ nombre: 'Sara', apellidoPaterno: 'Vela', edad: 38, comunidad: 'Olintla' });
    const e = estudio(p.id, { nota: 'BI-RADS 2' });
    await sync([alta(p), est(e)]);

    const crudo = await valkey.hget(`paciente:${p.id}`, 'consentimiento');
    expect(crudo).toMatch(/^enc:v1:/);
    const notaCruda = JSON.parse((await valkey.lindex(`paciente:${p.id}:estudios`, 0))!).nota;
    expect(notaCruda).toMatch(/^enc:v1:/);
    expect(notaCruda).not.toContain('BI-RADS');

    const api = await get(`/api/pacientes/${p.id}`);
    expect(api.consentimiento).toBe(p.consentimiento);
    expect(api.estudios[0].nota).toBe('BI-RADS 2');
  });
});

describe('tablero en vivo (C2)', () => {
  it('cuenta altas, estudios por tipo y duplicados del día', async () => {
    const c = 'Tlaola';
    const a = paciente({ nombre: 'Josefina', apellidoPaterno: 'Báez', apellidoMaterno: 'Ortiz', edad: 55, comunidad: c });
    const b = paciente({ nombre: 'Josefina', apellidoPaterno: 'Vaez', apellidoMaterno: 'Ortiz', edad: 55, comunidad: c });
    await sync([alta(a), alta(b), est(estudio(a.id, { tipo: 'ultrasonido', resultado: 'anormal' })), est(estudio(a.id))]);
    const t = await get(`/api/jornada/${c}`);
    expect(t).toMatchObject({ comunidad: 'tlaola', altas: 2, estudios: 2, anormales: 1, duplicados: 1, porTipo: { ultrasonido: 1, mastografia: 1 } });
  });

  it('manda por SSE el estado y después cada alta en cuanto llega', async () => {
    const c = 'Pantepec';
    const ctrl = new AbortController();
    const r = await app.request(`/api/jornada/${c}/en-vivo`, { signal: ctrl.signal });
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const lector = r.body!.getReader();
    const dec = new TextDecoder();
    let texto = '';
    const leerHasta = async (patron: RegExp) => {
      while (!patron.test(texto)) {
        const { value, done } = await lector.read();
        if (done) break;
        texto += dec.decode(value);
      }
    };
    await leerHasta(/event: estado/);
    await new Promise((res) => setTimeout(res, 50)); // que la suscripción quede activa
    const p = paciente({ nombre: 'Aurora', apellidoPaterno: 'Nava', edad: 33, comunidad: c });
    await sync([alta(p)]);
    await leerHasta(/event: alta[\s\S]*\n\n/);
    const datos = JSON.parse(texto.split('event: alta')[1].match(/data: (.*)/)![1]);
    expect(datos).toMatchObject({ tipo: 'alta', pacienteId: p.id, conteo: { comunidad: 'pantepec', altas: 1 } });
    ctrl.abort();
    await lector.cancel().catch(() => {});
  });
});

describe('buscar (C4, motor sin valkey-search)', () => {
  it('encuentra a la paciente escrita distinto usando los sets de bloque', async () => {
    const p = paciente({ nombre: 'Concepción', apellidoPaterno: 'Villegas', apellidoMaterno: 'Soto', nacimiento: '1970-05-05', comunidad: 'Xicotepec' });
    await sync([alta(p)]);
    const r = await get('/api/buscar?nombre=Concha&apellidoPaterno=Billegas&apellidoMaterno=Zoto&edad=56&comunidad=Xicotepec');
    expect(r.motor).toBe('bloques');
    expect(r.resultados[0]).toMatchObject({ paciente: { id: p.id }, posible: true });
    expect((await app.request('/api/buscar?nombre=Ana')).status).toBe(400);
  });
});
