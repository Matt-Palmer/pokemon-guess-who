import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { CardModal } from '@/ui/CardModal';
import { colors, spacing, type } from '@/ui/theme';

export type Confirmation = {
  title: string;
  message: string;
  /** Label for the affirmative action — say what it does, not "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Irreversible actions (resign) get the danger treatment. */
  danger?: boolean;
  onConfirm: () => void;
};

/**
 * The house confirmation dialog, replacing `Alert.alert`.
 *
 * `Alert` is **not implemented by React Native Web** — it is a silent no-op, so
 * every confirm-gated action (resign, claim, reveal) did nothing at all in a
 * browser: the button appeared to be broken because the dialog that would have
 * triggered the write never opened. Building on {@link CardModal} instead means
 * one dialog that works everywhere and looks like the rest of the game rather
 * than like the OS.
 */
export function ConfirmDialog({
  confirmation,
  busy,
  onCancel,
}: {
  confirmation: Confirmation | null;
  busy?: boolean;
  onCancel: () => void;
}) {
  return (
    <CardModal
      visible={Boolean(confirmation)}
      onClose={busy ? () => {} : onCancel}
      title={confirmation?.title}>
      <View style={styles.body}>
        <Text style={styles.message}>{confirmation?.message}</Text>
        <Button
          title={confirmation?.confirmLabel ?? 'Confirm'}
          variant={confirmation?.danger ? 'danger' : 'primary'}
          busy={busy}
          onPress={() => confirmation?.onConfirm()}
        />
        <Button
          title={confirmation?.cancelLabel ?? 'Cancel'}
          variant="secondary"
          disabled={busy}
          onPress={onCancel}
        />
      </View>
    </CardModal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  message: { ...type.body, color: colors.inkMuted, marginBottom: spacing.xs },
});
