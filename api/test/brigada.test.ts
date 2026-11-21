// Brigada: estado de la jornada, etapa del estudio, cola del patólogo,
// interpretación, aviso, resumen y panel. Valkey real en la DB 13 (se limpia).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.VALKEY_URL = process.env.VALKEY_URL_TEST_BRIGADA ?? 'redis://localhost:6379/13';
process.env.CLAVE_DATOS = randomBytes(32).toString('base64');

const { default: app, valkey, cerrar, etapaDe, estadoDeMunicipio, preparar } = await import('../src/index');

const DIA = 24 * 60 * 60 * 1000;
const fechaHace = (dias: number) => new Date(Date.now() - dias * DIA).toISOString().slice(0, 10);
const paciente = (o: Record<string, unknown>) => ({
  id: randomUUID(), folio: 'F' + Math.floor(Math.random() * 1e5), consentimiento: '2026-11-21T10:00:00Z',
  creadaPor: 'enf-1', creada: '2026-11-21T10:00:00Z', comunidad: 'Tuxpan', ...o,
});
const estudio = (pacienteId: string, o: Record<string, unknown> = {}) => ({
  id: randomUUID(), pacienteId, tipo: 'papanicolaou', fecha: fechaHace(0), resultado: 'pendiente', registradoPor: 'med-1', ...o,
});
const visita = (pacienteId: string, o: Record<string, unknown> = {}) => ({
  id: randomUUID(), pacienteId, fecha: '2026-11-18T09:00:00-06:00', comunidad: 'Huejuquilla', registradaPor: 'enf-1', ...o,
});
const alta = (p: object) => ({ llave: randomUUID(), tipo: 'alta', paciente: p });
const est = (e: object) => ({ llave: randomUUID(), tipo: 'estudio', estudio: e });
const vis = (v: object) => ({ llave: randomUUID(), tipo: 'visita', visita: v });

async function sync(eventos: object[]) {
  const r = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dispositivo: 'test', eventos }) });
  expect(r.status).toBe(200);
  return r.json() as Promise<any>;
}
const get = async (ruta: string) => (await app.request(ruta)).json() as Promise<any>;
const post = (ruta: string, body?: object) => app.request(ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  expect(process.env.VALKEY_URL).toMatch(/\/13$/); // nunca borrar la DB de la demo
  await valkey.flushdb();
});
afterAll(async () => {
  await valkey.flushdb();
  await cerrar();
});

describe('reglas', () => {
  it('etapa deducida y estado desde el municipio', () => {
    expect(etapaDe({ tipo: 'papanicolaou', resultado: 'pendiente' })).toBe('en-laboratorio');
    expect(etapaDe({ tipo: 'mastografia', resultado: 'pendiente' })).toBe('tomado');
    expect(etapaDe({ tipo: 'papanicolaou', resultado: 'anormal' })).toBe('interpretado');
    expect(etapaDe({ tipo: 'papanicolaou', resultado: 'pendiente', etapa: 'tomado' })).toBe('tomado');
    expect(estadoDeMunicipio('San Martín Peras, Oaxaca')).toBe('Oaxaca');
    expect(estadoDeMunicipio('Huejuquilla el Alto')).toBeUndefined();
  });
});

