import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/ui/theme';

const PIECE_COLORS = [colors.primary, colors.accent, colors.success, colors.primarySoft];

type Piece = {
  angle: number;
  distance: number;
  spin: number;
  size: number;
  color: string;
};

function makePieces(count: number): Piece[] {
  return Array.from({ length: count }, (_, i) => ({
    // Bias the burst upward — gravity brings the pieces back down through view.
    angle: Math.PI * (1 + Math.random()),
    distance: 90 + Math.random() * 160,
    spin: (Math.random() - 0.5) * 1080,
    size: 8 + Math.random() * 8,
    color: PIECE_COLORS[i % PIECE_COLORS.length],
  }));
}

function ConfettiPiece({ piece, progress }: { piece: Piece; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: 1 - p * p,
      transform: [
        { translateX: Math.cos(piece.angle) * piece.distance * p },
        // Ballistic: outward throw plus gravity pulling the fall in late.
        { translateY: Math.sin(piece.angle) * piece.distance * p + 260 * p * p },
        { rotate: `${piece.spin * p}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.piece,
        { width: piece.size, height: piece.size * 0.6, backgroundColor: piece.color },
        style,
      ]}
    />
  );
}

/**
 * A one-shot celebration burst from the center of wherever it's mounted
 * (typically over an absoluteFill). One shared progress drives every piece on
 * the UI thread; pieces get random throw parameters at mount. Decorative
 * only — it swallows no touches and renders nothing under reduced motion.
 */
export function Confetti({ count = 28, duration = 1600 }: { count?: number; duration?: number }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const pieces = useMemo(() => makePieces(count), [count]);

  useEffect(() => {
    if (!reduced) {
      progress.value = withTiming(1, { duration, easing: Easing.out(Easing.quad) });
    }
  }, [reduced, duration, progress]);

  if (reduced) return null;

  return (
    <View pointerEvents="none" style={styles.stage}>
      {pieces.map((piece, i) => (
        <ConfettiPiece key={i} piece={piece} progress={progress} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  piece: { position: 'absolute', borderRadius: 2 },
});
