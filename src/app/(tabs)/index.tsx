import { useUser } from '@clerk/clerk-expo';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { summarizeTurn, TurnKind } from '@/lib/game/summary';
import { MyMatchRow, useMyMatches, useOnlinePlayers } from '@/lib/matches';
import { useProfile } from '@/lib/profile';

/** Copy for each turn state; `opponent` is the display name (never null once needed). */
function turnCopy(kind: TurnKind, opponent: string): string {
  switch (kind) {
    case 'waiting_for_opponent':
      return 'Waiting for a player to join';
    case 'ready_to_start':
      return 'Opponent joined — ready to start';
    case 'waiting_for_host':
      return `Waiting for ${opponent} to start`;
    case 'your_draw':
      return 'Your move — draw your secret';
    case 'their_draw':
      return `Waiting for ${opponent} to draw`;
    case 'your_question':
      return 'Your move — ask or guess';
    case 'their_question':
      return `${opponent}'s turn to ask`;
    case 'your_answer':
      return `Your move — answer ${opponent}'s question`;
    case 'their_answer':
      return `Waiting for ${opponent} to answer`;
    case 'finished':
      return 'Finished';
  }
}

export default function GamesScreen() {
  const { user } = useUser();
  const { profile } = useProfile();
  const { matches, loading, error, refetch } = useMyMatches();
  const online = useOnlinePlayers(user?.id);
  const router = useRouter();

  // The tab stays mounted while playing; re-read the list whenever it regains
  // focus so finished/advanced games are reflected even if a Realtime refetch
  // was missed.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const openGame = (game: MyMatchRow) => {
    // Resuming is just navigation: every match screen rehydrates its state
    // authoritatively from Postgres on mount.
    router.push(game.status === 'lobby' ? `/lobby/${game.id}` : `/match/${game.id}`);
  };

  const renderGame = ({ item }: { item: MyMatchRow }) => {
    if (!user) return null;
    const { myMove, kind } = summarizeTurn(item, user.id);
    const opponentId = item.player1_id === user.id ? item.player2_id : item.player1_id;
    const opponentName = item.opponent_username ?? 'Opponent';
    const opponentOnline = Boolean(opponentId && online.has(opponentId));

    return (
      <Pressable style={[styles.gameRow, myMove && styles.gameRowMyMove]} onPress={() => openGame(item)}>
        <View style={styles.gameInfo}>
          <View style={styles.opponentRow}>
            <Text style={styles.opponentName}>
              {item.player2_id ? `vs ${opponentName}` : `Party ${item.party_code}`}
            </Text>
            {opponentOnline && (
              <View style={styles.onlineChip}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>online</Text>
              </View>
            )}
          </View>
          <Text style={[styles.turnLabel, myMove && styles.turnLabelMyMove]}>
            {turnCopy(kind, opponentName)}
          </Text>
        </View>
        {myMove && (
          <View style={styles.myMoveBadge}>
            <Text style={styles.myMoveBadgeText}>Your move</Text>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome, {profile?.username}</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(m) => m.id}
          renderItem={renderGame}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {error ?? 'No active games yet — start one below.'}
            </Text>
          }
        />
      )}

      <Pressable style={styles.button} onPress={() => router.push('/new-game')}>
        <Text style={styles.buttonText}>New Game</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 16 },
  list: { flexGrow: 1 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 48 },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 10,
  },
  gameRowMyMove: { borderColor: colors.primary, backgroundColor: colors.primaryBg },
  gameInfo: { flex: 1 },
  opponentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  opponentName: { fontSize: 16, fontWeight: '700', color: colors.text },
  onlineChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.correct },
  onlineText: { fontSize: 11, color: colors.correct, fontWeight: '600' },
  turnLabel: { marginTop: 3, fontSize: 13, color: colors.textMuted },
  turnLabelMyMove: { color: colors.primaryDark, fontWeight: '600' },
  myMoveBadge: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 12,
  },
  myMoveBadgeText: { color: colors.onPrimary, fontWeight: '800', fontSize: 12 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});