describe('patología', () => {
  const ana = paciente({ nombre: 'Ana', apellidoPaterno: 'Robles', apellidoMaterno: 'Díaz', edad: 40, comunidad: 'Huejuquilla', municipio: 'Huejuquilla el Alto, Jalisco' });
  const bea = paciente({ nombre: 'Beatriz', apellidoPaterno: 'Quiroz', edad: 52, comunidad: 'Metlatónoc', municipio: 'Metlatónoc' });
  const vBea = visita(bea.id, { comunidad: 'Metlatónoc', estado: 'Guerrero', jornada: 'Metlatónoc · nov 2026' });
  const papViejo = estudio(ana.id, { fecha: fechaHace(9) });
  const papNuevo = estudio(bea.id, { fecha: fechaHace(2), visitaId: vBea.id });
  const masto = estudio(ana.id, { tipo: 'mastografia' });

  it('cola ordenada por espera, con estado de la visita o del municipio, y filtros', async () => {
    const r = await sync([alta(ana), alta(bea), vis(vBea), est(papNuevo), est(papViejo), est(masto)]);
    expect(r.aplicados).toBe(6);
    const cola = await get('/api/patologia');
    expect(cola.map((x: any) => x.estudio.id)).toEqual([papViejo.id, papNuevo.id]);
    expect(cola[0]).toMatchObject({
      estudio: { id: papViejo.id, tipo: 'papanicolaou', fecha: papViejo.fecha, etapa: 'en-laboratorio' },
      paciente: { id: ana.id, folio: ana.folio, nombre: 'Ana', apellidoPaterno: 'Robles', apellidoMaterno: 'Díaz', edad: 40, comunidad: 'Huejuquilla' },
      estado: 'Jalisco', diasEsperando: 9,
    });
    expect(cola[1]).toMatchObject({ estado: 'Guerrero', diasEsperando: 2 });
    expect((await get('/api/patologia?estado=guerrero')).map((x: any) => x.estudio.id)).toEqual([papNuevo.id]);
    expect(await get('/api/patologia?comunidad=metlatonoc')).toHaveLength(1);
    // La etapa se guarda y sale en el expediente; la visita trae estado y jornada.
    const exp = await get(`/api/pacientes/${bea.id}`);
    expect(exp.estudios[0].etapa).toBe('en-laboratorio');
    expect(exp.visitas[0]).toMatchObject({ estado: 'Guerrero', jornada: 'Metlatónoc · nov 2026' });
    expect(await valkey.zscore('patologia:pendientes', papViejo.id)).not.toBeNull();
  });

  it('interpretación anormal: sale de la cola, entra a seguimiento y la bitácora no lleva datos clínicos', async () => {
    const r = await post(`/api/estudios/${papViejo.id}/interpretacion`, { resultado: 'anormal', clasificacion: 'LSIL', nota: 'Repetir en 6 meses', patologo: 'Dra. Patóloga', cedula: '1234567' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, seguimiento: true });
    expect((await get('/api/patologia')).map((x: any) => x.estudio.id)).toEqual([papNuevo.id]);
    const e = (await get(`/api/pacientes/${ana.id}`)).estudios.find((x: any) => x.id === papViejo.id);
    expect(e).toMatchObject({ resultado: 'anormal', clasificacion: 'LSIL', nota: 'Repetir en 6 meses', etapa: 'interpretado', interpretadoPor: 'Dra. Patóloga', cedula: '1234567' });
    expect(Date.parse(e.interpretadoEn)).toBeGreaterThan(Date.now() - 60_000);
    // La nota sigue cifrada en reposo.
    expect((await valkey.lrange(`paciente:${ana.id}:estudios`, 0, -1)).join()).not.toContain('Repetir');
    const seg = (await get('/api/seguimiento')).find((x: any) => x.estudioId === papViejo.id);
    expect(seg).toMatchObject({ motivo: 'Bethesda LSIL', vencido: false });
    expect(seg.diasRestantes).toBeGreaterThanOrEqual(14);
    const bit = (await get(`/api/bitacora?pacienteId=${ana.id}`)).find((x: any) => x.tipo === 'interpretacion');
    expect(bit).toMatchObject({ autor: 'Dra. Patóloga', pacienteId: ana.id, estudioId: papViejo.id });
    expect(JSON.stringify(bit)).not.toMatch(/LSIL|anormal|Repetir|1234567/);
    // Segunda vez → 409; estudio que no existe → 404; cuerpo malo → 400.
    expect((await post(`/api/estudios/${papViejo.id}/interpretacion`, { resultado: 'normal', patologo: 'otro' })).status).toBe(409);
    expect((await post(`/api/estudios/${randomUUID()}/interpretacion`, { resultado: 'normal', patologo: 'x' })).status).toBe(404);
    expect((await post(`/api/estudios/${papNuevo.id}/interpretacion`, { resultado: 'quizá', patologo: 'x' })).status).toBe(400);
  });

  it('interpretación Negativa no entra a seguimiento; avisado cambia la etapa y deja bitácora', async () => {
    const r = await post(`/api/estudios/${papNuevo.id}/interpretacion`, { resultado: 'normal', clasificacion: 'Negativa', patologo: 'Dr. Patólogo' });
    expect(await r.json()).toMatchObject({ ok: true, seguimiento: false });
    expect((await get('/api/seguimiento')).some((x: any) => x.estudioId === papNuevo.id)).toBe(false);
    expect(await get('/api/patologia')).toEqual([]);

    expect((await post(`/api/estudios/${masto.id}/avisado`, { autor: 'enf-1' })).status).toBe(409); // aún sin resultado
    const a = await post(`/api/estudios/${papNuevo.id}/avisado`, { autor: 'enf-1' });
    expect(a.status).toBe(200);
    expect((await get(`/api/pacientes/${bea.id}`)).estudios[0]).toMatchObject({ etapa: 'avisado', avisadoPor: 'enf-1' });
    expect((await get(`/api/bitacora?pacienteId=${bea.id}`))[0]).toMatchObject({ tipo: 'avisado', autor: 'enf-1', estudioId: papNuevo.id });
    expect((await post(`/api/estudios/${randomUUID()}/avisado`, { autor: 'x' })).status).toBe(404);
  });

  it('estudios viejos sin etapa: se deducen al leer y preparar() los mete a la cola', async () => {
    const p = paciente({ nombre: 'Celia', apellidoPaterno: 'Urbina', edad: 33, municipio: 'Tuxpan, Michoacán' });
    await sync([alta(p)]);
    const viejo = { id: randomUUID(), pacienteId: p.id, tipo: 'papanicolaou', fecha: fechaHace(5), resultado: 'pendiente', registradoPor: 'med-1' };
    await valkey.rpush(`paciente:${p.id}:estudios`, JSON.stringify(viejo)); // como si fuera de antes
    expect((await get(`/api/pacientes/${p.id}`)).estudios[0].etapa).toBe('en-laboratorio');
    await preparar();
    const fila = (await get('/api/patologia')).find((x: any) => x.estudio.id === viejo.id);
    expect(fila).toMatchObject({ estado: 'Michoacán', diasEsperando: 5 });
    expect((await post(`/api/estudios/${viejo.id}/interpretacion`, { resultado: 'normal', patologo: 'x' })).status).toBe(200);
  });
});

