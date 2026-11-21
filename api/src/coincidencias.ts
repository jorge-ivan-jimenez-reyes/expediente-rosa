// Reconocer a una paciente que regresa aunque su nombre venga escrito distinto.
// Misma lógica que ios/ExpedienteRosa/Coincidencias/Coincidencias.swift: si cambias una, cambia la otra.

const APODOS: Record<string, string> = {
  ma: 'maria', 'ma.': 'maria', mari: 'maria', lupe: 'guadalupe', lupita: 'guadalupe',
  chuy: 'jesus', chuya: 'jesus', lucha: 'luz', concha: 'concepcion', conchita: 'concepcion',
  chela: 'graciela', lola: 'dolores', paty: 'patricia', pati: 'patricia', vero: 'veronica',
  rosy: 'rosa', chayo: 'rosario', meche: 'mercedes', nena: '', juana: 'juana', toña: 'antonia',
  tona: 'antonia', cuca: 'refugio', cata: 'catalina', yola: 'yolanda', mague: 'margarita',
};
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z.\s]/g, ' ')
    .split(/\s+/)
    .map((p) => (p in APODOS ? APODOS[p] : p.replace(/\.$/, '')))
    .map((p) => p.replace(/^hdz$/, 'hernandez').replace(/^glz$/, 'gonzalez').replace(/^mtz$/, 'martinez').replace(/^rdz$/, 'rodriguez'))
    .filter((p) => p && !PARTICULAS.has(p))
    .join(' ');
}

// Errores comunes de captura en español: b/v, s/z/c, y/ll, h muda, j/g.
export function fonetica(palabra: string): string {
  return palabra
    .replace(/^h/, '').replace(/ll/g, 'y').replace(/v/g, 'b').replace(/z/g, 's')
    .replace(/c([ei])/g, 's$1').replace(/g([ei])/g, 'j$1').replace(/qu/g, 'k').replace(/c/g, 'k')
    .replace(/(.)\1+/g, '$1');
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const rango = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const ma = new Array(a.length).fill(false), mb = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - rango); j < Math.min(b.length, i + rango + 1); j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

export interface DatosPaciente {
  nombre: string; apellidoPaterno: string; apellidoMaterno?: string;
  nacimiento?: string; edad?: number; comunidad?: string;
}

const anio = (p: DatosPaciente, hoy = new Date().getFullYear()) =>
  p.nacimiento ? Number(p.nacimiento.slice(0, 4)) : p.edad != null ? hoy - p.edad : undefined;

// Llaves de bloque: solo se compara contra pacientes que comparten alguna.
export function llavesBloque(p: DatosPaciente): string[] {
  const ap = fonetica(normalizar(p.apellidoPaterno).split(' ')[0] ?? '');
  const am = fonetica(normalizar(p.apellidoMaterno ?? '').split(' ')[0] ?? '');
  const y = anio(p);
  const llaves = [`ap:${ap.slice(0, 4)}`];
  if (am) llaves.push(`am:${am.slice(0, 4)}`);
  if (y) llaves.push(`ap-anio:${ap.slice(0, 3)}:${y}`);
  return llaves;
}

export interface Resultado { puntaje: number; razones: string[] }

export function comparar(a: DatosPaciente, b: DatosPaciente): Resultado {
  const razones: string[] = [];
  const f = (s?: string) => normalizar(s ?? '').split(' ').map(fonetica).join(' ');
  const sNombre = jaroWinkler(f(a.nombre), f(b.nombre));
  const sPat = jaroWinkler(f(a.apellidoPaterno), f(b.apellidoPaterno));
  // Si a alguna le falta el apellido materno, no se adivina: se reparte su peso.
  let puntaje = a.apellidoMaterno && b.apellidoMaterno
    ? sNombre * 0.35 + sPat * 0.35 + jaroWinkler(f(a.apellidoMaterno), f(b.apellidoMaterno)) * 0.15
    : ((sNombre + sPat) / 2) * 0.85;
  if (sNombre > 0.9) razones.push('nombre parecido');
  if (sPat > 0.9) razones.push('apellido paterno parecido');

  const ya = anio(a), yb = anio(b);
  if (a.nacimiento && b.nacimiento && a.nacimiento === b.nacimiento) { puntaje += 0.15; razones.push('misma fecha de nacimiento'); }
  else if (ya && yb && Math.abs(ya - yb) <= 1) { puntaje += 0.1; razones.push('misma edad (±1 año)'); }
  else if (ya && yb) puntaje -= 0.15;

  if (a.comunidad && b.comunidad && normalizar(a.comunidad) === normalizar(b.comunidad)) { puntaje += 0.05; razones.push('misma comunidad'); }
  return { puntaje: Math.max(0, Math.min(1, puntaje)), razones };
}

export const UMBRAL_POSIBLE = 0.82;
