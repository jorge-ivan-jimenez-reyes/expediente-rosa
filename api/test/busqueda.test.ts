// C4: búsqueda KNN con valkey-search. Corre solo si hay un valkey-bundle en
// VALKEY_BUNDLE_URL (por defecto localhost:6380, DB 15); si no, se salta.
//   docker run -d --rm --name eira-c4-bundle -p 6380:6379 valkey/valkey-bundle:8
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Valkey from 'iovalkey';

const URL_BUNDLE = process.env.VALKEY_BUNDLE_URL ?? 'redis://localhost:6380/15';
async function hayBundle() {
  const v = new Valkey(URL_BUNDLE, { lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try { await v.connect(); return JSON.stringify(await v.call('MODULE', 'LIST')).includes('search'); }
  catch { return false; } finally { v.disconnect(); }
}
const disponible = await hayBundle();

describe.skipIf(!disponible)('buscar con valkey-search (KNN)', async () => {
  process.env.VALKEY_URL = URL_BUNDLE;
  const { default: app, valkey, cerrar, preparar } = await import('../src/index');
  afterAll(async () => { await valkey.flushdb(); await cerrar(); });

  const alta = (o: Record<string, unknown>) => {
    const paciente = { id: randomUUID(), folio: 'B1', consentimiento: '2026-11-21', creadaPor: 'e', creada: '2026-11-21', ...o };
    return { llave: randomUUID(), tipo: 'alta', paciente };
  };

  it('usa KNN y pone primero a la misma señora escrita distinto', async () => {
    await valkey.flushdb();
    const eventos = [
      alta({ nombre: 'María Guadalupe', apellidoPaterno: 'Hernández', apellidoMaterno: 'Velázquez', nacimiento: '1979-03-02', comunidad: 'Tuxpan' }),
      alta({ nombre: 'Rosa', apellidoPaterno: 'López', apellidoMaterno: 'Cruz', edad: 68, comunidad: 'Tuxpan' }),
      alta({ nombre: 'Carmen', apellidoPaterno: 'Ramírez', edad: 31, comunidad: 'Coyutla' }),
    ];
    await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dispositivo: 't', eventos }) });
    expect(await preparar()).toBe('valkey-search');
    await new Promise((r) => setTimeout(r, 200)); // el índice HNSW se llena en segundo plano
    const r = await (await app.request('/api/buscar?nombre=Ma.%20Lupe&apellidoPaterno=Hdz&apellidoMaterno=Belasquez&edad=47')).json() as any;
    expect(r.motor).toBe('valkey-search');
    expect(r.resultados[0].paciente.id).toBe(eventos[0].paciente.id);
    expect(r.resultados[0].distancia).toBeLessThan(0.05);
    expect(r.resultados[0].posible).toBe(true);
  });
});
