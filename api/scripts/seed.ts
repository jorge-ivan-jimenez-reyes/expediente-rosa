// Carga las pacientes ficticias de seed/pacientes.json mandándolas por POST /api/sync,
// igual que lo haría un teléfono al volver la señal. Así el seed ejercita el flujo real:
// llaves de idempotencia, índice de coincidencias y cola de duplicados.
//
// Uso:  pnpm seed                         (API en http://localhost:8787/api)
//       API_URL=https://otra/api pnpm seed
//
// Es repetible: los IDs y las llaves son fijos, así que correrlo dos veces no duplica nada
// (la segunda vez la API responde todo como «repetidos»).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = (process.env.API_URL ?? 'http://localhost:8787/api').replace(/\/$/, '');
const archivo = process.env.SEED_ARCHIVO ? resolve(process.env.SEED_ARCHIVO) : resolve(dirname(fileURLToPath(import.meta.url)), '../../seed/pacientes.json');

type EstudioSeed = { id: string; tipo: string; fecha: string; resultado: string; nota?: string; registradoPor: string };
type PacienteSeed = Record<string, unknown> & { id: string; comunidad: string; creadaPor: string; _grupo?: string; estudios: EstudioSeed[] };

const { pacientes } = JSON.parse(readFileSync(archivo, 'utf8')) as { pacientes: PacienteSeed[] };

// Brigada: una visita por paciente y día de estudios, con el estado (lo que va después
// de la última coma en «municipio») y el nombre de la jornada. IDs fijos derivados.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const uuidFijo = (texto: string) => {
  const h = createHash('sha1').update(texto).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
function visitasDe(p: PacienteSeed) {
  const municipio = typeof p.municipio === 'string' ? p.municipio : '';
  const estado = municipio.includes(',') ? municipio.slice(municipio.lastIndexOf(',') + 1).trim() : undefined;
  const dias = [...new Set(p.estudios.map((e) => e.fecha.slice(0, 10)))];
  return dias.map((dia) => ({
    id: uuidFijo(`seed:visita:${p.id}:${dia}`), dia,
    visita: {
      id: uuidFijo(`seed:visita:${p.id}:${dia}`), pacienteId: p.id, fecha: `${dia}T09:00:00-06:00`,
      comunidad: p.comunidad, motivo: 'jornada de tamizaje', registradaPor: String(p.creadaPor),
      ...(estado ? { estado } : {}),
      jornada: `${p.comunidad} · ${MESES[Number(dia.slice(5, 7)) - 1]} ${dia.slice(0, 4)}`,
    },
  }));
}

// Un envío por comunidad, como si cada brigada sincronizara su propio teléfono.
const porComunidad = new Map<string, PacienteSeed[]>();
for (const p of pacientes) porComunidad.set(p.comunidad, [...(porComunidad.get(p.comunidad) ?? []), p]);

let total = { aplicados: 0, repetidos: 0, posiblesDuplicados: 0 };
for (const [comunidad, lista] of porComunidad) {
  const eventos = lista.flatMap(({ estudios, _grupo, ...paciente }) => {
    const visitas = visitasDe({ ...paciente, estudios });
    const visitaDe = (fecha: string) => visitas.find((v) => v.dia === fecha.slice(0, 10))!.id;
    return [
      { llave: `seed:alta:${paciente.id}`, tipo: 'alta', paciente },
      ...visitas.map(({ visita }) => ({ llave: `seed:visita:${visita.id}`, tipo: 'visita', visita })),
      ...estudios.map((e) => ({ llave: `seed:estudio:${e.id}`, tipo: 'estudio', estudio: { ...e, pacienteId: paciente.id, visitaId: visitaDe(e.fecha) } })),
    ];
  });
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
