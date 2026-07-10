import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { createParty, joinParty } from '@/lib/matches';
import { useSupabase } from '@/lib/supabase';
import { Button, Card, Screen, TextField, colors, spacing, type } from '@/ui';

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
    <Screen>
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Play a friend</Text>
        <Text style={styles.help}>Create a private game and share the code with a friend.</Text>
        <Button
          title="Start a party"
          onPress={onCreate}
          busy={busy === 'create'}
          disabled={disabled}
        />
        <View style={styles.divider} />
        <Text style={styles.help}>Or enter the code a friend shared with you.</Text>
        <TextField
          style={styles.codeInput}
          placeholder="PARTY CODE"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          editable={!disabled}
        />
        <Button
          title="Join party"
          variant="secondary"
          onPress={onJoin}
          busy={busy === 'join'}
          disabled={disabled}
        />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Random opponent</Text>
        <Text style={styles.help}>Get matched with the longest-waiting player.</Text>
        <Button
          title="Find a random game"
          variant="accent"
          onPress={() => router.replace('/matchmaking')}
          disabled={disabled}
        />
      </Card>

      {error && <Text style={styles.error}>{error}</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg, gap: spacing.md },
  sectionTitle: { ...type.title },
  help: { ...type.body, color: colors.inkMuted },
  divider: { height: 1.5, backgroundColor: colors.border, marginVertical: spacing.xs },
  codeInput: { textAlign: 'center', letterSpacing: 4, fontWeight: '800', fontSize: 18 },
  error: { ...type.body, color: colors.danger, textAlign: 'center', marginTop: spacing.sm },
});
