import { colors as theme } from '@/ui/theme';

/**
 * @deprecated Legacy palette names, re-pointed at the board-game theme
 * (`src/ui/theme.ts`) so unmigrated screens pick up the new look. Issues 13–16
 * move each screen onto the semantic tokens directly; delete this when the
 * last screen migrates. `typeColors` below is content, not chrome — it stays.
 */
export const colors = {
  primary: theme.primary,
  primaryDark: theme.primaryPressed,
  primaryBg: theme.primarySoft,
  accent: theme.accent,
  accentDark: theme.accentPressed,
  accentBg: theme.accentSoft,
  background: theme.background,
  card: theme.surface,
  text: theme.ink,
  textMuted: theme.inkMuted,
  border: theme.border,
  correct: theme.success,
  correctBg: theme.successSoft,
  wrong: theme.danger,
  wrongBg: theme.dangerSoft,
  selected: theme.primary,
  selectedBg: theme.primarySoft,
  onPrimary: theme.onPrimary,
  onAccent: theme.onAccent,
} as const;

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
