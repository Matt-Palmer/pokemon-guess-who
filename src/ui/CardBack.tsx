import { StyleSheet, View, ViewStyle } from 'react-native';

import { colors, radii } from '@/ui/theme';

/**
 * The reverse of every card in the game: game-box red with a poké-ball motif
 * built from plain Views (content over chrome — no image assets). Shared by
 * face-down tiles, the draw ceremony, and the guess reveal so "face-down"
 * always looks like the same deck.
 */
export function CardBack({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.root, style]}>
      <View style={styles.band} />
      <View style={styles.ring}>
        <View style={styles.core} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.primaryPressed,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: colors.primaryPressed,
  },
  ring: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    backgroundColor: colors.onPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    width: 12,
    height: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryPressed,
  },
});
