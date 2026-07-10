import { useAuth } from '@clerk/clerk-expo';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { winRatePercent } from '@/lib/game/stats';
import { useProfile } from '@/lib/profile';
import { Button, Card, Screen, colors, radii, spacing, type } from '@/ui';

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { profile, loading, error, refetch } = useProfile();

  // Stats are written server-side when a game ends; re-read them whenever the
  // tab regains focus so the record reflects games completed this session.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  if (loading) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }

  if (error || !profile) {
    return (
      <Screen style={styles.center}>
        <Text style={styles.error}>{error ?? 'Profile not found'}</Text>
      </Screen>
    );
  }

  const winRate = winRatePercent(profile.wins, profile.games_played);

  return (
    <Screen>
      <Card style={styles.playerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile.avatar ?? profile.username.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.username}>{profile.username}</Text>
      </Card>

      <View style={styles.statsGrid}>
        <Stat label="Played" value={profile.games_played} />
        <Stat label="Wins" value={profile.wins} />
        <Stat label="Losses" value={profile.losses} />
        <Stat label="Win rate" value={`${winRate}%`} />
        <Stat label="Streak" value={profile.current_streak} />
        <Stat label="Best streak" value={profile.best_streak} />
      </View>

      <View style={styles.spacer} />
      <Button title="Sign out" variant="quiet" onPress={() => signOut()} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  playerCard: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '900', color: colors.accentPressed },
  username: { ...type.title },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  stat: {
    flexBasis: '30%',
    flexGrow: 1,
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.xs,
  },
  statValue: { fontSize: 22, fontWeight: '900', color: colors.primary },
  statLabel: { ...type.caption, fontWeight: '700' },
  spacer: { flex: 1 },
  error: { ...type.body, color: colors.danger },
});
