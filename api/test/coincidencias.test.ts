import { describe, it, expect } from 'vitest';
import { comparar, normalizar, UMBRAL_POSIBLE } from '../src/coincidencias';

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
