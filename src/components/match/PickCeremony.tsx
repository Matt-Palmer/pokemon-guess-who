import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { PokemonImage } from '@/components/match/PokemonImage';
import { PokemonCard } from '@/lib/matches';
import { colors, radii, shadows, spacing, type } from '@/ui';

/** What the match is still waiting on, once you've locked your secret in. */
export type PickWait = 'opponent' | 'start';

type Props = {
  /** The secret you just locked in — this overlay is yours alone. */
  card: PokemonCard;
  wait: PickWait;
  oppName: string;
};

/**
 * The beat after you lock in your secret: the board falls away behind this and
 * your chosen card takes the centre of the screen.
 *
 * It doubles as the waiting state, which is why it has two captions rather than
 * a spinner on an empty screen — the thing you most want to be looking at while
 * you wait is the card you just committed to for the rest of the match.
 *
 * If you picked first you land on `opponent` and move to `start` when their pick
 * arrives over Realtime; if you picked second you open straight on `start`. The
 * match screen holds `start` for a deliberate beat before play opens, so the
 * transition is never a jump-cut.
 *
 * Purely presentational — the secret is already written server-side by the time
 * this mounts, so an interruption here costs nothing but the animation.
 */
export function PickCeremony({ card, wait, oppName }: Props) {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.overlay}>
      <Animated.View entering={ZoomIn.springify().damping(16)} style={styles.cardWrap}>
        <View style={styles.card}>
          <PokemonImage uri={card.sprite_url} style={styles.sprite} />
          <Text style={styles.name}>{card.name}</Text>
        </View>
        <Text style={styles.caption}>Your secret</Text>
      </Animated.View>

      {/* Keyed so the caption change animates rather than swapping in place. */}
      <Animated.View key={wait} entering={FadeIn.duration(250)} style={styles.waitRow}>
        <Text style={styles.waitText}>
          {wait === 'opponent' ? `Waiting for ${oppName}…` : 'Waiting for game to start'}
        </Text>
        {wait === 'start' && <ActivityIndicator color={colors.primary} />}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xl,
  },
  cardWrap: { alignItems: 'center', gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 2.5,
    borderColor: colors.accent,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadows.floating,
  },
  sprite: { width: 180, height: 180 },
  name: { ...type.title, textTransform: 'capitalize' },
  caption: { ...type.caption, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  waitText: { ...type.body, color: colors.inkMuted },
});
