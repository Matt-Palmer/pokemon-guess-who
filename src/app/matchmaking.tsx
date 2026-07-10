import { useUser } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { useMatchmaking } from '@/lib/matchmaking';
import { useMatchPlayers } from '@/lib/matches';

/** How long the "Opponent found" confirmation shows before the game begins. */
const CONFIRMATION_MS = 3000;

export default function MatchmakingScreen() {
  const router = useRouter();
  const { user } = useUser();
  const { state, cancel } = useMatchmaking();
  const [cancelling, setCancelling] = useState(false);

  const matchId = state.status === 'matched' ? state.matchId : undefined;
  const players = useMatchPlayers(matchId);
  const opponent = Object.values(players).find((p) => p.clerk_id !== user?.id);

  // Brief confirmation, then straight into the standard draw/play flow.
  useEffect(() => {
    if (!matchId) return;
    const timer = setTimeout(() => router.replace(`/match/${matchId}`), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [matchId, router]);

  const onCancel = async () => {
    setCancelling(true);
    try {
      const racedMatchId = await cancel();
      // A pairing that slipped in before the cancel wins: the opponent is
      // already committed, so stay and let the confirmation play out.
      if (!racedMatchId) router.back();
    } catch {
      setCancelling(false);
    }
  };

  if (state.status === 'matched') {
    return (
      <View style={styles.center}>
        <Text style={styles.foundLabel}>Opponent found</Text>
        <Text style={styles.foundName}>{opponent?.username ?? '…'}</Text>
        <ActivityIndicator color={colors.primary} style={styles.foundSpinner} />
        <Text style={styles.help}>Starting the game…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{state.message}</Text>
        <Pressable style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.searching}>Searching for opponent…</Text>
      <Text style={styles.help}>You’ll be paired with the player who has waited longest.</Text>
      <Pressable
        style={[styles.cancelButton, cancelling && styles.buttonDisabled]}
        onPress={onCancel}
        disabled={cancelling}>
        {cancelling ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.cancelButtonText}>Cancel</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  searching: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 20 },
  help: { color: colors.textMuted, marginTop: 8, textAlign: 'center' },
  foundLabel: { color: colors.textMuted, fontWeight: '600', fontSize: 16 },
  foundName: { fontSize: 28, fontWeight: '800', color: colors.text, marginTop: 6 },
  foundSpinner: { marginTop: 24 },
  cancelButton: {
    marginTop: 32,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    alignItems: 'center',
  },
  cancelButtonText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
  buttonDisabled: { opacity: 0.6 },
  error: { color: colors.wrong, textAlign: 'center' },
});
