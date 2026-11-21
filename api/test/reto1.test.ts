// Reto 1 (definición oficial de EIRA): visitas, campos clínicos, actualizaciones
// con versión y conflictos, y bitácora. Valkey real en la DB 14 (se limpia).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.VALKEY_URL = process.env.VALKEY_URL_TEST_RETO1 ?? 'redis://localhost:6379/14';
process.env.CLAVE_DATOS = randomBytes(32).toString('base64');

const { default: app, valkey, cerrar, reglaSeguimiento } = await import('../src/index');
const { llavesBloque } = await import('../src/coincidencias');

const DIA = 24 * 60 * 60 * 1000;
const paciente = (o: Record<string, unknown>) => ({
  id: randomUUID(), folio: 'F' + Math.floor(Math.random() * 1e5), consentimiento: '2026-11-21T10:00:00Z',
  creadaPor: 'enfermeria-1', creada: '2026-11-21T10:00:00Z', comunidad: 'Tuxpan', ...o,
});
const estudio = (pacienteId: string, o: Record<string, unknown> = {}) => ({
  id: randomUUID(), pacienteId, tipo: 'mastografia', fecha: '2026-11-21', resultado: 'normal', registradoPor: 'medico-1', ...o,
});
const alta = (p: object) => ({ llave: randomUUID(), tipo: 'alta', paciente: p });
const est = (e: object) => ({ llave: randomUUID(), tipo: 'estudio', estudio: e });
const vis = (v: object) => ({ llave: randomUUID(), tipo: 'visita', visita: v });
const act = (a: object) => ({ llave: randomUUID(), tipo: 'actualizacion', actualizacion: a });

async function sync(eventos: object[], dispositivo = 'iphone-test') {
  const r = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dispositivo, eventos }) });
  expect(r.status).toBe(200);
  return r.json() as Promise<any>;
}
const get = async (ruta: string) => (await app.request(ruta)).json() as Promise<any>;
const post = (ruta: string, body?: object) => app.request(ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  expect(process.env.VALKEY_URL).toMatch(/\/14$/); // nunca borrar la DB de la demo
  await valkey.flushdb();
});
afterAll(async () => {
  await valkey.flushdb();
  await cerrar();
});

describe('visitas', () => {
  it('guarda la visita aparte, ordenada por fecha, y el estudio apunta a ella', async () => {
    const p = paciente({ nombre: 'Amparo', apellidoPaterno: 'Lira', edad: 48 });
    const v1 = { id: randomUUID(), pacienteId: p.id, fecha: '2025-03-10T09:00:00-06:00', comunidad: 'Tuxpan', motivo: 'jornada de tamizaje', registradaPor: 'enfermeria-1' };
    const v2 = { id: randomUUID(), pacienteId: p.id, fecha: '2026-11-21T10:30:00-06:00', comunidad: 'Tuxpan', registradaPor: 'enfermeria-2' };
    const e = estudio(p.id, { visitaId: v2.id });
    const r = await sync([alta(p), vis(v2), vis(v1), est(e)]);
    expect(r).toMatchObject({ aplicados: 4, repetidos: 0, conflictos: [] });

    const exp = await get(`/api/pacientes/${p.id}`);
    expect(exp.visitas.map((v: any) => v.id)).toEqual([v1.id, v2.id]);
    expect(exp.visitas[0]).toMatchObject({ motivo: 'jornada de tamizaje', registradaPor: 'enfermeria-1', comunidad: 'Tuxpan' });
    expect(exp.estudios[0].visitaId).toBe(v2.id);
    expect(exp.version).toBe(1);
    const lista = await get('/api/pacientes?comunidad=tuxpan');
    expect(lista.find((x: any) => x.id === p.id).visitas).toHaveLength(2);

    // fecha que no es ISO → 400
    const malo = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dispositivo: 'x', eventos: [vis({ ...v1, id: randomUUID(), fecha: 'ayer' })] }) });
    expect(malo.status).toBe(400);
  });

  it('unir mueve también las visitas', async () => {
    const a = paciente({ nombre: 'Rosario', apellidoPaterno: 'Gómez', apellidoMaterno: 'Luna', edad: 61, comunidad: 'Zacualpan' });
    const b = paciente({ nombre: 'Chayo', apellidoPaterno: 'Gomez', apellidoMaterno: 'Luna', edad: 61, comunidad: 'Zacualpan' });
    const vb = { id: randomUUID(), pacienteId: b.id, fecha: '2026-01-05T09:00:00Z', comunidad: 'Zacualpan', registradaPor: 'enf' };
    await sync([alta(a), alta(b), vis(vb)]);
    expect((await post('/api/duplicados/resolver', { a: a.id, b: b.id, decision: 'unir', autor: 'coord-1' })).status).toBe(200);
    const pa = await get(`/api/pacientes/${a.id}`);
    expect(pa.visitas).toHaveLength(1);
    expect(pa.visitas[0]).toMatchObject({ id: vb.id, pacienteId: a.id });
  });
});

