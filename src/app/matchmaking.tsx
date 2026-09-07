import { useUser } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useMatchmaking } from '@/lib/matchmaking';
import { useMatchPlayers } from '@/lib/matches';
import { Button, Screen, colors, radii, spacing, type } from '@/ui';

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
      <Screen style={styles.center}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {opponent?.avatar || opponent?.username?.charAt(0).toUpperCase() || '?'}
          </Text>
        </View>
        <Text style={styles.foundLabel}>Opponent found</Text>
        <Text style={styles.foundName}>{opponent?.username ?? '…'}</Text>
        <ActivityIndicator color={colors.primary} style={styles.foundSpinner} />
        <Text style={styles.help}>Starting the game…</Text>
      </Screen>
    );
  }

  if (state.status === 'error') {
    return (
      <Screen style={styles.center}>
        <Text style={styles.error}>{state.message}</Text>
        <Button title="Back" variant="secondary" onPress={() => router.back()} style={styles.action} />
      </Screen>
    );
  }

  return (
    <Screen style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.searching}>Searching for opponent…</Text>
      <Text style={styles.help}>You’ll be paired with the player who has waited longest.</Text>
      <Button
        title="Cancel"
        variant="secondary"
        onPress={onCancel}
        busy={cancelling}
        disabled={cancelling}
        style={styles.action}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  searching: { ...type.title, marginTop: spacing.xl },
  help: { ...type.body, color: colors.inkMuted, marginTop: spacing.sm, textAlign: 'center' },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { fontSize: 32, fontWeight: '900', color: colors.accentPressed },
  foundLabel: { ...type.label, color: colors.inkMuted },
  foundName: { ...type.display, marginTop: spacing.xs },
  foundSpinner: { marginTop: spacing.xl },
  action: { alignSelf: 'stretch', marginTop: spacing.xl },
  error: { ...type.body, color: colors.danger, textAlign: 'center' },
});