describe('resumen', () => {
  it('personas únicas por estado y comunidad; las fusionadas no cuentan y el par pendiente sí', async () => {
    await valkey.flushdb();
    const jal = { comunidad: 'Huejuquilla', municipio: 'Huejuquilla el Alto, Jalisco' };
    const a = paciente({ nombre: 'Yolanda', apellidoPaterno: 'Sánchez', apellidoMaterno: 'Mora', nacimiento: '1981-02-14', ...jal });
    const b = paciente({ nombre: 'Yola', apellidoPaterno: 'Sanches', apellidoMaterno: 'Mora', nacimiento: '1981-02-14', ...jal }); // par pendiente
    const c = paciente({ nombre: 'Rosario', apellidoPaterno: 'Gómez', apellidoMaterno: 'Luna', edad: 61, comunidad: 'Metlatónoc' });
    const d = paciente({ nombre: 'Chayo', apellidoPaterno: 'Gomez', apellidoMaterno: 'Luna', edad: 61, comunidad: 'Metlatónoc' }); // se une a c
    const e = paciente({ nombre: 'Teodora', apellidoPaterno: 'Bautista', edad: 63, comunidad: 'San Martín Peras' }); // sin municipio ni visita
    const vc = visita(c.id, { comunidad: 'Metlatónoc', estado: 'Guerrero' });
    const r = await sync([
      alta(a), alta(b), alta(c), alta(d), alta(e), vis(vc),
      est(estudio(a.id, { tipo: 'mastografia', resultado: 'anormal' })),
      est(estudio(b.id)),
      est(estudio(c.id, { visitaId: vc.id })),
      est(estudio(d.id, { tipo: 'exploracion', resultado: 'normal' })),
      est(estudio(e.id, { tipo: 'ultrasonido', resultado: 'normal' })),
    ]);
    expect(r.posiblesDuplicados.length).toBe(2);
    expect((await post('/api/duplicados/resolver', { a: c.id, b: d.id, decision: 'unir' })).status).toBe(200);

    const s = await get('/api/resumen');
    expect(Date.parse(s.corte)).toBeGreaterThan(0);
    expect(s).toMatchObject({
      filtros: {}, personasUnicas: 4, visitas: 1,
      estudios: {
        total: 5,
        porTipo: { mastografia: 1, ultrasonido: 1, papanicolaou: 2, exploracion: 1 },
        porResultado: { normal: 2, anormal: 1, pendiente: 2 },
        porEtapa: { tomado: 0, 'en-laboratorio': 2, interpretado: 3, avisado: 0 },
      },
      anormales: 1, pendientesPatologia: 2, duplicadosPendientes: 1,
    });
    const porEstado = Object.fromEntries(s.porEstado.map((g: any) => [g.estado, g]));
    expect(porEstado.Jalisco).toEqual({ estado: 'Jalisco', personas: 2, estudios: 2, anormales: 1, pendientesPatologia: 1 });
    expect(porEstado.Guerrero).toEqual({ estado: 'Guerrero', personas: 1, estudios: 2, anormales: 0, pendientesPatologia: 1 });
    expect(porEstado['Sin estado']).toMatchObject({ personas: 1, estudios: 1 });
    expect(s.porComunidad[0]).toEqual({ comunidad: 'Huejuquilla', estado: 'Jalisco', personas: 2, estudios: 2, anormales: 1, pendientesPatologia: 1 });

    const j = await get('/api/resumen?estado=jalisco');
    expect(j).toMatchObject({ filtros: { estado: 'jalisco' }, personasUnicas: 2, visitas: 0, anormales: 1, pendientesPatologia: 1, duplicadosPendientes: 1 });
    expect(j.porEstado).toHaveLength(1);
    const g = await get('/api/resumen?comunidad=Metlat%C3%B3noc');
    expect(g).toMatchObject({ personasUnicas: 1, visitas: 1, duplicadosPendientes: 0, estudios: { total: 2 } });
  });
});

describe('panel', () => {
  it('/panel redirige a /panel/ y sirve index.html', async () => {
    const r = await app.request('/panel');
    expect([301, 302]).toContain(r.status);
    expect(r.headers.get('location')).toBe('/panel/');
    const i = await app.request('/panel/');
    expect(i.status).toBe(200);
    expect(i.headers.get('content-type')).toMatch(/text\/html/);
    expect((await app.request('/panel/no-existe.js')).status).toBe(404);
    expect((await app.request('/api/salud')).status).toBe(200);
  });
});
