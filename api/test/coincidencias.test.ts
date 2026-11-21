import { describe, it, expect } from 'vitest';
import { comparar, normalizar, UMBRAL_POSIBLE, type DatosPaciente } from '../src/coincidencias';

describe('coincidencias', () => {
  it('normaliza apodos y abreviaturas', () => {
    expect(normalizar('Ma. Lupe Hdz')).toBe('maria guadalupe hernandez');
  });
  it('reconoce a la misma paciente escrita distinto', () => {
    const r = comparar(
      { nombre: 'Ma. Lupe', apellidoPaterno: 'Hdz', apellidoMaterno: 'Velázquez', edad: 47, comunidad: 'Tuxpan' },
      { nombre: 'María Guadalupe', apellidoPaterno: 'Hernández', apellidoMaterno: 'Belasquez', nacimiento: '1979-03-02', comunidad: 'tuxpan' },
    );
    expect(r.puntaje).toBeGreaterThanOrEqual(UMBRAL_POSIBLE);
  });
  it('no junta a madre e hija con el mismo nombre', () => {
    const r = comparar(
      { nombre: 'Rosa', apellidoPaterno: 'López', apellidoMaterno: 'Cruz', nacimiento: '1958-01-10', comunidad: 'Tuxpan' },
      { nombre: 'Rosa', apellidoPaterno: 'López', apellidoMaterno: 'Cruz', nacimiento: '1986-07-22', comunidad: 'Tuxpan' },
    );
    expect(r.puntaje).toBeLessThan(UMBRAL_POSIBLE);
  });
  it('no junta a personas distintas', () => {
    const r = comparar(
      { nombre: 'Juana', apellidoPaterno: 'Pérez', edad: 30 },
      { nombre: 'Carmen', apellidoPaterno: 'Ramírez', edad: 31 },
    );
    expect(r.puntaje).toBeLessThan(0.7);
  });
});

// B3: nombres mexicanos. Los mismos 10 casos están en ios/ExpedienteRosaTests/CoincidenciasTests.swift.
describe('coincidencias: nombres mexicanos', () => {
  const misma = (a: DatosPaciente, b: DatosPaciente) => expect(comparar(a, b).puntaje).toBeGreaterThanOrEqual(UMBRAL_POSIBLE);
  it('mx-01 Ma. del Carmen = María del Carmen', () => {
    expect(normalizar('Ma. del Carmen')).toBe('maria carmen');
    misma(
      { nombre: 'Ma. del Carmen', apellidoPaterno: 'Ruiz', apellidoMaterno: 'Gómez', nacimiento: '1970-11-05', comunidad: 'Zongolica' },
      { nombre: 'María del Carmen', apellidoPaterno: 'Ruiz', apellidoMaterno: 'Gómez', nacimiento: '1970-11-05', comunidad: 'Zongolica' },
    );
  });
  it('mx-02 Ma Lupita (sin punto) = María Guadalupe', () => misma(
    { nombre: 'Ma Lupita', apellidoPaterno: 'Flores', apellidoMaterno: 'Díaz', edad: 35, comunidad: 'Tuxpan' },
    { nombre: 'María Guadalupe', apellidoPaterno: 'Flores', apellidoMaterno: 'Díaz', nacimiento: '1991-06-18', comunidad: 'Tuxpan' },
  ));
  it('mx-03 Hdz = Hernández', () => misma(
    { nombre: 'Josefina', apellidoPaterno: 'Hdz', apellidoMaterno: 'Torres', edad: 52, comunidad: 'Papantla' },
    { nombre: 'Josefina', apellidoPaterno: 'Hernández', apellidoMaterno: 'Torres', nacimiento: '1974-05-10', comunidad: 'Papantla' },
  ));
  it('mx-04 Mtz Glz = Martínez González', () => misma(
    { nombre: 'Ana', apellidoPaterno: 'Mtz', apellidoMaterno: 'Glz', nacimiento: '1982-02-20' },
    { nombre: 'Ana', apellidoPaterno: 'Martínez', apellidoMaterno: 'González', nacimiento: '1982-02-20' },
  ));
  it('mx-05 b/v en apellido: Bázquez = Vázquez', () => misma(
    { nombre: 'Silvia', apellidoPaterno: 'Bázquez', apellidoMaterno: 'Mora', edad: 60, comunidad: 'Zongolica' },
    { nombre: 'Silvia', apellidoPaterno: 'Vázquez', apellidoMaterno: 'Mora', edad: 61, comunidad: 'Zongolica' },
  ));
  it('mx-06 b/v en nombre: Bibiana = Viviana', () => misma(
    { nombre: 'Bibiana', apellidoPaterno: 'Ortega', apellidoMaterno: 'Salas', nacimiento: '1988-09-09' },
    { nombre: 'Viviana', apellidoPaterno: 'Ortega', apellidoMaterno: 'Salas', nacimiento: '1988-09-09' },
  ));
  it('mx-07 s/z: Beatris Sanches = Beatriz Sánchez', () => misma(
    { nombre: 'Beatris', apellidoPaterno: 'Sanches', apellidoMaterno: 'Ríos', edad: 39, comunidad: 'Papantla' },
    { nombre: 'Beatriz', apellidoPaterno: 'Sánchez', apellidoMaterno: 'Ríos', nacimiento: '1987-01-15', comunidad: 'Papantla' },
  ));
  it('mx-08 s/z/c sin materno: Sesilia Gonsales = Cecilia González', () => {
    const r = comparar({ nombre: 'Sesilia', apellidoPaterno: 'Gonsales', edad: 44 }, { nombre: 'Cecilia', apellidoPaterno: 'González', edad: 45 });
    expect(r.puntaje).toBeGreaterThanOrEqual(UMBRAL_POSIBLE);
    expect(r.puntaje).toBeCloseTo(0.95, 3);
  });
  it('mx-09 una sin apellido materno', () => misma(
    { nombre: 'Leticia', apellidoPaterno: 'Ramírez', edad: 40, comunidad: 'Tuxpan' },
    { nombre: 'Leticia', apellidoPaterno: 'Ramírez', apellidoMaterno: 'Ortiz', nacimiento: '1986-08-01', comunidad: 'Tuxpan' },
  ));
  it('mx-10 madre e hija con el mismo nombre y distinta fecha', () => {
    const r = comparar(
      { nombre: 'Guadalupe', apellidoPaterno: 'Martínez', apellidoMaterno: 'Soto', nacimiento: '1960-04-12', comunidad: 'Zongolica' },
      { nombre: 'Lupita', apellidoPaterno: 'Mtz', apellidoMaterno: 'Soto', nacimiento: '1985-09-30', comunidad: 'Zongolica' },
    );
    expect(r.puntaje).toBeLessThan(UMBRAL_POSIBLE);
    expect(r.puntaje).toBeCloseTo(0.75, 3);
  });
});
