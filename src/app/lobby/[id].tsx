import { useUser } from '@clerk/clerk-expo';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { startMatch, useMatch, useMatchPlayers } from '@/lib/matches';
import { useSupabase } from '@/lib/supabase';

export default function LobbyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useUser();
  const supabase = useSupabase();
  const router = useRouter();
  const { match, loading, error } = useMatch(id);
  const players = useMatchPlayers(id);

  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const isHost = match?.player1_id === user?.id;
  const opponentId = isHost ? match?.player2_id : match?.player1_id;
  const opponent = opponentId ? players[opponentId] : undefined;

  // Once the host starts, both devices see status flip to `active` over Realtime
  // and advance to the shared board together.
  useEffect(() => {
    if (match?.status === 'active') router.replace(`/match/${id}`);
  }, [match?.status, id, router]);

  const onCopy = async () => {
    if (!match?.party_code) return;
    await Clipboard.setStringAsync(match.party_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onStart = async () => {
    if (!id) return;
    setStartError(null);
    setStarting(true);
    try {
      await startMatch(supabase, id);
      // Navigation happens via the Realtime status update above.
    } catch (err: any) {
      setStartError(err?.message ?? 'Could not start the game.');
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !match) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Party not found.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Party code</Text>
        <Text style={styles.code}>{match.party_code}</Text>
        <Pressable style={styles.copyButton} onPress={onCopy}>
          <Text style={styles.copyButtonText}>{copied ? 'Copied!' : 'Copy code'}</Text>
        </Pressable>
      </View>

      <View style={styles.statusCard}>
        {match.player2_id ? (
          <>
            <Text style={styles.joinedLabel}>Opponent joined</Text>
            <Text style={styles.joinedName}>{opponent?.username ?? '…'}</Text>
          </>
        ) : (
          <View style={styles.waitingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.waiting}>Waiting for opponent…</Text>
          </View>
        )}
      </View>

      {isHost ? (
        <>
          <Pressable
            style={[styles.startButton, (!match.player2_id || starting) && styles.buttonDisabled]}
            onPress={onStart}
            disabled={!match.player2_id || starting}>
            {starting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.startButtonText}>Start</Text>
            )}
          </Pressable>
          {startError && <Text style={styles.error}>{startError}</Text>}
        </>
      ) : (
        <Text style={styles.waitingHost}>Waiting for the host to start…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  codeCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
  },
  codeLabel: { color: colors.textMuted, fontWeight: '600' },
  code: { fontSize: 40, fontWeight: '800', letterSpacing: 8, color: colors.text, marginVertical: 12 },
  copyButton: {
    backgroundColor: colors.primaryBg,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  copyButtonText: { color: colors.primaryDark, fontWeight: '700' },
  statusCard: { alignItems: 'center', marginTop: 32 },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  waiting: { color: colors.textMuted, fontSize: 16 },
  joinedLabel: { color: colors.textMuted, fontWeight: '600' },
  joinedName: { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 4 },
  startButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 'auto',
  },
  startButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  buttonDisabled: { opacity: 0.5 },
  waitingHost: { marginTop: 'auto', textAlign: 'center', color: colors.textMuted, fontSize: 16 },
  error: { color: colors.wrong, marginTop: 16, textAlign: 'center' },
});
