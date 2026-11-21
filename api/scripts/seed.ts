// Carga las pacientes ficticias de seed/pacientes.json mandándolas por POST /api/sync,
// igual que lo haría un teléfono al volver la señal. Así el seed ejercita el flujo real:
// llaves de idempotencia, índice de coincidencias y cola de duplicados.
//
// Uso:  pnpm seed                         (API en http://localhost:8787/api)
//       API_URL=https://otra/api pnpm seed
//
// Es repetible: los IDs y las llaves son fijos, así que correrlo dos veces no duplica nada
// (la segunda vez la API responde todo como «repetidos»).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = (process.env.API_URL ?? 'http://localhost:8787/api').replace(/\/$/, '');
const archivo = resolve(dirname(fileURLToPath(import.meta.url)), '../../seed/pacientes.json');

type EstudioSeed = { id: string; tipo: string; fecha: string; resultado: string; nota?: string; registradoPor: string };
type PacienteSeed = Record<string, unknown> & { id: string; comunidad: string; creadaPor: string; _grupo?: string; estudios: EstudioSeed[] };

const { pacientes } = JSON.parse(readFileSync(archivo, 'utf8')) as { pacientes: PacienteSeed[] };

// Un envío por comunidad, como si cada brigada sincronizara su propio teléfono.
const porComunidad = new Map<string, PacienteSeed[]>();
for (const p of pacientes) porComunidad.set(p.comunidad, [...(porComunidad.get(p.comunidad) ?? []), p]);

let total = { aplicados: 0, repetidos: 0, posiblesDuplicados: 0 };
for (const [comunidad, lista] of porComunidad) {
  const eventos = lista.flatMap(({ estudios, _grupo, ...paciente }) => [
    { llave: `seed:alta:${paciente.id}`, tipo: 'alta', paciente },
    ...estudios.map((e) => ({ llave: `seed:estudio:${e.id}`, tipo: 'estudio', estudio: { ...e, pacienteId: paciente.id } })),
  ]);
  const dispositivo = `seed-${String(lista[0].creadaPor)}`;
  const res = await fetch(`${API_URL}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dispositivo, eventos }),
  });
  if (!res.ok) {
    console.error(`Error ${res.status} en ${comunidad}:`, await res.text());
    process.exit(1);
  }
  const r = (await res.json()) as { aplicados: number; repetidos: number; posiblesDuplicados: unknown[] };
  console.log(`${comunidad.padEnd(18)} ${lista.length} pacientes, ${eventos.length} eventos → aplicados ${r.aplicados}, repetidos ${r.repetidos}, posibles duplicados ${r.posiblesDuplicados.length}`);
  total = { aplicados: total.aplicados + r.aplicados, repetidos: total.repetidos + r.repetidos, posiblesDuplicados: total.posiblesDuplicados + r.posiblesDuplicados.length };
}
console.log(`Total: aplicados ${total.aplicados}, repetidos ${total.repetidos}, posibles duplicados ${total.posiblesDuplicados}`);

// Revisa que los pares esperados estén en la cola de duplicados y que madre/hija no.
const cola = (await (await fetch(`${API_URL}/duplicados`)).json()) as { a: { id: string } | null; b: { id: string } | null }[];
const enCola = new Set(cola.map((d) => [d.a?.id, d.b?.id].sort().join('|')));
const grupos = new Map<string, string[]>();
for (const p of pacientes) if (p._grupo) grupos.set(p._grupo, [...(grupos.get(p._grupo) ?? []), p.id]);
let fallas = 0;
for (const [grupo, ids] of grupos) {
  const esta = enCola.has([...ids].sort().join('|'));
  const esperado = grupo.startsWith('par-');
  const ok = esta === esperado;
  if (!ok) fallas++;
  console.log(`${ok ? 'ok ' : 'MAL'} ${grupo.padEnd(13)} ${esta ? 'en la cola de duplicados' : 'no está en la cola'}${ok ? '' : esperado ? ' (debía estar)' : ' (no debía estar)'}`);
}
process.exit(fallas ? 1 : 0);
