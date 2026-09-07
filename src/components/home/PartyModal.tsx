import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { createParty, joinParty } from '@/lib/matches';
import { useSupabase } from '@/lib/supabase';
import { Button, CardModal, TextField, colors, spacing, type } from '@/ui';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called with the new/joined match id once a lobby exists to route into. */
  onEnterLobby: (matchId: string) => void;
};

/**
 * "Play a friend": create a private party or join one by code. Folds the old
 * new-game route into a shared modal over the home screen — the flows and
 * hooks (`createParty` / `joinParty`) are unchanged.
 */
export function PartyModal({ visible, onClose, onEnterLobby }: Props) {
  const supabase = useSupabase();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<null | 'create' | 'join'>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCode('');
    setBusy(null);
    setError(null);
  };

  const close = () => {
    if (busy) return; // don't dismiss mid-request
    reset();
    onClose();
  };

  const onCreate = async () => {
    setError(null);
    setBusy('create');
    try {
      const match = await createParty(supabase);
      reset();
      onEnterLobby(match.id);
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
      reset();
      onEnterLobby(match.id);
    } catch (err: any) {
      setError(err?.message ?? 'Could not join that party.');
      setBusy(null);
    }
  };

  const disabled = busy !== null;

  return (
    <CardModal visible={visible} onClose={close} title="Play a friend">
      <View style={styles.body}>
        <Text style={styles.help}>Create a private game and share the code with a friend.</Text>
        <Button title="Start a party" onPress={onCreate} busy={busy === 'create'} disabled={disabled} />

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or join</Text>
          <View style={styles.divider} />
        </View>

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

        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </CardModal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  help: { ...type.body, color: colors.inkMuted },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  divider: { flex: 1, height: 1.5, backgroundColor: colors.border },
  dividerText: { ...type.caption, fontWeight: '700' },
  codeInput: { textAlign: 'center', letterSpacing: 4, fontWeight: '800', fontSize: 18 },
  error: { ...type.body, color: colors.danger, textAlign: 'center' },
});
