import { Image } from 'expo-image';
import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';

import { PokemonCard } from '@/lib/matches';
import { CardBack, colors, dealDelay, FlipCard, radii, shadows, spacing } from '@/ui';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  card: PokemonCard;
  /** Face-down = crossed off in play, undrawn in the blind draw. */
  faceDown: boolean;
  /** Board position, for the deal-in stagger. */
  dealIndex: number;
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
  onLongPress?: () => void;
};

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
  mine,
  backMark,
  targeted,
  disabled,
  shakeNonce,
  onPress,
  onLongPress,
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
      onPressOut={onPressOut}
      onLongPress={onLongPress}>
      <FlipCard
        flipped={faceDown}
        style={styles.flip}
        front={
          <View style={[styles.face, mine && styles.faceMine, targeted && styles.faceTargeted]}>
            <Image source={{ uri: card.sprite_url }} style={styles.sprite} contentFit="contain" />
            <Text style={styles.name} numberOfLines={1}>
              {card.name}
            </Text>
          </View>
        }
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
  sprite: { width: '100%', flex: 1 },
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
