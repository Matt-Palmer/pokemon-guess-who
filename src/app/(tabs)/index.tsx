import { useUser } from '@clerk/clerk-expo';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { PartyModal } from '@/components/home/PartyModal';
import { summarizeTurn, TurnKind } from '@/lib/game/summary';
import { MyMatchRow, useMyMatches, useOnlinePlayers } from '@/lib/matches';
import { useProfile } from '@/lib/profile';
import { Badge, Button, Card, Screen, colors, radii, spacing, type } from '@/ui';

/** Whose-move copy for each turn state; `opponent` is the display name. */
function turnCopy(kind: TurnKind, opponent: string): string {
  switch (kind) {
    case 'waiting_for_opponent':
      return 'Waiting for a player to join';
    case 'ready_to_start':
      return 'Opponent joined — ready to start';
    case 'waiting_for_host':
      return `Waiting for ${opponent} to start`;
    case 'your_draw':
      return 'Draw your secret';
    case 'their_draw':
      return `Waiting for ${opponent} to draw`;
    case 'your_question':
      return 'Ask or guess';
    case 'their_question':
      return `${opponent}'s turn to ask`;
    case 'your_answer':
      return 'Answer their question';
    case 'their_answer':
      return `Waiting for ${opponent} to answer`;
    case 'finished':
      return 'Finished';
  }
}

/** A short phase chip label, derived from the match row (blind draw vs play). */
function phaseLabel(match: MyMatchRow): string {
  if (match.status === 'lobby') return 'Lobby';
  if (!match.player1_drawn || !match.player2_drawn) return 'Blind draw';
  return 'Playing';
}

/** A round game-piece avatar: opponent emoji/initial, or a waiting glyph for an open party. */
function Avatar({ emoji, name, waiting }: { emoji?: string | null; name?: string; waiting?: boolean }) {
  const label = waiting ? '⏳' : emoji || name?.charAt(0).toUpperCase() || '?';
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{label}</Text>
    </View>
  );
}

export default function GamesScreen() {
  const { user } = useUser();
  const { profile } = useProfile();
  const { matches, loading, error, refetch } = useMyMatches();
  const online = useOnlinePlayers(user?.id);
  const router = useRouter();
  const [partyOpen, setPartyOpen] = useState(false);

  // The tab stays mounted while playing; re-read the list whenever it regains
  // focus so finished/advanced games are reflected even if a Realtime refetch
  // was missed.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  // Games you owe a move sort to the top; within each group the RPC's
  // most-recently-active ordering is preserved (stable sort).
  const ordered = useMemo(() => {
    if (!user) return matches;
    return matches
      .map((m, i) => ({ m, i, myMove: summarizeTurn(m, user.id).myMove }))
      .sort((a, b) => (a.myMove === b.myMove ? a.i - b.i : a.myMove ? -1 : 1))
      .map((x) => x.m);
  }, [matches, user]);

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
    const openLobby = !item.player2_id;

    return (
      <Card
        onPress={() => openGame(item)}
        style={StyleSheet.flatten([styles.gameCard, myMove && styles.gameCardMyMove])}>
        <Avatar emoji={item.opponent_avatar} name={opponentName} waiting={openLobby} />
        <View style={styles.gameInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.opponentName} numberOfLines={1}>
              {openLobby ? `Party ${item.party_code}` : opponentName}
            </Text>
            {opponentOnline && <View style={styles.onlineDot} />}
            <View style={styles.flexSpacer} />
            {myMove && <Badge label="Your move" variant="primary" />}
          </View>
          <View style={styles.metaRow}>
            <Badge label={phaseLabel(item)} variant="neutral" />
            <Text style={[styles.turnLabel, myMove && styles.turnLabelMyMove]} numberOfLines={1}>
              {turnCopy(kind, opponentName)}
            </Text>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <Screen>
      <Text style={styles.title}>Hi, {profile?.username ?? 'Trainer'}</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(m) => m.id}
          renderItem={renderGame}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyGlyph}>◓</Text>
              <Text style={styles.emptyTitle}>No games yet</Text>
              <Text style={styles.emptyBody}>
                {error ?? 'Start a game with a friend, or get matched with a random opponent.'}
              </Text>
            </View>
          }
        />
      )}

      <View style={styles.actions}>
        <Button
          title="Play a friend"
          onPress={() => setPartyOpen(true)}
          style={styles.actionButton}
        />
        <Button
          title="Random opponent"
          variant="accent"
          onPress={() => router.push('/matchmaking')}
          style={styles.actionButton}
        />
      </View>

      <PartyModal
        visible={partyOpen}
        onClose={() => setPartyOpen(false)}
        onEnterLobby={(matchId) => {
          setPartyOpen(false);
          router.push(`/lobby/${matchId}`);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...type.display, marginBottom: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { flexGrow: 1, gap: spacing.md, paddingBottom: spacing.md },
  gameCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  gameCardMyMove: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '900', color: colors.accentPressed },
  gameInfo: { flex: 1, gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  opponentName: { ...type.heading, flexShrink: 1 },
  onlineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.success },
  flexSpacer: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  turnLabel: { ...type.caption, flexShrink: 1 },
  turnLabelMyMove: { color: colors.primary, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyGlyph: { fontSize: 56, color: colors.primary, marginBottom: spacing.xs },
  emptyTitle: { ...type.title },
  emptyBody: { ...type.body, color: colors.inkMuted, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.md },
  actionButton: { flex: 1 },
});
