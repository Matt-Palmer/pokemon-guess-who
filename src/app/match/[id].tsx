import { useUser } from '@clerk/clerk-expo';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, typeColors } from '@/constants/colors';
import {
  answerQuestion,
  askQuestion,
  drawSecret,
  guess,
  PokemonCard,
  useBoardMarks,
  useBoardPokemon,
  useMatch,
  useMatchEvents,
  useMatchPlayers,
  useMatchResult,
  useMySecret,
} from '@/lib/matches';
import { useSupabase } from '@/lib/supabase';

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useUser();
  const supabase = useSupabase();
  const { match, loading, error } = useMatch(id);
  const cards = useBoardPokemon(match?.board);
  const { secret: mySecretId, refetch: refetchSecret } = useMySecret(id);
  const events = useMatchEvents(id, match?.last_activity_at);
  const { marks, toggle: toggleMark } = useBoardMarks(id);
  const players = useMatchPlayers(id);
  const result = useMatchResult(id, match?.status === 'completed');
  const [selected, setSelected] = useState<PokemonCard | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [guessMode, setGuessMode] = useState(false);
  const [guessTarget, setGuessTarget] = useState<PokemonCard | null>(null);
  const [guessing, setGuessing] = useState(false);
  const [guessFeedback, setGuessFeedback] = useState<string | null>(null);
  const threadRef = useRef<ScrollView>(null);

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

  const onSend = async () => {
    if (!id || sending) return;
    const text = input.trim();
    if (!text) return;
    setTurnError(null);
    setSending(true);
    try {
      if (iAsk) await askQuestion(supabase, id, text);
      else if (iAnswer) await answerQuestion(supabase, id, text);
      setInput('');
    } catch (err: any) {
      setTurnError(err?.message ?? 'Something went wrong.');
    } finally {
      setSending(false);
    }
  };

  const sendAnswer = async (text: string) => {
    if (!id || sending) return;
    setTurnError(null);
    setSending(true);
    try {
      await answerQuestion(supabase, id, text);
      setInput('');
    } catch (err: any) {
      setTurnError(err?.message ?? 'Something went wrong.');
    } finally {
      setSending(false);
    }
  };

  const onToggleCross = async (card: PokemonCard) => {
    setTurnError(null);
    try {
      await toggleMark(card.id);
    } catch (err: any) {
      setTurnError(err?.message ?? 'Could not update that card.');
    }
  };

  // In guess mode a tap picks the card to guess (confirmed separately) rather
  // than crossing it off, so a guess is never triggered by a stray tap.
  const onCardPress = (card: PokemonCard) => {
    if (guessMode) setGuessTarget(card);
    else onToggleCross(card);
  };

  const enterGuessMode = () => {
    setTurnError(null);
    setGuessFeedback(null);
    setGuessTarget(null);
    setGuessMode(true);
  };

  const cancelGuess = () => {
    setGuessMode(false);
    setGuessTarget(null);
  };

  const onConfirmGuess = async () => {
    if (!id || !guessTarget || guessing) return;
    setTurnError(null);
    setGuessFeedback(null);
    setGuessing(true);
    try {
      const res = await guess(supabase, id, guessTarget.id);
      // On a correct guess the match flips to `completed` via Realtime and the
      // end screen takes over. On a wrong guess the server auto-crosses the
      // missed card (arriving via the board_marks stream) and passes the turn.
      if (!res.correct) {
        setGuessFeedback(`Not ${guessTarget.name}. Your turn is over.`);
      }
      setGuessTarget(null);
      setGuessMode(false);
    } catch (err: any) {
      setTurnError(err?.message ?? 'Could not submit that guess.');
    } finally {
      setGuessing(false);
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

  // ── Active play: turn loop of questions & answers over a face-up board. ──
  const oppSlot = mySlot === 'player1' ? 'player2' : 'player1';
  const nameFor = (slot: 'player1' | 'player2', fallback: string) => {
    const cid = slot === 'player1' ? match.player1_id : match.player2_id;
    return (cid && players[cid]?.username) || fallback;
  };
  const oppName = nameFor(oppSlot, 'your opponent');

  // ── Game over: reveal both secrets to winner and loser alike. ──
  if (match.status === 'completed') {
    const didIWin = match.winner_id === user?.id;
    const oppSecretId = oppSlot === 'player1' ? result?.player1Secret : result?.player2Secret;
    const mySecretReveal = mySlot === 'player1' ? result?.player1Secret : result?.player2Secret;
    const oppSecretCard = cards.find((c) => c.id === oppSecretId) ?? null;
    const mySecretRevealCard = cards.find((c) => c.id === mySecretReveal) ?? null;

    const RevealCard = ({ label, card }: { label: string; card: PokemonCard | null }) => (
      <View style={styles.revealCol}>
        <Text style={styles.revealLabel}>{label}</Text>
        {card ? (
          <>
            <Image source={{ uri: card.sprite_url }} style={styles.revealSprite} contentFit="contain" />
            <Text style={styles.revealName}>{card.name}</Text>
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );

    return (
      <View style={styles.container}>
        <View style={styles.endPanel}>
          <Text style={[styles.endTitle, didIWin ? styles.endWin : styles.endLose]}>
            {didIWin ? 'You won! 🎉' : 'You lost'}
          </Text>
          <Text style={styles.endSubtitle}>
            {didIWin
              ? `You guessed ${oppName}'s secret.`
              : `${oppName} guessed your secret.`}
          </Text>
          <View style={styles.revealRow}>
            <RevealCard label={`${oppName}'s secret`} card={oppSecretCard} />
            <RevealCard label="Your secret" card={mySecretRevealCard} />
          </View>
        </View>
      </View>
    );
  }

  const isMyTurn = match.current_player === mySlot;
  const iAsk = match.phase === 'awaiting_question' && isMyTurn;
  // The answerer is the opponent of the asker (current_player).
  const iAnswer = match.phase === 'awaiting_answer' && match.current_player !== mySlot;

  const banner =
    match.phase === 'awaiting_question'
      ? isMyTurn
        ? 'Your turn — ask a question'
        : `${oppName}'s turn to ask…`
      : iAnswer
        ? 'Answer the question'
        : `Waiting for ${oppName} to answer…`;

  return (
    <View style={styles.container}>
      <View style={[styles.turnBanner, guessMode && styles.turnBannerGuess]}>
        <Text style={styles.turnText}>
          {guessMode ? 'Tap the card you think is their secret' : banner}
        </Text>
        <Text style={styles.turnHint}>
          {guessMode
            ? 'A wrong guess costs you your turn · long-press for details'
            : 'Tap a card to cross it off · long-press for details'}
        </Text>
      </View>

      <ScrollView style={styles.board} contentContainerStyle={styles.grid}>
        {cards.map((card) => {
          const crossed = marks.has(card.id);
          const isGuessTarget = guessTarget?.id === card.id;
          return (
            <Pressable
              key={card.id}
              style={[
                styles.card,
                card.id === mySecretId && styles.cardMine,
                isGuessTarget && styles.cardGuessTarget,
              ]}
              onPress={() => onCardPress(card)}
              onLongPress={() => setSelected(card)}>
              <Image
                source={{ uri: card.sprite_url }}
                style={[styles.sprite, crossed && styles.spriteCrossed]}
                contentFit="contain"
              />
              <Text
                style={[styles.name, crossed && styles.nameCrossed]}
                numberOfLines={1}>
                {card.name}
              </Text>
              {crossed && (
                <View style={styles.crossOverlay}>
                  <Text style={styles.crossMark}>✕</Text>
                </View>
              )}
            </Pressable>
          );
        })}
        {cards.length === 0 && <Text style={styles.loadingBoard}>Loading board…</Text>}
      </ScrollView>

      <View style={styles.threadPanel}>
        <ScrollView
          ref={threadRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          onContentSizeChange={() => threadRef.current?.scrollToEnd({ animated: true })}>
          {events.length === 0 && (
            <Text style={styles.threadEmpty}>No questions asked yet.</Text>
          )}
          {events.map((ev) => {
            const mine = ev.author_id === user?.id;
            const author = mine ? 'You' : nameFor(ev.author_slot, 'Opponent');
            return (
              <View key={ev.id} style={[styles.eventRow, mine && styles.eventRowMine]}>
                <Text style={styles.eventMeta}>
                  {author} · {ev.kind === 'question' ? 'asked' : 'answered'}
                </Text>
                <Text style={[styles.eventBody, ev.kind === 'answer' && styles.eventAnswer]}>
                  {ev.body}
                </Text>
              </View>
            );
          })}
        </ScrollView>

        {turnError && <Text style={styles.error}>{turnError}</Text>}
        {guessFeedback && <Text style={styles.guessFeedback}>{guessFeedback}</Text>}

        {guessMode ? (
          // Guess controls take over the input area while a guess is being made.
          <View style={styles.guessBar}>
            <Pressable style={styles.guessCancelBtn} disabled={guessing} onPress={cancelGuess}>
              <Text style={styles.guessCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.guessConfirmBtn,
                (guessing || !guessTarget) && styles.sendBtnDisabled,
              ]}
              disabled={guessing || !guessTarget}
              onPress={onConfirmGuess}>
              <Text style={styles.sendText}>
                {guessTarget ? `Guess ${guessTarget.name}` : 'Pick a card'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {iAnswer && (
              <View style={styles.quickRow}>
                <Pressable
                  style={[styles.quickBtn, sending && styles.sendBtnDisabled]}
                  disabled={sending}
                  onPress={() => sendAnswer('Yes')}>
                  <Text style={styles.quickText}>Yes</Text>
                </Pressable>
                <Pressable
                  style={[styles.quickBtn, sending && styles.sendBtnDisabled]}
                  disabled={sending}
                  onPress={() => sendAnswer('No')}>
                  <Text style={styles.quickText}>No</Text>
                </Pressable>
              </View>
            )}

            {iAsk || iAnswer ? (
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder={iAsk ? 'Ask a yes/no question…' : 'Type your answer…'}
                  placeholderTextColor={colors.textMuted}
                  editable={!sending}
                  onSubmitEditing={onSend}
                  returnKeyType="send"
                />
                <Pressable
                  style={[styles.sendBtn, (sending || !input.trim()) && styles.sendBtnDisabled]}
                  disabled={sending || !input.trim()}
                  onPress={onSend}>
                  <Text style={styles.sendText}>Send</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.waitingHint}>
                {match.phase === 'awaiting_answer'
                  ? `Waiting for ${oppName} to answer…`
                  : `Waiting for ${oppName}…`}
              </Text>
            )}

            {/* On your turn you may ask a question XOR make a guess. */}
            {iAsk && (
              <Pressable style={styles.guessStartBtn} onPress={enterGuessMode}>
                <Text style={styles.guessStartText}>Make a guess instead</Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      {selected && (
        <>
          <Pressable
            style={styles.detailBackdrop}
            onPress={() => setSelected(null)}
            accessibilityLabel="Close details"
          />
          <View style={styles.detailPanel}>
            <Pressable
              style={styles.detailClose}
              hitSlop={16}
              onPress={() => setSelected(null)}>
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
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  board: { flex: 1 },
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
  cardMine: { borderColor: colors.accent, borderWidth: 2.5 },
  cardGuessTarget: { borderColor: colors.correct, borderWidth: 3, backgroundColor: colors.correctBg },
  sprite: { width: '100%', height: '70%' },
  spriteCrossed: { opacity: 0.2 },
  name: { fontSize: 10, fontWeight: '600', color: colors.text, textTransform: 'capitalize' },
  nameCrossed: { color: colors.textMuted, textDecorationLine: 'line-through' },
  crossOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  crossMark: { fontSize: 34, fontWeight: '900', color: colors.wrong, opacity: 0.85 },
  loadingBoard: { color: colors.textMuted, textAlign: 'center', width: '100%', marginTop: 40 },

  // Turn banner
  turnBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  turnBannerGuess: { backgroundColor: colors.correctBg, borderBottomColor: colors.correct },
  turnText: { fontSize: 16, fontWeight: '800', color: colors.text },
  turnHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  // Guessing
  guessFeedback: {
    color: colors.wrong,
    backgroundColor: colors.wrongBg,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  guessStartBtn: {
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.correct,
    backgroundColor: colors.correctBg,
    alignItems: 'center',
  },
  guessStartText: { color: colors.correct, fontWeight: '800', fontSize: 15 },
  guessBar: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  guessCancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  guessCancelText: { color: colors.text, fontWeight: '700' },
  guessConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.correct,
    alignItems: 'center',
  },

  // End screen
  endPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  endTitle: { fontSize: 32, fontWeight: '900', marginBottom: 8 },
  endWin: { color: colors.correct },
  endLose: { color: colors.wrong },
  endSubtitle: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginBottom: 28 },
  revealRow: { flexDirection: 'row', gap: 20 },
  revealCol: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    minWidth: 130,
  },
  revealLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '700', marginBottom: 8 },
  revealSprite: { width: 88, height: 88 },
  revealName: { fontSize: 16, fontWeight: '700', color: colors.text, textTransform: 'capitalize', marginTop: 4 },

  // Q/A thread + input
  threadPanel: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  thread: { maxHeight: 150 },
  threadContent: { paddingBottom: 4 },
  threadEmpty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 12 },
  eventRow: { marginBottom: 8, alignItems: 'flex-start' },
  eventRowMine: { alignItems: 'flex-end' },
  eventMeta: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  eventBody: { fontSize: 15, color: colors.text, marginTop: 1 },
  eventAnswer: { fontWeight: '700' },
  quickRow: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 8 },
  quickBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.selectedBg,
    borderWidth: 1,
    borderColor: colors.selected,
    alignItems: 'center',
  },
  quickText: { fontWeight: '800', color: colors.text, fontSize: 15 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  sendBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: colors.onPrimary, fontWeight: '800' },
  waitingHint: { color: colors.textMuted, textAlign: 'center', marginTop: 6, fontStyle: 'italic' },

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

  detailBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 10,
  },
  detailPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 16,
    paddingTop: 28,
    gap: 16,
    zIndex: 11,
    elevation: 11,
  },
  detailClose: { position: 'absolute', top: 8, right: 12, padding: 6, zIndex: 12 },
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
