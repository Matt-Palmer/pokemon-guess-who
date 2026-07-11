import { ReactNode, useEffect } from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/ui/motion';

type Props = {
  /** true shows `back` (face-down); flipping the prop animates the turn-over. */
  flipped: boolean;
  front: ReactNode;
  back: ReactNode;
  duration?: number;
  /** Must give the card its size (flex or explicit) — the faces fill it. */
  style?: ViewStyle;
};

/**
 * A physical two-faced card: front and back live on opposite sides of a 3D
 * rotateY, so toggling `flipped` turns the piece over like a tile on the
 * table. Purely presentational — the prop is the state, so a mid-flip
 * re-render or interruption just retargets the animation. Mounting already
 * flipped renders face-down with no animation; reduced motion turns instantly.
 */
export function FlipCard({ flipped, front, back, duration = motion.flip, style }: Props) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(flipped ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(flipped ? 1 : 0, { duration: reduced ? 0 : duration });
  }, [flipped, reduced, duration, progress]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${progress.value * 180}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${180 + progress.value * 180}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <Animated.View style={[styles.face, frontStyle]}>{front}</Animated.View>
      <Animated.View style={[styles.face, backStyle]}>{back}</Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  face: {
    ...StyleSheet.absoluteFillObject,
    backfaceVisibility: 'hidden',
  },
});
