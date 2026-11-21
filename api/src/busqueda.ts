// C4: búsqueda por similitud con valkey-search (imagen valkey/valkey-bundle).
// No hay modelo de embeddings: el vector es un histograma de trigramas del nombre
// ya normalizado y pasado por la fonética de coincidencias.ts. Así «Ma. Lupe Hdz
// Belasquez» y «María Guadalupe Hernández Velázquez» dan el mismo vector y KNN las
// encuentra sin recorrer a todas. Si el módulo search no está (imagen valkey:8),
// la API usa los sets de bloque de siempre.
import type Valkey from 'iovalkey';
import { normalizar, fonetica, type DatosPaciente } from './coincidencias';

export const DIM = 128;
export const INDICE = 'idx:pacientes';
export const llaveVector = (id: string) => `buscar:paciente:${id}`;

const textoFonetico = (p: DatosPaciente) =>
  [p.nombre, p.apellidoPaterno, p.apellidoMaterno ?? ''].map((s) => normalizar(s).split(' ').map(fonetica).join(' ')).join(' ').trim();

export function vectorNombre(p: DatosPaciente): Buffer {
  const v = new Float32Array(DIM);
  const s = ` ${textoFonetico(p)} `;
  for (let i = 0; i < s.length - 2; i++) {
    let h = 2166136261; // FNV-1a del trigrama
    for (const ch of s.slice(i, i + 3)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    v[(h >>> 0) % DIM] += 1;
  }
  const n = Math.hypot(...v) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return Buffer.from(v.buffer);
}

const tag = (c: string) => normalizar(c).replace(/\s+/g, '_');

// Se escribe siempre, haya o no módulo: si después se cambia a valkey-bundle,
// FT.CREATE indexa lo que ya existe.
export function guardarVector(m: ReturnType<Valkey['multi']>, id: string, p: DatosPaciente & { comunidad: string }) {
  m.hset(llaveVector(id), { comunidad: tag(p.comunidad), v: vectorNombre(p) });
}

export async function hayModuloSearch(valkey: Valkey): Promise<boolean> {
  try {
    const mods = (await valkey.call('MODULE', 'LIST')) as unknown[][];
    return mods.some((m) => m.map(String).includes('search'));
  } catch { return false; }
}

export async function crearIndice(valkey: Valkey) {
  const existentes = ((await valkey.call('FT._LIST')) as string[]).map(String);
  if (existentes.includes(INDICE)) return;
  await valkey.call('FT.CREATE', INDICE, 'ON', 'HASH', 'PREFIX', '1', 'buscar:paciente:', 'SCHEMA',
    'comunidad', 'TAG', 'v', 'VECTOR', 'HNSW', '6', 'TYPE', 'FLOAT32', 'DIM', String(DIM), 'DISTANCE_METRIC', 'COSINE');
}

// KNN con filtro opcional por comunidad. Devuelve ids y distancia coseno (0 = idéntico).
export async function knn(valkey: Valkey, q: DatosPaciente, k: number, comunidad?: string) {
  const filtro = comunidad ? `@comunidad:{${tag(comunidad)}}` : '*';
  const r = (await valkey.call('FT.SEARCH', INDICE, `${filtro}=>[KNN ${k} @v $q]`,
    'PARAMS', '2', 'q', vectorNombre(q), 'RETURN', '1', '__v_score', 'DIALECT', '2')) as unknown[];
  const out: { id: string; distancia: number }[] = [];
  for (let i = 1; i < r.length; i += 2) {
    const campos = (r[i + 1] as unknown[]).map(String);
    out.push({ id: String(r[i]).slice('buscar:paciente:'.length), distancia: Math.max(0, Number(campos[campos.indexOf('__v_score') + 1])) });
  }
  return out;
}
