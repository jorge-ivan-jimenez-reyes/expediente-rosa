// Cifrado en reposo de los campos sensibles (nota del estudio y consentimiento).
// AES-256-GCM con llave de 32 bytes en CLAVE_DATOS (base64). Sin llave, avisa y
// guarda en claro para que la demo corra local sin configurar nada.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIJO = 'enc:v1:';

function cargarLlave(): Buffer | null {
  const b64 = process.env.CLAVE_DATOS;
  if (!b64) {
    console.warn('[cifrado] CLAVE_DATOS no está definida: nota y consentimiento se guardan en claro.');
    return null;
  }
  const llave = Buffer.from(b64, 'base64');
  if (llave.length !== 32) throw new Error(`CLAVE_DATOS debe ser 32 bytes en base64 (trae ${llave.length}).`);
  return llave;
}

let llave: Buffer | null | undefined;
const obtenerLlave = () => (llave === undefined ? (llave = cargarLlave()) : llave);

export const cifradoActivo = () => obtenerLlave() !== null;

export function cifrar(texto: string): string {
  const k = obtenerLlave();
  if (!k) return texto;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return `${PREFIJO}${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${datos.toString('base64')}`;
}

// Acepta texto en claro (datos de antes de activar la llave) y lo devuelve igual.
export function descifrar(valor: string): string {
  if (!valor.startsWith(PREFIJO)) return valor;
  const k = obtenerLlave();
  if (!k) return '[cifrado: falta CLAVE_DATOS]';
  const [iv, tag, datos] = valor.slice(PREFIJO.length).split(':');
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
}

export const estaCifrado = (valor: string) => valor.startsWith(PREFIJO);

// Para pruebas: obliga a releer CLAVE_DATOS.
export function reiniciarLlave() { llave = undefined; }
