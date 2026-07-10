import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { colors, spacing } from '@/ui/theme';

type Props = {
  children: ReactNode;
  /** Set false for edge-to-edge layouts (e.g. the board). */
  padded?: boolean;
  style?: ViewStyle;
};

/**
 * The tabletop every screen sits on. Router headers own the top safe area;
 * screens that go headerless handle their own insets.
 */
export function Screen({ children, padded = true, style }: Props) {
  return <View style={[styles.root, padded && styles.padded, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  padded: { padding: spacing.xl },
});
