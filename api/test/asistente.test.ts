// Asistente de coordinación: armado del contexto (puro) y la ruta en modo sin modelo.
// La ruta usa Valkey real en la DB 10 (se limpia) y un binario que no existe.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { armar, interpretar, revisar, LIMITE_CONTEXTO, type Fuente } from '../src/asistente';

process.env.VALKEY_URL = process.env.VALKEY_URL_TEST_ASISTENTE ?? 'redis://localhost:6379/10';
process.env.ASISTENTE_BIN = '/no/existe/asistente';

const DIA = 24 * 60 * 60 * 1000;
const AHORA = Date.parse('2026-11-21T19:00:00Z'); // 13:00 en la CDMX

function fuente(): Fuente {
  const p = (id: string, folio: string, nombre: string, ap: string, comunidad: string, estado: string, estudios: Fuente['pacientes'][0]['estudios'] = []) =>
    ({ id, folio, nombre, apellidoPaterno: ap, comunidad, estado, visitas: [{ fecha: '2026-11-18T09:00:00-06:00', comunidad, estado }], estudios });
  return {
    ahora: AHORA,
    pacientes: [
      p('a', 'JUX-007', 'Eulalia', 'García', 'San Martín Peras', 'Oaxaca', [
        { id: 'e1', tipo: 'mastografia', fecha: '2025-03-14', resultado: 'anormal', etapa: 'interpretado' },
        { id: 'e2', tipo: 'mastografia', fecha: '2026-11-21', resultado: 'anormal', clasificacion: 'BI-RADS 4', etapa: 'interpretado' },
      ]),
      p('b', 'SMP-014', 'Rosa', 'Santiago', 'San Martín Peras', 'Oaxaca', [
        { id: 'e3', tipo: 'mastografia', fecha: '2026-11-20', resultado: 'anormal', clasificacion: 'BI-RADS 4', etapa: 'interpretado' },
        { id: 'e4', tipo: 'papanicolaou', fecha: '2026-11-18', resultado: 'pendiente', etapa: 'en-laboratorio' },
      ]),
      p('c', 'MET-004', 'Chayo', 'Hernández', 'Metlatónoc', 'Guerrero', [
        { id: 'e5', tipo: 'mastografia', fecha: '2026-11-19', resultado: 'anormal', clasificacion: 'BI-RADS 4', etapa: 'interpretado' },
        { id: 'e6', tipo: 'papanicolaou', fecha: '2026-11-20', resultado: 'pendiente', etapa: 'en-laboratorio' },
      ]),
    ],
    seguimiento: [
      { estudioId: 'e1', pacienteId: 'a', tipo: 'mastografia', fecha: '2025-03-14', motivo: 'resultado anormal', limite: AHORA - 615 * DIA },
      { estudioId: 'e2', pacienteId: 'a', tipo: 'mastografia', fecha: '2026-11-21', motivo: 'BI-RADS 4', limite: AHORA + 15 * DIA },
      { estudioId: 'e3', pacienteId: 'b', tipo: 'mastografia', fecha: '2026-11-20', motivo: 'BI-RADS 4', limite: AHORA + 14 * DIA },
      { estudioId: 'e5', pacienteId: 'c', tipo: 'mastografia', fecha: '2026-11-19', motivo: 'BI-RADS 4', limite: AHORA + 13 * DIA },
    ],
    patologia: [
      { estudioId: 'e4', pacienteId: 'b', desde: AHORA - 3 * DIA },
      { estudioId: 'e6', pacienteId: 'c', desde: AHORA - 1 * DIA },
    ],
    bitacora: [
      { cuando: '2026-11-21T18:40:00Z', tipo: 'consulta-asistente', autor: 'Ana (coordinación)' },
      { cuando: '2026-11-21T18:30:00Z', tipo: 'estudio', autor: 'Rocío', pacienteId: 'a', estudioId: 'e2', folio: 'JUX-007' },
      { cuando: '2026-11-21T18:20:00Z', tipo: 'estudio', autor: 'Rocío', pacienteId: 'a', estudioId: 'e9', folio: 'JUX-007' },
      { cuando: '2026-11-21T18:10:00Z', tipo: 'alta', autor: 'Rocío', pacienteId: 'a', folio: 'JUX-007' },
      { cuando: '2026-11-20T18:10:00Z', tipo: 'alta', autor: 'Lupe', pacienteId: 'c', folio: 'MET-004' },
    ],
    jornadas: [{ fecha: '2026-11-30', comunidad: 'San Martín Peras', estado: 'Oaxaca' }],
  };
}

