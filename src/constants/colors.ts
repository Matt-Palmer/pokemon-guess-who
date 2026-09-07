/**
 * The deprecated `colors` alias (legacy palette names re-pointed at the
 * board-game theme) has been retired now that every chrome screen consumes
 * `@/ui` directly — issue 16 migrated the last of them (the auth screens).
 * Only `typeColors` remains here: it's game content, not chrome, and is
 * permanently exempt from theming.
 */

/** Official Pokémon type colors — content, permanently exempt from theming. */
export const typeColors: Record<string, string> = {
  normal: '#A8A77A',
  fire: '#EE8130',
  water: '#6390F0',
  electric: '#F7D02C',
  grass: '#7AC74C',
  ice: '#96D9D6',
  fighting: '#C22E28',
  poison: '#A33EA1',
  ground: '#E2BF65',
  flying: '#A98FF3',
  psychic: '#F95587',
  bug: '#A6B91A',
  rock: '#B6A136',
  ghost: '#735797',
  dragon: '#6F35FC',
  dark: '#705746',
  steel: '#B7B7CE',
  fairy: '#D685AD',
};
