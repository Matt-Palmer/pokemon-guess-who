import { useUser } from '@clerk/clerk-expo';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { startMatch, useMatch, useMatchPlayers } from '@/lib/matches';
import { useSupabase } from '@/lib/supabase';
import { Button, Card, Screen, colors, radii, spacing, type } from '@/ui';

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
      <Screen style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }

  if (error || !match) {
    return (
      <Screen style={styles.center}>
        <Text style={styles.error}>{error ?? 'Party not found.'}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card style={styles.codeCard}>
        <Text style={styles.codeLabel}>Party code</Text>
        <Text style={styles.code}>{match.party_code}</Text>
        <Button
          title={copied ? 'Copied!' : 'Copy code'}
          variant="secondary"
          onPress={onCopy}
          style={styles.copyButton}
        />
      </Card>

      <View style={styles.statusCard}>
        {match.player2_id ? (
          <>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {opponent?.avatar || opponent?.username?.charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
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

      <View style={styles.spacer} />

      {isHost ? (
        <>
          <Button
            title="Start"
            onPress={onStart}
            busy={starting}
            disabled={!match.player2_id || starting}
          />
          {startError && <Text style={styles.error}>{startError}</Text>}
        </>
      ) : (
        <Text style={styles.waitingHost}>Waiting for the host to start…</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  codeCard: { alignItems: 'center', gap: spacing.sm },
  codeLabel: { ...type.label, color: colors.inkMuted },
  code: { fontSize: 40, fontWeight: '900', letterSpacing: 8, color: colors.ink },
  copyButton: { alignSelf: 'center', paddingHorizontal: spacing.xl },
  statusCard: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  avatarText: { fontSize: 28, fontWeight: '900', color: colors.accentPressed },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  waiting: { ...type.body, color: colors.inkMuted },
  joinedLabel: { ...type.label, color: colors.inkMuted },
  joinedName: { ...type.title },
  spacer: { flex: 1 },
  waitingHost: { ...type.body, textAlign: 'center', color: colors.inkMuted },
  error: { ...type.body, color: colors.danger, marginTop: spacing.md, textAlign: 'center' },
});
