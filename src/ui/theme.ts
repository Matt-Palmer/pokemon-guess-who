import type { TextStyle, ViewStyle } from 'react-native';

/**
 * The "playful board-game" theme (see CONTEXT.md + issues/12-design-system.md).
 * Semantic names only — screens never reach for raw hex. One rich light theme;
 * the semantic layer is what makes a future dark theme an addition, not a rewrite.
 */
export const colors = {
  // Canvas
  background: '#F7EBD8', // warm tabletop paper
  surface: '#FFFCF5', // card face
  surfaceSunken: '#F0E2CB', // input wells, insets
  backdrop: 'rgba(59, 42, 30, 0.55)', // dim behind modals

  // Ink
  ink: '#3B2A1E',
  inkMuted: '#8A7460',
  inkFaint: '#C4B39D',
  border: '#E3D2B8',

  // Actions
  primary: '#E0552F', // game-box red
  primaryPressed: '#C34526',
  primarySoft: '#FBE3D6',
  onPrimary: '#FFF9EE',

  accent: '#F5B942', // sunny yellow
  accentPressed: '#DB9E22',
  accentSoft: '#FCF0D2',
  onAccent: '#3B2A1E',

  // Feedback
  success: '#4C9B57',
  successSoft: '#E4F2DF',
  danger: '#C93A3A',
  dangerSoft: '#F9E3DE',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

/**
 * Tactile "cardboard" shadows: hard offsets (no blur) on iOS so surfaces read
 * as physical pieces on a table; elevation approximates on Android.
 */
export const shadows = {
  card: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 0,
    elevation: 2,
  },
  raised: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 0,
    elevation: 4,
  },
  floating: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 2,
    elevation: 8,
  },
} satisfies Record<string, ViewStyle>;

export const type = {
  display: { fontSize: 28, fontWeight: '900', color: colors.ink, letterSpacing: 0.2 },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  heading: { fontSize: 16, fontWeight: '800', color: colors.ink },
  body: { fontSize: 15, color: colors.ink },
  label: { fontSize: 13, fontWeight: '700', color: colors.ink },
  caption: { fontSize: 12, color: colors.inkMuted },
} satisfies Record<string, TextStyle>;