describe('campos clínicos del formato de EIRA', () => {
  it('regla de seguimiento: BI-RADS 4/5 y anormal a 15 días, BI-RADS 3 a 6 meses', () => {
    expect(reglaSeguimiento({ resultado: 'pendiente', clasificacion: 'BI-RADS 4' })?.plazo).toBe('15-dias');
    expect(reglaSeguimiento({ resultado: 'normal', clasificacion: 'birads 5' })?.plazo).toBe('15-dias');
    expect(reglaSeguimiento({ resultado: 'anormal' })?.plazo).toBe('15-dias');
    expect(reglaSeguimiento({ resultado: 'pendiente', clasificacion: 'Bethesda: LSIL' })?.plazo).toBe('15-dias');
    expect(reglaSeguimiento({ resultado: 'normal', clasificacion: 'BI-RADS 3' })?.plazo).toBe('6-meses');
    expect(reglaSeguimiento({ resultado: 'normal', clasificacion: 'BI-RADS 2', conducta: 'rutina-1-anio' })).toBeNull();
    expect(reglaSeguimiento({ resultado: 'normal', clasificacion: 'Bethesda: NILM' })).toBeNull();
  });

  it('guarda clasificacion y conducta, y mete BI-RADS 4 y BI-RADS 3 al seguimiento con su plazo', async () => {
    const p = paciente({ nombre: 'Leticia', apellidoPaterno: 'Ocampo', edad: 52, comunidad: 'Ahuacatlan', entidadNacimiento: 'Puebla', idEira: 'EIRA-00123' });
    const e4 = estudio(p.id, { resultado: 'pendiente', clasificacion: 'BI-RADS 4', conducta: 'referencia', fecha: '2026-11-01' });
    const e3 = estudio(p.id, { resultado: 'normal', clasificacion: 'BI-RADS 3', conducta: 'evaluacion-6-meses', fecha: '2026-11-01' });
    const e1 = estudio(p.id, { resultado: 'normal', clasificacion: 'BI-RADS 1', conducta: 'rutina-1-anio' });
    await sync([alta(p), est(e4), est(e3), est(e1)]);

    const exp = await get(`/api/pacientes/${p.id}`);
    expect(exp).toMatchObject({ entidadNacimiento: 'Puebla', idEira: 'EIRA-00123' });
    expect(exp.estudios.find((e: any) => e.id === e4.id)).toMatchObject({ clasificacion: 'BI-RADS 4', conducta: 'referencia' });

    const seg = await get('/api/seguimiento?comunidad=ahuacatlan');
    expect(seg.map((s: any) => s.estudioId)).toEqual([e4.id, e3.id]);
    expect(seg[0]).toMatchObject({ motivo: 'BI-RADS 4' });
    expect(Date.parse(seg[0].fechaLimite) - Date.parse('2026-11-01')).toBe(15 * DIA);
    expect(seg[1]).toMatchObject({ motivo: 'BI-RADS 3', fechaLimite: '2027-05-01T00:00:00.000Z' });

    const malo = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dispositivo: 'x', eventos: [est(estudio(p.id, { conducta: 'otra-cosa' }))] }) });
    expect(malo.status).toBe(400);
  });

  it('distinta entidad de nacimiento: el par entra a la cola con 0.1 menos y la razón', async () => {
    const base = { nombre: 'Elvira', apellidoPaterno: 'Santos', apellidoMaterno: 'Rey', nacimiento: '1970-02-02', comunidad: 'Cuetzalan' };
    const a = paciente({ ...base, entidadNacimiento: 'Puebla' });
    const b = paciente({ ...base, entidadNacimiento: 'Veracruz' });
    const c = paciente({ ...base, nombre: 'Elbira' }); // sin entidad: sin ajuste
    await sync([alta(a)]);
    const rb = await sync([alta(b)]);
    expect(rb.posiblesDuplicados[0]).toMatchObject({ con: a.id, puntaje: 0.9 });
    expect(rb.posiblesDuplicados[0].razones).toContain('distinta entidad de nacimiento');
    const rc = await sync([alta(c)]);
    const conA = rc.posiblesDuplicados.find((d: any) => d.con === a.id);
    expect(conA.razones).not.toContain('distinta entidad de nacimiento');
    const cola = await get('/api/duplicados');
    const par = cola.find((d: any) => [d.a.id, d.b.id].sort().join() === [a.id, b.id].sort().join());
    expect(par.puntaje).toBeCloseTo(0.9, 3);
    expect(par.razones).toContain('distinta entidad de nacimiento');
  });
});

