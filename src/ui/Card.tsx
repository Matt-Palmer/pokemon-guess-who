import { ReactNode, useCallback } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { colors, radii, shadows, spacing } from '@/ui/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  children: ReactNode;
  /** When set, the card is tappable and gives a tactile press response. */
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
};

/** A tactile playing-piece surface: warm face, outline, hard drop shadow. */
export function Card({ children, onPress, onLongPress, style }: Props) {
  const pressed = useSharedValue(0);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.02 }, { translateY: pressed.value * 2 }],
  }));

  const onPressIn = useCallback(() => {
    pressed.value = withSpring(1, { damping: 20, stiffness: 400 });
  }, [pressed]);
  const onPressOut = useCallback(() => {
    pressed.value = withSpring(0, { damping: 20, stiffness: 400 });
  }, [pressed]);

  if (!onPress && !onLongPress) {
    return <View style={[styles.card, style]}>{children}</View>;
  }

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[styles.card, pressStyle, style]}>
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
});