describe('armar el contexto', () => {
  it('cuenta en la API: BI-RADS 4 sin atender en una comunidad', () => {
    const a = armar('¿Cuántas mujeres de San Martín Peras tienen un BI-RADS 4 sin atender?', fuente());
    expect(a.datos.intencion).toBe('seguimiento');
    expect(a.datos.filtros).toMatchObject({ comunidad: 'San Martín Peras', clasificacion: 'BI-RADS 4' });
    // MET-004 también tiene BI-RADS 4 pero es de otra comunidad. La mastografía vencida de
    // JUX-007 no tiene BI-RADS 4, así que cuenta el plazo de la que sí.
    expect(a.sinModelo).toBe('2 pacientes de San Martín Peras con BI-RADS 4 sin atender en seguimiento: SMP-014 (quedan 14 días) y JUX-007 (quedan 15 días).');
    expect(a.contexto).toContain(`RESPUESTA CALCULADA: ${a.sinModelo}`);
    expect(a.datos.folios).toMatchObject({ 'JUX-007': 'seguimiento', 'SMP-014': 'seguimiento' });
    expect(a.contexto).not.toContain('MET-004 |'); // filtro de comunidad en las listas
  });

  it('resume el día con autores, seguimiento nuevo y patología pendiente', () => {
    const a = armar('Resume la jornada de hoy', fuente());
    expect(a.datos.intencion).toBe('hoy');
    expect(a.sinModelo).toBe('Hoy: Rocío registró 2 estudios y dio de alta a 1 paciente. 1 estudio anormal entró a seguimiento. Quedan 2 papanicolaous esperando al patólogo.');
    expect(a.datos.bitacora.some((b) => b.tipo === 'consulta-asistente')).toBe(false);
  });

  it('papanicolaous que más esperan', () => {
    const a = armar('¿Qué papanicolaous llevan más tiempo esperando?', fuente());
    expect(a.datos.intencion).toBe('patologia');
    expect(a.sinModelo).toBe('2 papanicolaous esperan al patólogo. El que más espera es SMP-014, con 3 días; le sigue MET-004, con 1 día.');
    expect(a.datos.folios['SMP-014']).toBe('patologia');
  });

  it('línea de tiempo de una paciente por nombre o folio', () => {
    const f = fuente();
    for (const q of ['¿Qué pasó con Eulalia?', 'qué pasó con jux-007']) {
      const a = armar(q, f);
      expect(a.datos.intencion).toBe('paciente');
      expect(a.datos.pacientes.map((p) => p.folio)).toEqual(['JUX-007']);
      expect(a.contexto).toContain('PACIENTE JUX-007: Eulalia García');
      expect(a.sinModelo).toContain('2 estudios en seguimiento sin atender, 1 vencido');
    }
    // «Martín» de la comunidad no se toma como nombre de paciente.
    expect(interpretar('¿Qué hay en San Martín Peras?', f).intencion).not.toBe('paciente');
  });

  it('sin intención clara: resumen con las cifras y sin RESPUESTA CALCULADA', () => {
    const a = armar('¿Cómo vamos?', fuente());
    expect(a.datos.intencion).toBe('general');
    expect(a.contexto).not.toContain('RESPUESTA CALCULADA');
    expect(a.sinModelo).toBe('3 personas, 6 estudios y 4 anormales. 2 papanicolaous esperan al patólogo y 1 seguimiento está vencido.');
  });

  it('nunca pasa de 6 000 caracteres', () => {
    const f = fuente();
    for (let i = 0; i < 400; i++) {
      f.bitacora.push({ cuando: '2026-11-19T10:00:00Z', tipo: 'visita', autor: `enfermera-${i}`, pacienteId: 'a', folio: 'JUX-007' });
      f.seguimiento.push({ estudioId: `x${i}`, pacienteId: 'c', tipo: 'ultrasonido', fecha: '2026-01-01', motivo: 'resultado anormal', limite: AHORA - i * DIA });
    }
    const a = armar('¿Cómo vamos?', f);
    expect(a.contexto.length).toBeLessThanOrEqual(LIMITE_CONTEXTO);
    expect(a.datos.caracteres).toBe(a.contexto.length);
    expect(a.contexto).toContain('RESUMEN:');
  });
});

