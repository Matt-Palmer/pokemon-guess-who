import { useAuth } from '@clerk/clerk-expo';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { winRatePercent } from '@/lib/game/stats';
import { useProfile } from '@/lib/profile';

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
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Profile not found'}</Text>
      </View>
    );
  }

  const winRate = winRatePercent(profile.wins, profile.games_played);

  return (
    <View style={styles.container}>
      <Text style={styles.username}>{profile.username}</Text>
      <View style={styles.statsRow}>
        <Stat label="Played" value={profile.games_played} />
        <Stat label="Wins" value={profile.wins} />
        <Stat label="Losses" value={profile.losses} />
      </View>
      <View style={styles.statsRow}>
        <Stat label="Win rate" value={`${winRate}%`} />
        <Stat label="Streak" value={profile.current_streak} />
        <Stat label="Best streak" value={profile.best_streak} />
      </View>
      <Pressable style={styles.button} onPress={() => signOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  username: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 24 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.primary },
  statLabel: { color: colors.textMuted, marginTop: 4, fontSize: 12 },
  button: { marginTop: 24, backgroundColor: colors.wrong, borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: colors.onPrimary, fontWeight: '700' },
  error: { color: colors.wrong },
});
