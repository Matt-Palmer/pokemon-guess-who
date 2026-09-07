import { regionByGeneration, regionForGeneration } from './regions';

describe('regionForGeneration', () => {
  it('maps every main-line generation to its debut region', () => {
    expect(regionForGeneration(1)).toBe('Kanto');
    expect(regionForGeneration(2)).toBe('Johto');
    expect(regionForGeneration(3)).toBe('Hoenn');
    expect(regionForGeneration(4)).toBe('Sinnoh');
    expect(regionForGeneration(5)).toBe('Unova');
    expect(regionForGeneration(6)).toBe('Kalos');
    expect(regionForGeneration(7)).toBe('Alola');
    expect(regionForGeneration(8)).toBe('Galar');
    expect(regionForGeneration(9)).toBe('Paldea');
  });

  it('covers all nine generations and no more', () => {
    expect(Object.keys(regionByGeneration)).toHaveLength(9);
  });

  it('falls back for an unmapped generation', () => {
    expect(regionForGeneration(0)).toBe('Unknown');
    expect(regionForGeneration(10)).toBe('Unknown');
  });
});
