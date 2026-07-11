import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { PokemonCard } from '@/lib/matches';
import { CardBack, colors, Confetti, FlipCard, motion, radii, shadows, spacing, type } from '@/ui';

type Props = {
  outcome: 'win' | 'loss';
  /** The secret the guess resolved (the loser's). Null while the result loads. */
  card: PokemonCard | null;
  oppName: string;
  /** Hand over to the end screen. Also fired by a tap anywhere (skippable). */
  onDone: () => void;
};

/**
 * The match's emotional payoff (PRD 44): a dramatic pause over the dimmed
 * board, the secret card turns over, then a win burst or a wrong-guess
 * sympathy shake — for the guesser and the player watching via Realtime
 * alike. Pure theater over an already-completed match: the sequence gates
 * nothing, a tap skips straight to the end screen, and reduced motion hands
 * over immediately.
 */
export function GuessReveal({ outcome, card, oppName, onDone }: Props) {
  const reduced = useReducedMotion();
  const [pauseDone, setPauseDone] = useState(false);
  const [payoff, setPayoff] = useState(false);
  const bounce = useSharedValue(1);
  const shake = useSharedValue(0);

  // The handover must not restart the timeline if the parent re-renders.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setPauseDone(true), motion.pause);
    return () => clearTimeout(t);
  }, [reduced]);

  // No theatrics under reduced motion — the end screen already tells the story.
  useEffect(() => {
    if (reduced) onDoneRef.current();
  }, [reduced]);

  // The flip waits on both the anticipation beat and the result fetch.
  const revealed = pauseDone && card !== null;

  useEffect(() => {
    if (!revealed) return;
    const settle = motion.flip + 250;
    const toPayoff = setTimeout(() => setPayoff(true), settle);
    const done = setTimeout(() => onDoneRef.current(), settle + motion.payoffHold);
    return () => {
      clearTimeout(toPayoff);
      clearTimeout(done);
    };
  }, [revealed]);

  useEffect(() => {
    if (!payoff) return;
    if (outcome === 'win') {
      bounce.value = withSequence(
        withSpring(1.15, { damping: 6, stiffness: 300 }),
        withSpring(1, { damping: 12, stiffness: 200 }),
      );
    } else {
      shake.value = withSequence(
        withTiming(-8, { duration: 60 }),
        withTiming(8, { duration: 60 }),
        withTiming(-6, { duration: 60 }),
        withTiming(6, { duration: 60 }),
        withTiming(0, { duration: 60 }),
      );
    }
  }, [payoff, outcome, bounce, shake]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bounce.value }, { translateX: shake.value }],
  }));

  if (reduced) return null;

  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.overlay}>
      <Pressable style={styles.stage} onPress={onDone} accessibilityLabel="Skip to the result">
        <Text style={styles.caption}>
          {outcome === 'win' ? 'Your guess…' : `${oppName} made a guess…`}
        </Text>

        <Animated.View style={[styles.cardWrap, cardStyle]}>
          <FlipCard
            flipped={!revealed}
            style={styles.card}
            front={
              <View style={styles.cardFace}>
                {card && (
                  <>
                    <Image
                      source={{ uri: card.sprite_url }}
                      style={styles.sprite}
                      contentFit="contain"
                    />
                    <Text style={styles.cardName}>{card.name}</Text>
                  </>
                )}
              </View>
            }
            back={<CardBack />}
          />
        </Animated.View>

        {payoff && (
          <Animated.Text
            entering={FadeInDown.duration(250)}
            style={[styles.verdict, outcome === 'win' ? styles.verdictWin : styles.verdictLoss]}>
            {outcome === 'win' ? 'You won! 🎉' : 'You lost'}
          </Animated.Text>
        )}

        {payoff && outcome === 'win' && <Confetti />}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backdrop,
    zIndex: 10,
  },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  caption: { ...type.heading, color: colors.onPrimary },
  cardWrap: { width: 170, height: 210 },
  card: { flex: 1 },
  cardFace: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    ...shadows.floating,
  },
  sprite: { width: 120, height: 120 },
  cardName: { ...type.title, textTransform: 'capitalize', marginTop: spacing.sm },
  verdict: { fontSize: 30, fontWeight: '900' },
  verdictWin: { color: colors.accent },
  verdictLoss: { color: colors.onPrimary },
});
