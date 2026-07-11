import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, useReducedMotion } from 'react-native-reanimated';

import { PokemonCard } from '@/lib/matches';
import { Button, CardBack, colors, FlipCard, motion, radii, shadows, spacing, type } from '@/ui';

type Props = {
  /** The secret just drawn — this overlay is the drawer's eyes only. */
  card: PokemonCard;
  onDone: () => void;
};

/**
 * The blind draw's ritual: the drawn card slides out of the deck face-down,
 * holds a beat, and turns over to show the player their secret. Client-side
 * presentation for the drawer alone (the opponent only ever sees the drawn
 * flag flip). Dismissal is explicit — you don't rush someone memorizing
 * their secret. Reduced motion presents the card face-up, statically.
 */
export function DrawCeremony({ card, onDone }: Props) {
  const reduced = useReducedMotion();
  const [revealed, setRevealed] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    // Slide-out settles, then a beat of anticipation before the turn-over.
    const t = setTimeout(() => setRevealed(true), motion.pause);
    return () => clearTimeout(t);
  }, [reduced]);

  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.overlay}>
      <View style={styles.stage}>
        <Text style={styles.caption}>Your secret</Text>

        <Animated.View
          entering={SlideInDown.springify().damping(16)}
          style={styles.cardWrap}>
          <FlipCard
            flipped={!revealed}
            style={styles.card}
            front={
              <View style={styles.cardFace}>
                <Image source={{ uri: card.sprite_url }} style={styles.sprite} contentFit="contain" />
                <Text style={styles.cardName}>{card.name}</Text>
              </View>
            }
            back={<CardBack />}
          />
        </Animated.View>

        {revealed && (
          <Animated.View entering={FadeIn.duration(250)} style={styles.footer}>
            <Text style={styles.hint}>Don&apos;t let your opponent guess it.</Text>
            <Button title="Got it" variant="accent" onPress={onDone} />
          </Animated.View>
        )}
      </View>
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
  footer: { alignItems: 'center', gap: spacing.md, minWidth: 200 },
  hint: { ...type.body, color: colors.onPrimary },
});
