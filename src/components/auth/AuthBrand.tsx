import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, spacing, type } from '@/ui';

/**
 * The board-game brand header for the auth screens: a poké-ball mark built from
 * plain Views (content over chrome — same house rule as `CardBack`) over a
 * wordmark and a per-screen subtitle. Gives sign-in / sign-up / verification a
 * shared, themed first impression instead of a bare title on white.
 */
export function AuthBrand({ subtitle }: { subtitle: string }) {
  return (
    <View style={styles.root}>
      <View style={styles.mark}>
        <View style={styles.top} />
        <View style={styles.bottom} />
        <View style={styles.band} />
        <View style={styles.ring}>
          <View style={styles.core} />
        </View>
      </View>
      <Text style={styles.wordmark}>Guess Who</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const MARK = 76;

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  mark: {
    width: MARK,
    height: MARK,
    borderRadius: radii.pill,
    borderWidth: 2.5,
    borderColor: colors.ink,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.raised,
  },
  top: { position: 'absolute', top: 0, left: 0, right: 0, height: MARK / 2, backgroundColor: colors.primary },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: MARK / 2, backgroundColor: colors.surface },
  band: { position: 'absolute', left: 0, right: 0, height: 6, backgroundColor: colors.ink },
  ring: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 2.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: { width: 10, height: 10, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink },
  wordmark: { ...type.display, fontSize: 32 },
  subtitle: { ...type.body, color: colors.inkMuted },
});
