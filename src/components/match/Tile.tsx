import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';

import { typeColors } from '@/constants/colors';
import { regionForGeneration } from '@/constants/regions';
import { PokemonCard } from '@/lib/matches';
import { CardBack, colors, dealDelay, FlipCard, motion, radii, shadows, spacing } from '@/ui';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Which facet the face shows — the board's shared view mode. */
export type TileView = 'pokemon' | 'type' | 'region';

type Props = {
  card: PokemonCard;
  /** Face-down = crossed off in play, undrawn in the blind draw. */
  faceDown: boolean;
  /** Board position, for the deal-in and view-change staggers. */
  dealIndex: number;
  /** Which facet the face shows (Pokémon sprite / type / region). */
  view?: TileView;
  /** Your own secret: accent border face-up... */
  mine?: boolean;
  /** ...or a ★ on the back while the board is face-down in the draw. */
  backMark?: string;
  /** Guess-mode target highlight. */
  targeted?: boolean;
  disabled?: boolean;
  /** Increment to play the wrong-guess sympathy shake. */
  shakeNonce?: number;
  onPress: () => void;
};

/** The Pokédex number as a padded `#025`. */
const dexNumber = (id: number) => `#${String(id).padStart(3, '0')}`;

/**
 * The face-up content: the Pokédex number (corner) and name (bottom) stay put in
 * every view; only the hero swaps — sprite ↔ type chips ↔ region name. Changing
 * `view` turns the face over (a half-flip out/in), staggered across the board by
 * `dealIndex` so the change ripples like a wave. Reduced motion swaps instantly.
 */
function TileFace({
  card,
  view,
  mine,
  targeted,
  dealIndex,
}: {
  card: PokemonCard;
  view: TileView;
  mine?: boolean;
  targeted?: boolean;
  dealIndex: number;
}) {
  const reduced = useReducedMotion();
  // The facet actually rendered — lags `view` until the face is edge-on, so the
  // swap is hidden mid-flip.
  const [shown, setShown] = useState<TileView>(view);
  const spin = useSharedValue(0);

  useEffect(() => {
    if (view === shown) return;
    if (reduced) {
      setShown(view);
      return;
    }
    const half = motion.flip / 2;
    // Turn edge-on, swap the hero while it's hidden, then turn back to face.
    spin.value = withDelay(
      dealDelay(dealIndex),
      withSequence(
        withTiming(90, { duration: half }, (finished) => {
          if (finished) runOnJS(setShown)(view);
        }),
        withTiming(0, { duration: half }),
      ),
    );
  }, [view, shown, reduced, dealIndex, spin]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${spin.value}deg` }],
  }));

  return (
    <Animated.View
      style={[styles.face, mine && styles.faceMine, targeted && styles.faceTargeted, spinStyle]}>
      <Text style={styles.dex}>{dexNumber(card.id)}</Text>

      <View style={styles.hero}>
        {shown === 'pokemon' && (
          <Image source={{ uri: card.sprite_url }} style={styles.sprite} contentFit="contain" />
        )}
        {shown === 'type' && (
          <View style={styles.typeStack}>
            {card.types.map((t) => (
              <View key={t} style={[styles.typeChip, { backgroundColor: typeColors[t] ?? colors.inkMuted }]}>
                <Text style={styles.typeChipText} numberOfLines={1}>
                  {t}
                </Text>
              </View>
            ))}
          </View>
        )}
        {shown === 'region' && (
          <View style={styles.regionPanel}>
            <Text style={styles.regionText} numberOfLines={1} adjustsFontSizeToFit>
              {regionForGeneration(card.generation)}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {card.name}
      </Text>
    </Animated.View>
  );
}

/**
 * One board tile as a physical piece: deals in with the board wave, squishes
 * under the finger, and turns over — cross-offs flip it face-down onto the
 * shared CardBack instead of stamping an ✕. All presentation: the flip just
 * follows `faceDown`, so optimistic marks, Realtime reconciliation, and
 * interruptions land on a correct board.
 */
export function Tile({
  card,
  faceDown,
  dealIndex,
  view = 'pokemon',
  mine,
  backMark,
  targeted,
  disabled,
  shakeNonce,
  onPress,
}: Props) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (!shakeNonce) return;
    shake.value = reduced
      ? 0
      : withSequence(
          withTiming(-5, { duration: 50 }),
          withTiming(5, { duration: 50 }),
          withTiming(-4, { duration: 50 }),
          withTiming(4, { duration: 50 }),
          withTiming(0, { duration: 50 }),
        );
  }, [shakeNonce, reduced, shake]);

  const pieceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.05 }, { translateX: shake.value }],
  }));

  const onPressIn = useCallback(() => {
    pressed.value = withSpring(1, { damping: 20, stiffness: 400 });
  }, [pressed]);
  const onPressOut = useCallback(() => {
    pressed.value = withSpring(0, { damping: 20, stiffness: 400 });
  }, [pressed]);

  return (
    <AnimatedPressable
      entering={ZoomIn.springify().damping(16).delay(dealDelay(dealIndex))}
      style={[styles.root, pieceStyle]}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}>
      <FlipCard
        flipped={faceDown}
        style={styles.flip}
        front={<TileFace card={card} view={view} mine={mine} targeted={targeted} dealIndex={dealIndex} />}
        back={
          <>
            <CardBack />
            {backMark ? <Text style={styles.backMark}>{backMark}</Text> : null}
          </>
        }
      />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flip: { flex: 1 },
  face: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
    ...shadows.card,
  },
  faceMine: { borderColor: colors.accent, borderWidth: 2.5 },
  faceTargeted: {
    borderColor: colors.success,
    borderWidth: 3,
    backgroundColor: colors.successSoft,
  },
  dex: {
    position: 'absolute',
    top: 3,
    left: 5,
    fontSize: 8,
    fontWeight: '800',
    color: colors.inkFaint,
  },
  hero: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  sprite: { width: '100%', flex: 1 },
  typeStack: { gap: 3, alignItems: 'stretch', width: '100%', paddingHorizontal: 2 },
  typeChip: {
    borderRadius: radii.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
  },
  typeChipText: { color: colors.onPrimary, fontWeight: '800', fontSize: 9, textTransform: 'capitalize' },
  regionPanel: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.accent,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    maxWidth: '100%',
  },
  regionText: { color: colors.accentPressed, fontWeight: '900', fontSize: 12, textAlign: 'center' },
  name: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.ink,
    textTransform: 'capitalize',
  },
  backMark: {
    position: 'absolute',
    alignSelf: 'center',
    top: '30%',
    fontSize: 22,
    fontWeight: '800',
    color: colors.onPrimary,
    textShadowColor: colors.primaryPressed,
    textShadowRadius: 4,
  },
});
