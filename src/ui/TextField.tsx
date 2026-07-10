import { forwardRef } from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';

import { colors, radii, spacing } from '@/ui/theme';

/** The house text input: a sunken well in the tabletop. */
export const TextField = forwardRef<TextInput, TextInputProps>(function TextField(
  { style, ...props },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.inkMuted}
      {...props}
      style={[styles.input, style]}
    />
  );
});

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.ink,
  },
});
