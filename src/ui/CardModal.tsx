import { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { colors, radii, shadows, spacing, type } from '@/ui/theme';

type Props = {
  visible: boolean;
  /** Backdrop tap / hardware back. Dismissal must be non-destructive (drafts survive). */
  onClose: () => void;
  title?: string;
  children: ReactNode;
  cardStyle?: ViewStyle;
};

/**
 * The house overlay: a card floating over the dimmed screen. Tap outside to
 * dismiss — the pattern the chat modal, review panel, and card details share.
 */
export function CardModal({ visible, onClose, title, children, cardStyle }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoider}
          pointerEvents="box-none">
          {/* Inner pressable eats taps so only true backdrop taps dismiss. */}
          <Pressable style={styles.cardWrap}>
            <Animated.View entering={ZoomIn.springify().damping(18)} style={[styles.card, cardStyle]}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {children}
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  avoider: { justifyContent: 'center' },
  cardWrap: { width: '100%' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.xl,
    maxHeight: '100%',
    ...shadows.floating,
  },
  title: { ...type.title, marginBottom: spacing.md },
});