describe('actualizaciones con versión y conflictos', () => {
  it('versionBase igual: aplica solo esos campos y sube la versión', async () => {
    const p = paciente({ nombre: 'Ofelia', apellidoPaterno: 'Rangel', edad: 39, comunidad: 'Huauchinango' });
    await sync([alta(p)]);
    const r = await sync([act({ pacienteId: p.id, campos: { apellidoMaterno: 'Durán', idEira: 'EIRA-9' }, versionBase: 1, autor: 'enfermeria-3' })]);
    expect(r).toMatchObject({ aplicados: 1, conflictos: [] });
    const exp = await get(`/api/pacientes/${p.id}`);
    expect(exp).toMatchObject({ version: 2, apellidoMaterno: 'Durán', idEira: 'EIRA-9', nombre: 'Ofelia', edad: 39 });
    // los índices siguen el cambio: ya está en el bloque del apellido materno nuevo
    // (se revisa el set directo: valkey-search solo indexa la DB 0 y esta prueba usa la 14)
    const bloqueAm = llavesBloque({ ...p, apellidoMaterno: 'Durán' }).find((b) => b.startsWith('am:'))!;
    expect(await valkey.sismember(`bloque:${bloqueAm}`, p.id)).toBe(1);
  });

  it('cambiar la comunidad la mueve de lista', async () => {
    const p = paciente({ nombre: 'Gloria', apellidoPaterno: 'Peña', edad: 70, comunidad: 'Tlacuilotepec' });
    await sync([alta(p), act({ pacienteId: p.id, campos: { comunidad: 'Naupan' }, versionBase: 1, autor: 'enf' })]);
    expect((await get('/api/pacientes?comunidad=tlacuilotepec')).map((x: any) => x.id)).not.toContain(p.id);
    expect((await get('/api/pacientes?comunidad=naupan')).map((x: any) => x.id)).toContain(p.id);
  });

  it('versionBase vieja: no se aplica, va a conflictos y la coordinadora decide', async () => {
    const p = paciente({ nombre: 'Marta', apellidoPaterno: 'Islas', edad: 45, comunidad: 'Zihuateutla' });
    await sync([alta(p)]);
    // Dos teléfonos editan sin señal desde la versión 1. Llega primero el A.
    await sync([act({ pacienteId: p.id, campos: { edad: 46 }, versionBase: 1, autor: 'enf-A' })], 'iphone-A');
    const rB = await sync([act({ pacienteId: p.id, campos: { edad: 47, municipio: 'Zihuateutla' }, versionBase: 1, autor: 'enf-B' })], 'iphone-B');
    expect(rB.aplicados).toBe(1);
    expect(rB.conflictos).toEqual([{ pacienteId: p.id, campos: ['edad', 'municipio'] }]);
    expect(await get(`/api/pacientes/${p.id}`)).toMatchObject({ version: 2, edad: 46 });
    expect((await get(`/api/pacientes/${p.id}`)).municipio).toBeUndefined();

    const lista = await get('/api/conflictos');
    const cf = lista.find((x: any) => x.pacienteId === p.id);
    expect(cf).toMatchObject({ autor: 'enf-B', dispositivo: 'iphone-B', versionBase: 1, versionActual: 2, motivo: 'version-distinta', paciente: { id: p.id } });
    expect(cf.campos).toEqual([
      { campo: 'edad', propuesto: 47, actual: 46, alRecibir: 46 },
      { campo: 'municipio', propuesto: 'Zihuateutla', actual: null, alRecibir: null },
    ]);
    expect((await get('/api/estadisticas')).conflictosPendientes).toBeGreaterThanOrEqual(1);

    const ok = await post(`/api/conflictos/${cf.id}/resolver`, { decision: 'aceptar', autor: 'coord-1' });
    expect(await ok.json()).toEqual({ ok: true, version: 3 });
    expect(await get(`/api/pacientes/${p.id}`)).toMatchObject({ version: 3, edad: 47, municipio: 'Zihuateutla' });
    expect((await get('/api/conflictos')).some((x: any) => x.id === cf.id)).toBe(false);
    expect((await post(`/api/conflictos/${cf.id}/resolver`, { decision: 'aceptar' })).status).toBe(404);
  });

  it('rechazar deja a la paciente como estaba', async () => {
    const p = paciente({ nombre: 'Irma', apellidoPaterno: 'Toledo', edad: 58, comunidad: 'Jopala' });
    await sync([alta(p)]);
    const r = await sync([act({ pacienteId: p.id, campos: { nombre: 'Irene' }, versionBase: 5, autor: 'enf' })]);
    expect(r.conflictos).toHaveLength(1);
    const cf = (await get('/api/conflictos')).find((x: any) => x.pacienteId === p.id);
    expect((await post(`/api/conflictos/${cf.id}/resolver`, { decision: 'rechazar' })).status).toBe(200);
    expect(await get(`/api/pacientes/${p.id}`)).toMatchObject({ nombre: 'Irma', version: 1 });
    expect((await post(`/api/conflictos/${cf.id}/resolver`, { decision: 'quien-sabe' })).status).toBe(400);
  });

  it('la llave repetida no vuelve a aplicar ni a crear conflicto', async () => {
    const p = paciente({ nombre: 'Noemí', apellidoPaterno: 'Vera', edad: 30, comunidad: 'Tlaxco' });
    const ev = act({ pacienteId: p.id, campos: { edad: 31 }, versionBase: 1, autor: 'enf' });
    await sync([alta(p), ev]);
    const r2 = await sync([ev]);
    expect(r2).toMatchObject({ aplicados: 0, repetidos: 1, conflictos: [] });
    expect((await get(`/api/pacientes/${p.id}`)).version).toBe(2);
  });
});

