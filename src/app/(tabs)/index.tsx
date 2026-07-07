import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { useProfile } from '@/lib/profile';

export default function GamesScreen() {
  const { profile, loading, error } = useProfile();
  const router = useRouter();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome, {profile?.username}</Text>
        <Text style={styles.subtitle}>No active games yet.</Text>
      </View>
      <Pressable style={styles.button} onPress={() => router.push('/new-game')}>
        <Text style={styles.buttonText}>New Game</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { marginTop: 8, color: colors.textMuted },
  button: { backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: 'center' },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  error: { color: colors.wrong },
});
