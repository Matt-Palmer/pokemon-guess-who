import { useUser } from '@clerk/clerk-expo';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, typeColors } from '@/constants/colors';
import { drawSecret, PokemonCard, useBoardPokemon, useMatch, useMySecret } from '@/lib/matches';
import { useSupabase } from '@/lib/supabase';

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useUser();
  const supabase = useSupabase();
  const { match, loading, error } = useMatch(id);
  const cards = useBoardPokemon(match?.board);
  const { secret: mySecretId, refetch: refetchSecret } = useMySecret(id);
  const [selected, setSelected] = useState<PokemonCard | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);

  const mySlot = match ? (match.player1_id === user?.id ? 'player1' : 'player2') : null;
  const bothDrawn = Boolean(match?.player1_drawn && match?.player2_drawn);
  const myDrawn = mySlot === 'player1' ? match?.player1_drawn : match?.player2_drawn;
  // Player 1 draws first, then player 2.
  const drawTurn = match ? (!match.player1_drawn ? 'player1' : 'player2') : null;
  const isMyTurnToDraw = !bothDrawn && !myDrawn && drawTurn === mySlot;

  const mySecretCard = useMemo(
    () => cards.find((c) => c.id === mySecretId) ?? null,
    [cards, mySecretId],
  );

  const onDraw = async (card: PokemonCard) => {
    if (!id || drawing) return;
    setDrawError(null);
    setDrawing(true);
    try {
      await drawSecret(supabase, id, card.id);
      await refetchSecret();
    } catch (err: any) {
      setDrawError(err?.message ?? 'Could not draw that card.');
    } finally {
      setDrawing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !match) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Game not found.'}</Text>
      </View>
    );
  }

  // ── Blind-draw phase: cards face-down until both players have drawn. ──
  if (!bothDrawn) {
    const banner = isMyTurnToDraw
      ? 'Tap a face-down card to draw your secret'
      : myDrawn
        ? 'Waiting for your opponent to draw…'
        : drawTurn === 'player1'
          ? 'Waiting for player 1 to draw…'
          : 'Waiting for your opponent to draw…';

    return (
      <View style={styles.container}>
        <View style={styles.drawHeader}>
          <Text style={styles.drawTitle}>Blind draw</Text>
          <Text style={styles.drawBanner}>{banner}</Text>
          {drawError && <Text style={styles.error}>{drawError}</Text>}
        </View>

        {myDrawn && (
          <View style={styles.secretBanner}>
            <Text style={styles.secretLabel}>Your secret</Text>
            {mySecretCard ? (
              <View style={styles.secretCardRow}>
                <Image
                  source={{ uri: mySecretCard.sprite_url }}
                  style={styles.secretSprite}
                  contentFit="contain"
                />
                <Text style={styles.secretName}>{mySecretCard.name}</Text>
              </View>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>
        )}

        <ScrollView contentContainerStyle={styles.grid}>
          {cards.map((card) => {
            const isMine = card.id === mySecretId;
            return (
              <Pressable
                key={card.id}
                style={[styles.card, styles.cardBack, isMine && styles.cardMineBack]}
                disabled={!isMyTurnToDraw || drawing}
                onPress={() => onDraw(card)}>
                <Text style={styles.cardBackMark}>{isMine ? '★' : '?'}</Text>
              </Pressable>
            );
          })}
          {cards.length === 0 && <Text style={styles.loadingBoard}>Loading board…</Text>}
        </ScrollView>
      </View>
    );
  }

  // ── Active play: all 24 cards face-up. ──
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.grid}>
        {cards.map((card) => (
          <Pressable
            key={card.id}
            style={[
              styles.card,
              selected?.id === card.id && styles.cardSelected,
              card.id === mySecretId && styles.cardMine,
            ]}
            onPress={() => setSelected(card)}>
            <Image source={{ uri: card.sprite_url }} style={styles.sprite} contentFit="contain" />
            <Text style={styles.name} numberOfLines={1}>
              {card.name}
            </Text>
          </Pressable>
        ))}
        {cards.length === 0 && <Text style={styles.loadingBoard}>Loading board…</Text>}
      </ScrollView>

      {selected && (
        <View style={styles.detailPanel}>
          <Pressable style={styles.detailClose} onPress={() => setSelected(null)}>
            <Text style={styles.detailCloseText}>✕</Text>
          </Pressable>
          <Image source={{ uri: selected.sprite_url }} style={styles.detailSprite} contentFit="contain" />
          <View style={styles.detailInfo}>
            <Text style={styles.detailName}>{selected.name}</Text>
            <View style={styles.typeRow}>
              {selected.types.map((type) => (
                <View
                  key={type}
                  style={[styles.typeChip, { backgroundColor: typeColors[type] ?? colors.textMuted }]}>
                  <Text style={styles.typeChipText}>{type}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.detailGen}>Generation {selected.generation}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    padding: 8,
  },
  card: {
    width: '23%',
    aspectRatio: 0.8,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  cardSelected: { borderColor: colors.selected, backgroundColor: colors.selectedBg },
  cardMine: { borderColor: colors.accent, borderWidth: 2.5 },
  sprite: { width: '100%', height: '70%' },
  name: { fontSize: 10, fontWeight: '600', color: colors.text, textTransform: 'capitalize' },
  loadingBoard: { color: colors.textMuted, textAlign: 'center', width: '100%', marginTop: 40 },

  // Draw phase
  drawHeader: { padding: 16, alignItems: 'center' },
  drawTitle: { fontSize: 22, fontWeight: '800', color: colors.text },
  drawBanner: { color: colors.textMuted, marginTop: 4, textAlign: 'center' },
  cardBack: { backgroundColor: colors.primary, borderColor: colors.primaryDark },
  cardMineBack: { backgroundColor: colors.accent, borderColor: colors.accentDark },
  cardBackMark: { fontSize: 24, fontWeight: '800', color: colors.onPrimary },
  secretBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: colors.accentBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
  },
  secretLabel: { color: colors.accentDark, fontWeight: '700', marginBottom: 4 },
  secretCardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  secretSprite: { width: 56, height: 56 },
  secretName: { fontSize: 18, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },

  detailPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 16,
    gap: 16,
  },
  detailClose: { position: 'absolute', top: 8, right: 12, padding: 4 },
  detailCloseText: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
  detailSprite: { width: 72, height: 72 },
  detailInfo: { flex: 1 },
  detailName: { fontSize: 20, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
  typeRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  typeChip: { borderRadius: 12, paddingVertical: 3, paddingHorizontal: 10 },
  typeChipText: { color: colors.onPrimary, fontWeight: '700', fontSize: 12, textTransform: 'capitalize' },
  detailGen: { color: colors.textMuted, marginTop: 6, fontWeight: '600' },
  error: { color: colors.wrong, marginTop: 8, textAlign: 'center' },
});
