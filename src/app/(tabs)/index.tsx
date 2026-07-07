import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { useProfile } from '@/lib/profile';

export default function GamesScreen() {
  const { profile, loading, error } = useProfile();

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
    <View style={styles.center}>
      <Text style={styles.title}>Welcome, {profile?.username}</Text>
      <Text style={styles.subtitle}>No active games yet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { marginTop: 8, color: colors.textMuted },
  error: { color: colors.wrong },
});
