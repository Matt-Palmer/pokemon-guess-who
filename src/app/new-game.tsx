import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '@/constants/colors';
import { createParty, joinParty } from '@/lib/matches';
import { useSupabase } from '@/lib/supabase';

export default function NewGameScreen() {
  const supabase = useSupabase();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<null | 'create' | 'join'>(null);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setError(null);
    setBusy('create');
    try {
      const match = await createParty(supabase);
      router.replace(`/lobby/${match.id}`);
    } catch (err: any) {
      setError(err?.message ?? 'Could not start a party.');
      setBusy(null);
    }
  };

  const onJoin = async () => {
    if (code.trim().length < 6) {
      setError('Enter the 6-character party code.');
      return;
    }
    setError(null);
    setBusy('join');
    try {
      const match = await joinParty(supabase, code);
      router.replace(`/lobby/${match.id}`);
    } catch (err: any) {
      setError(err?.message ?? 'Could not join that party.');
      setBusy(null);
    }
  };

  const disabled = busy !== null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Start a party</Text>
      <Text style={styles.help}>Create a private game and share the code with a friend.</Text>
      <Pressable
        style={[styles.button, disabled && styles.buttonDisabled]}
        onPress={onCreate}
        disabled={disabled}>
        {busy === 'create' ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.buttonText}>Start a party</Text>
        )}
      </Pressable>

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>Join a party</Text>
      <Text style={styles.help}>Enter the code a friend shared with you.</Text>
      <TextInput
        style={styles.input}
        placeholder="Party code"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        editable={!disabled}
      />
      <Pressable
        style={[styles.buttonSecondary, disabled && styles.buttonDisabled]}
        onPress={onJoin}
        disabled={disabled}>
        {busy === 'join' ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.buttonSecondaryText}>Join party</Text>
        )}
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.divider} />

      <Pressable style={[styles.button, styles.buttonMuted]} disabled>
        <Text style={styles.buttonMutedText}>Find a random game (coming soon)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.background },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  help: { color: colors.textMuted, marginTop: 4, marginBottom: 12 },
  button: { backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: 'center' },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  buttonSecondary: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
  },
  buttonSecondaryText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
  buttonDisabled: { opacity: 0.6 },
  buttonMuted: { backgroundColor: colors.border },
  buttonMutedText: { color: colors.textMuted, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 18,
    letterSpacing: 4,
    textAlign: 'center',
    fontWeight: '700',
    color: colors.text,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 24 },
  error: { color: colors.wrong, marginTop: 16, textAlign: 'center' },
});
