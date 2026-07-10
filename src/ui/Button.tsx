import { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/ui/theme';

type Variant = 'primary' | 'accent' | 'secondary' | 'danger' | 'quiet';

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Shows a spinner in place of the title (and disables presses). */
  busy?: boolean;
  style?: ViewStyle;
};

/** Face/edge colors per variant — the edge is the button's visible "thickness". */
const faces: Record<Variant, { face: string; edge: string; text: string; border?: string }> = {
  primary: { face: colors.primary, edge: colors.primaryPressed, text: colors.onPrimary },
  accent: { face: colors.accent, edge: colors.accentPressed, text: colors.onAccent },
  secondary: { face: colors.surface, edge: colors.border, text: colors.ink, border: colors.border },
  danger: { face: colors.danger, edge: '#A32D2D', text: colors.onPrimary },
  quiet: { face: 'transparent', edge: 'transparent', text: colors.inkMuted },
};

const EDGE = 4;

/**
 * A physical push-button: the face sits on a darker edge and depresses into it
 * on touch, like a piece being pushed into the board.
 */
export function Button({ title, onPress, variant = 'primary', disabled, busy, style }: Props) {
  const { face, edge, text, border } = faces[variant];
  const pressed = useSharedValue(0);
  const flat = variant === 'quiet';

  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pressed.value * (flat ? 0 : EDGE) }],
  }));

  const onPressIn = useCallback(() => {
    pressed.value = withSpring(1, { damping: 20, stiffness: 400 });
  }, [pressed]);
  const onPressOut = useCallback(() => {
    pressed.value = withSpring(0, { damping: 20, stiffness: 400 });
  }, [pressed]);

  const blocked = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={blocked}
      style={[styles.root, { backgroundColor: edge }, disabled && styles.disabled, style]}>
      <Animated.View
        style={[
          styles.face,
          { backgroundColor: face },
          border ? { borderWidth: 1.5, borderColor: border } : null,
          flat && styles.flatFace,
          faceStyle,
        ]}>
        {busy ? (
          <ActivityIndicator color={text} />
        ) : (
          <Text style={[styles.title, { color: text }]}>{title}</Text>
        )}
      </Animated.View>
      {!flat && <View style={styles.edgeSpacer} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { borderRadius: radii.md, alignSelf: 'stretch' },
  face: {
    borderRadius: radii.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  flatFace: { paddingVertical: spacing.md, minHeight: 0 },
  edgeSpacer: { height: EDGE },
  title: { fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