describe('revisar lo que redacta el modelo', () => {
  const ctx = armar('¿Cuántas mujeres de San Martín Peras tienen un BI-RADS 4 sin atender?', fuente()).contexto;
  it('acepta cifras y folios del contexto', () => {
    expect(revisar('Son 2: SMP-014 (quedan 14 días) y JUX-007, con BI-RADS 4.', ctx).ok).toBe(true);
  });
  it('rechaza folios o números inventados', () => {
    expect(revisar('Son 2: JUX-007 y SMP-099.', ctx)).toMatchObject({ ok: false, motivo: 'folio SMP-099' });
    expect(revisar('Son 37 pacientes.', ctx)).toMatchObject({ ok: false, motivo: 'número 37' });
    expect(revisar('SMP-014 | mastografía | BI-RADS 4', ctx)).toMatchObject({ ok: false, motivo: 'copió una tabla' });
  });
});

describe('POST /api/asistente sin modelo', async () => {
  const { default: app, valkey, cerrar } = await import('../src/index');
  const pid = randomUUID();
  beforeAll(async () => {
    expect(process.env.VALKEY_URL).toMatch(/\/10$/); // nunca borrar la DB de la demo
    await valkey.flushdb();
    const eventos = [
      { llave: randomUUID(), tipo: 'alta', paciente: { id: pid, folio: 'T-001', nombre: 'Eulalia', apellidoPaterno: 'García', comunidad: 'Tuxpan', consentimiento: '2026-11-21', creadaPor: 'enf-1', creada: '2026-11-21' } },
      { llave: randomUUID(), tipo: 'estudio', estudio: { id: randomUUID(), pacienteId: pid, tipo: 'mastografia', fecha: '2026-11-21', resultado: 'anormal', clasificacion: 'BI-RADS 4', registradoPor: 'med-1' } },
    ];
    const r = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dispositivo: 'test', eventos }) });
    expect(r.status).toBe(200);
  });
  afterAll(async () => { await valkey.flushdb(); await cerrar(); });

  const preguntar = (cuerpo: object) => app.request('/api/asistente', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });

  it('responde con cifras directas y lo que usó', async () => {
    const r = await preguntar({ pregunta: '¿Cuántas de Tuxpan tienen BI-RADS 4 sin atender?', autor: 'Ana (coordinación)' });
    expect(r.status).toBe(200);
    const d = await r.json() as any;
    expect(d.motor).toBe('sin-modelo');
    expect(d.motivo).toBe('sin Apple Intelligence en este servidor');
    expect(d.respuesta).toBe('1 paciente de Tuxpan con BI-RADS 4 sin atender en seguimiento: T-001 (quedan 15 días).');
    expect(d.datosUsados.seguimiento).toHaveLength(1);
    expect(d.datosUsados.seguimiento[0]).toMatchObject({ folio: 'T-001', clasificacion: 'BI-RADS 4', vencido: false });
  });

  it('la bitácora guarda quién consultó, sin la pregunta ni la respuesta', async () => {
    const filas = await (await app.request('/api/bitacora?limite=5')).json() as any[];
    const c = filas.find((f) => f.tipo === 'consulta-asistente');
    expect(c).toMatchObject({ tipo: 'consulta-asistente', autor: 'Ana (coordinación)' });
    const crudo = JSON.stringify(await valkey.xrevrange('eventos', '+', '-', 'COUNT', 1));
    expect(crudo).not.toMatch(/BI-RADS|Tuxpan|T-001/);
  });

  it('400 sin pregunta', async () => {
    expect((await preguntar({ pregunta: '' })).status).toBe(400);
  });
});
