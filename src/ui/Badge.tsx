import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, radii, spacing } from '@/ui/theme';

type Variant = 'primary' | 'accent' | 'success' | 'neutral';

type Props = {
  label: string;
  variant?: Variant;
  /** Renders a leading status dot (e.g. presence). */
  dot?: boolean;
  style?: ViewStyle;
};

const looks: Record<Variant, { bg: string; text: string; dot: string }> = {
  primary: { bg: colors.primary, text: colors.onPrimary, dot: colors.onPrimary },
  accent: { bg: colors.accentSoft, text: colors.accentPressed, dot: colors.accent },
  success: { bg: colors.successSoft, text: colors.success, dot: colors.success },
  neutral: { bg: colors.surfaceSunken, text: colors.inkMuted, dot: colors.inkFaint },
};

/** A small pill for statuses: "Your move", online presence, phase chips. */
export function Badge({ label, variant = 'neutral', dot, style }: Props) {
  const look = looks[variant];
  return (
    <View style={[styles.pill, { backgroundColor: look.bg }, style]}>
      {dot && <View style={[styles.dot, { backgroundColor: look.dot }]} />}
      <Text style={[styles.label, { color: look.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 1,
    alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 12, fontWeight: '800' },
});