describe('bitácora', () => {
  it('registra quién, qué, cuándo y de qué paciente, sin datos clínicos', async () => {
    const p = paciente({ nombre: 'Cecilia', apellidoPaterno: 'Arce', edad: 41, comunidad: 'Chignahuapan', creadaPor: 'enf-9' });
    const v = { id: randomUUID(), pacienteId: p.id, fecha: '2026-11-21T11:00:00Z', comunidad: 'Chignahuapan', registradaPor: 'enf-9' };
    const e = estudio(p.id, { visitaId: v.id, resultado: 'anormal', clasificacion: 'BI-RADS 5', nota: 'masa espiculada 2 cm', registradoPor: 'med-4' });
    await sync([alta(p), vis(v), est(e), act({ pacienteId: p.id, campos: { idEira: 'EIRA-77' }, versionBase: 1, autor: 'enf-9' }),
      act({ pacienteId: p.id, campos: { edad: 42 }, versionBase: 1, autor: 'enf-10' })], 'iphone-bit');
    const cf = (await get('/api/conflictos')).find((x: any) => x.pacienteId === p.id);
    await post(`/api/conflictos/${cf.id}/resolver`, { decision: 'rechazar', autor: 'coord-2' });
    await post(`/api/seguimiento/${e.id}/atendido`, { autor: 'med-4' });

    const b = await get(`/api/bitacora?pacienteId=${p.id}&limite=50`);
    expect(b.map((x: any) => x.tipo)).toEqual(['seguimiento-atendido', 'conflicto-rechazar', 'conflicto', 'actualizacion', 'estudio', 'visita', 'alta']);
    expect(b.every((x: any) => x.pacienteId === p.id && x.autor && !Number.isNaN(Date.parse(x.cuando)))).toBe(true);
    expect(b.find((x: any) => x.tipo === 'alta')).toMatchObject({ autor: 'enf-9', dispositivo: 'iphone-bit' });
    expect(b.find((x: any) => x.tipo === 'estudio')).toMatchObject({ autor: 'med-4', estudioId: e.id, visitaId: v.id });
    expect(b.find((x: any) => x.tipo === 'actualizacion')).toMatchObject({ campos: ['idEira'], version: 2 });
    expect(b.find((x: any) => x.tipo === 'conflicto')).toMatchObject({ autor: 'enf-10', campos: ['edad'], conflictoId: cf.id });
    expect(b.find((x: any) => x.tipo === 'conflicto-rechazar')).toMatchObject({ autor: 'coord-2' });
    expect(b.find((x: any) => x.tipo === 'seguimiento-atendido')).toMatchObject({ autor: 'med-4', estudioId: e.id });
    const texto = JSON.stringify(b);
    for (const prohibido of ['BI-RADS', 'espiculada', 'anormal', 'EIRA-77']) expect(texto).not.toContain(prohibido);

    expect(await get(`/api/bitacora?pacienteId=${p.id}&limite=2`)).toHaveLength(2);
    expect((await get('/api/bitacora?limite=3')).length).toBe(3);
    expect((await app.request('/api/bitacora?limite=0')).status).toBe(400);
  });

  it('unir y separar quedan con las dos pacientes y la coordinadora', async () => {
    const a = paciente({ nombre: 'Elena', apellidoPaterno: 'Ruiz', apellidoMaterno: 'Paz', edad: 50, comunidad: 'Coyutla' });
    const b = paciente({ nombre: 'Elena', apellidoPaterno: 'Ruiz', apellidoMaterno: 'Paz', edad: 51, comunidad: 'Coyutla' });
    await sync([alta(a), alta(b)]);
    await post('/api/duplicados/resolver', { a: a.id, b: b.id, decision: 'separar', autor: 'coord-3' });
    const deB = await get(`/api/bitacora?pacienteId=${b.id}`);
    expect(deB[0]).toMatchObject({ tipo: 'duplicado-separar', pacienteId: a.id, otraPacienteId: b.id, autor: 'coord-3' });
  });
});
