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
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{error ?? 'Profile not found'}</Text>
        </Card>
      </Screen>
    );
  }

  const winRate = winRatePercent(profile.wins, profile.games_played);

  return (
    <Screen>
      {/* Identity as a game piece: avatar in a ringed disc + record subtitle. */}
      <Card style={styles.playerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile.avatar ?? profile.username.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.username}>{profile.username}</Text>
        <Text style={styles.record}>
          {profile.wins}W · {profile.losses}L · {winRate}% win rate
        </Text>
      </Card>

      <View style={styles.statsGrid}>
        <Stat glyph="🎮" label="Played" value={profile.games_played} />
        <Stat glyph="🏆" label="Wins" value={profile.wins} accent />
        <Stat glyph="💀" label="Losses" value={profile.losses} />
        <Stat glyph="🎯" label="Win rate" value={`${winRate}%`} />
        <Stat glyph="🔥" label="Streak" value={profile.current_streak} accent />
        <Stat glyph="⭐" label="Best streak" value={profile.best_streak} />
      </View>

      <View style={styles.spacer} />
      <Button title="Sign out" variant="quiet" onPress={() => signOut()} />
    </Screen>
  );
}

function Stat({
  glyph,
  label,
  value,
  accent,
}: {
  glyph: string;
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <Card style={StyleSheet.flatten([styles.stat, accent && styles.statAccent])}>
      <Text style={styles.statGlyph}>{glyph}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  playerCard: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 2.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  avatarText: { fontSize: 36, fontWeight: '900', color: colors.accentPressed },
  username: { ...type.display },
  record: { ...type.caption, fontWeight: '700' },
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
  statAccent: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  statGlyph: { fontSize: 24 },
  statValue: { fontSize: 24, fontWeight: '900', color: colors.primary },
  statLabel: { ...type.caption, fontWeight: '700' },
  spacer: { flex: 1 },
  errorCard: { alignItems: 'center' },
  errorText: { ...type.body, color: colors.danger, textAlign: 'center' },
});
