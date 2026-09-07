/**
 * Region is not stored on a Pokémon — only `generation` (1–9) is. Each main-line
 * generation maps 1:1 to its debut region, so the "Region" card view derives the
 * name from generation via this fixed lookup. Content, like `typeColors` — not
 * chrome, so permanently exempt from theming.
 */
export const regionByGeneration: Record<number, string> = {
  1: 'Kanto',
  2: 'Johto',
  3: 'Hoenn',
  4: 'Sinnoh',
  5: 'Unova',
  6: 'Kalos',
  7: 'Alola',
  8: 'Galar',
  9: 'Paldea',
};

/** The region name for a generation, or a safe fallback for anything unmapped. */
export function regionForGeneration(generation: number): string {
  return regionByGeneration[generation] ?? 'Unknown';
}
