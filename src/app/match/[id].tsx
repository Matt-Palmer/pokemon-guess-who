import { useUser } from '@clerk/clerk-expo';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawCeremony } from '@/components/match/DrawCeremony';
import { GuessReveal } from '@/components/match/GuessReveal';
import { Tile } from '@/components/match/Tile';
import { typeColors } from '@/constants/colors';
import { claimState, formatRemaining } from '@/lib/game/claim';
import { guessedSecretId, shouldPlayGuessReveal } from '@/lib/game/reveal';
import { pairThread, splitByMarks } from '@/lib/game/review';
import { summarizeTurn } from '@/lib/game/summary';
import {
  answerQuestion,
  askQuestion,
  claimInactiveWin,
  drawSecret,
  guess,
  MatchStatus,
  PokemonCard,
  resign,
  useBoardMarks,
  useBoardPokemon,
  useMatch,
  useMatchEvents,
  useMatchPlayers,
  useMatchResult,
  useMySecret,
} from '@/lib/matches';
import { useSupabase } from '@/lib/supabase';
import { Badge, Button, CardModal, Screen, TextField, colors, radii, shadows, spacing, type } from '@/ui';

const BOARD_COLUMNS = 4;

/** Pokémon names arrive lowercase; tiles capitalize via CSS, prose can't. */
const displayName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The floating entry to the thread (see ADR 0001): pulses while the game
 * waits on the player (owe an answer / your move to ask), shows a dot for
 * unread opponent activity, stays quiet otherwise.
 */
function ChatBubble({
  pulse,
  dot,
  bottom,
  onPress,
}: {
  pulse: boolean;
  dot: boolean;
  bottom: number;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    t.value =
      pulse && !reduced
        ? withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0, { duration: 500 })), -1)
        : withTiming(0, { duration: 200 });
  }, [pulse, reduced, t]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + t.value * 0.1 }] }));

  return (
    <AnimatedPressable
      entering={ZoomIn.springify().damping(16).delay(400)}
      style={[styles.bubble, { bottom }, pulseStyle]}
      onPress={onPress}
      accessibilityLabel="Open the question thread">
      <Text style={styles.bubbleIcon}>💬</Text>
      {dot && <View style={styles.bubbleDot} />}
    </AnimatedPressable>
  );
}

/** Slim always-visible phase + whose-move indicator; resign/review live here. */
function TurnStrip({
  phaseLabel,
  myMove,
  text,
  hint,
  onReview,
  onResign,
  resignDisabled,
}: {
  phaseLabel: string;
  myMove: boolean;
  text: string;
  hint?: string;
  onReview?: () => void;
  onResign?: () => void;
  resignDisabled?: boolean;
}) {
  return (
    <View style={styles.strip}>
      {/* Keying on the label/copy remounts these on every phase or move
          change, so each strip state slides in — the turn-strip transition. */}
      <Animated.View key={`${phaseLabel}:${myMove}`} entering={FadeIn.duration(250)}>
        <Badge label={phaseLabel} variant={myMove ? 'accent' : 'neutral'} />
      </Animated.View>
      <Animated.View key={text} entering={FadeInDown.duration(250)} style={styles.stripBody}>
        <Text style={styles.stripText} numberOfLines={1}>
          {text}
        </Text>
        {hint ? (
          <Text style={styles.stripHint} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </Animated.View>
      {onReview && (
        <Pressable hitSlop={8} onPress={onReview}>
          <Text style={styles.stripReview}>Review</Text>
        </Pressable>
      )}
      {onResign && (
        <Pressable hitSlop={8} disabled={resignDisabled} onPress={onResign}>
          <Text style={styles.stripResign}>Resign</Text>
        </Pressable>
      )}
    </View>
  );
}

/** The board: 24 tiles in fixed rows that share the viewport — never scrolls. */
function BoardGrid({
  cards,
  renderTile,
}: {
  cards: PokemonCard[];
  /** `index` is the board position — it times the deal-in wave. */
  renderTile: (card: PokemonCard, index: number) => ReactNode;
}) {
  const rows = useMemo(() => {
    const out: PokemonCard[][] = [];
    for (let i = 0; i < cards.length; i += BOARD_COLUMNS) out.push(cards.slice(i, i + BOARD_COLUMNS));
    return out;
  }, [cards]);

  if (cards.length === 0) {
    return (
      <View style={styles.boardLoading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.board}>
      {rows.map((row, i) => (
        <View key={i} style={styles.boardRow}>
          {row.map((card, j) => renderTile(card, i * BOARD_COLUMNS + j))}
        </View>
      ))}
    </View>
  );
}

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useUser();
  const supabase = useSupabase();
  const insets = useSafeAreaInsets();
  const { match, loading, error, refetch } = useMatch(id);
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const threadRef = useRef<ScrollView>(null);
  // Motion state (issue 14) — presentation over already-written game state.
  const [reveal, setReveal] = useState<{ outcome: 'win' | 'loss'; card: PokemonCard | null } | null>(null);
  const [ceremony, setCeremony] = useState(false);
  const [shake, setShake] = useState<{ cardId: number; nonce: number } | null>(null);

  // The guess reveal plays on the observed edge into a guess-completed match —
  // that's how the opponent (watching via Realtime) gets the same turn-over
  // moment as the guesser. The guesser's own path sets `reveal` directly on a
  // correct guess (they shouldn't wait on the round-trip), so the edge keeps
  // whatever is already playing.
  const prevStatusRef = useRef<MatchStatus | undefined>(undefined);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = match?.status;
    if (user && match && shouldPlayGuessReveal(prev, match)) {
      const outcome = match.winner_id === user.id ? 'win' : 'loss';
      setReveal((current) => current ?? { outcome, card: null });
    }
  }, [match, user]);

  // Coarse clock for the claim countdown: the window is 7 days, so a slow tick
  // keeps the "claim in Xd Yh" copy honest without re-rendering every second.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (match?.status !== 'active') return;
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [match?.status]);

  // Review-panel data, derived from state the client already holds: own marks
  // (RLS-scoped to the caller) and the shared Q/A thread.
  const review = useMemo(() => splitByMarks(cards, marks), [cards, marks]);
  const qaHistory = useMemo(() => pairThread(events), [events]);

  const turn = match && user ? summarizeTurn(match, user.id) : null;
  const iAsk = turn?.kind === 'your_question';
  const iAnswer = turn?.kind === 'your_answer';

  // The chat modal auto-presents only when it becomes the player's move to
  // answer — on entering the screen or live when the question arrives. Your
  // turn to ask never auto-opens; the bubble pulses instead (ADR 0001).
  const wasAnswering = useRef(false);
  useEffect(() => {
    if (iAnswer && !wasAnswering.current) setChatOpen(true);
    wasAnswering.current = iAnswer;
  }, [iAnswer]);

  // Unread tracking for the bubble's dot: the first loaded batch is history,
  // not news — only events arriving after that (while the modal is closed)
  // count as unread.
  const [seenEvents, setSeenEvents] = useState(0);
  const eventsBaselined = useRef(false);
  useEffect(() => {
    if (chatOpen || !eventsBaselined.current) {
      setSeenEvents(events.length);
      if (chatOpen || events.length > 0) eventsBaselined.current = true;
    }
  }, [chatOpen, events.length]);
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const hasUnread = events.length > seenEvents && lastEvent?.author_id !== user?.id;

  const mySlot = match ? (match.player1_id === user?.id ? 'player1' : 'player2') : null;
  const bothDrawn = Boolean(match?.player1_drawn && match?.player2_drawn);
  const myDrawn = mySlot === 'player1' ? match?.player1_drawn : match?.player2_drawn;

  const mySecretCard = useMemo(
    () => cards.find((c) => c.id === mySecretId) ?? null,
    [cards, mySecretId],
  );

  if (loading) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }

  if (error || !match || !turn) {
    return (
      <Screen style={styles.center}>
        <Text style={styles.error}>{error ?? 'Game not found.'}</Text>
      </Screen>
    );
  }

  const oppSlot = mySlot === 'player1' ? 'player2' : 'player1';
  const nameFor = (slot: 'player1' | 'player2', fallback: string) => {
    const cid = slot === 'player1' ? match.player1_id : match.player2_id;
    return (cid && players[cid]?.username) || fallback;
  };
  const oppName = nameFor(oppSlot, 'your opponent');

  const onDraw = async (card: PokemonCard) => {
    if (!id || drawing) return;
    setDrawError(null);
    setDrawing(true);
    try {
      await drawSecret(supabase, id, card.id);
      await refetchSecret();
      setCeremony(true);
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

  // In guess mode a tap picks the tile to guess (confirmed separately) rather
  // than crossing it off, so a guess is never triggered by a stray tap.
  const onCardPress = (card: PokemonCard) => {
    if (guessMode) setGuessTarget(card);
    else onToggleCross(card);
  };

  const enterGuessMode = () => {
    setTurnError(null);
    setGuessFeedback(null);
    setGuessTarget(null);
    setChatOpen(false);
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
      // On a correct guess the reveal sequence starts right away — the guesser
      // knows the card they named, so the theater never waits on the network —
      // and the refetch flips the row to `completed` without relying on the
      // Realtime round-trip. On a wrong guess the missed tile gets a sympathy
      // shake; the server's auto-cross arrives via the board_marks stream and
      // flips it face-down.
      if (res.correct) {
        setReveal({ outcome: 'win', card: guessTarget });
        await refetch();
      } else {
        setGuessFeedback(`Not ${displayName(guessTarget.name)}. Your turn is over.`);
        setShake((prev) => ({ cardId: guessTarget.id, nonce: (prev?.nonce ?? 0) + 1 }));
      }
      setGuessTarget(null);
      setGuessMode(false);
    } catch (err: any) {
      setTurnError(err?.message ?? 'Could not submit that guess.');
    } finally {
      setGuessing(false);
    }
  };

  // ── Resign & inactivity claim: both end the game via server RPCs; the ──
  // ── screen refetches on success so it never waits on Realtime.        ──
  const doResign = async () => {
    if (!id || ending) return;
    setTurnError(null);
    setEnding(true);
    try {
      await resign(supabase, id);
      await refetch();
    } catch (err: any) {
      setTurnError(err?.message ?? 'Could not resign this game.');
    } finally {
      setEnding(false);
    }
  };

  const onResign = () => {
    Alert.alert('Resign this game?', `${oppName} wins and you take the loss.`, [
      { text: 'Keep playing', style: 'cancel' },
      { text: 'Resign', style: 'destructive', onPress: doResign },
    ]);
  };

  const doClaim = async () => {
    if (!id || ending) return;
    setTurnError(null);
    setEnding(true);
    try {
      await claimInactiveWin(supabase, id);
      await refetch();
    } catch (err: any) {
      setTurnError(err?.message ?? 'Could not claim this game.');
    } finally {
      setEnding(false);
    }
  };

  const onClaim = () => {
    Alert.alert('Claim the win?', `${oppName} hasn't moved in 7 days. Claiming ends the game as your win.`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Claim the win', onPress: doClaim },
    ]);
  };

  // Countdown/claim availability while waiting on the opponent. Derived from
  // last_activity_at (the server-only claim_notified flag never reaches
  // clients); the server re-checks eligibility when the claim is submitted.
  const claim = user
    ? claimState(match, user.id, nowMs)
    : ({ kind: 'not_applicable' } as const);
  const claimUi =
    claim.kind === 'claimable' ? (
      <View style={styles.claimWrap}>
        <Button
          title={`${oppName} hasn’t moved in 7 days — claim the win`}
          variant="accent"
          disabled={ending}
          onPress={onClaim}
        />
      </View>
    ) : claim.kind === 'countdown' ? (
      <Text style={styles.claimCountdown}>
        No move from {oppName}? You can claim the win in {formatRemaining(claim.remainingMs)}.
      </Text>
    ) : null;

  // Motion overlays shared across the phase branches: a second drawer's
  // ceremony outlives the draw → active switch, and the guesser's reveal
  // starts while the row is still `active` (before refetch/Realtime lands).
  // The card the reveal turns over is the guesser's own pick when we have it;
  // the watching player resolves it from the end-of-game result.
  const revealShownCard = reveal
    ? (reveal.card ?? cards.find((c) => c.id === guessedSecretId(match, result)) ?? null)
    : null;
  const revealUi = reveal ? (
    <GuessReveal
      outcome={reveal.outcome}
      card={revealShownCard}
      oppName={oppName}
      onDone={() => setReveal(null)}
    />
  ) : null;
  const ceremonyUi =
    ceremony && mySecretCard ? (
      <DrawCeremony card={mySecretCard} onDone={() => setCeremony(false)} />
    ) : null;

  // ── Blind-draw phase: tiles face-down until both players have drawn. ──
  if (!bothDrawn) {
    const stripText =
      turn.kind === 'your_draw'
        ? 'Your draw'
        : myDrawn
          ? `Waiting for ${oppName}…`
          : `Waiting for ${nameFor('player1', 'player 1')}…`;

    return (
      <Screen padded={false} style={{ paddingBottom: insets.bottom }}>
        <TurnStrip
          phaseLabel="Blind draw"
          myMove={turn.kind === 'your_draw'}
          text={stripText}
          hint={turn.kind === 'your_draw' ? 'Tap a face-down tile to draw' : 'Each player draws a secret'}
          onResign={onResign}
          resignDisabled={ending}
        />
        {drawError && <Text style={styles.error}>{drawError}</Text>}
        {turnError && <Text style={styles.error}>{turnError}</Text>}
        {claimUi}

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

        <BoardGrid
          cards={cards}
          renderTile={(card, index) => (
            <Tile
              key={card.id}
              card={card}
              faceDown
              dealIndex={index}
              backMark={card.id === mySecretId ? '★' : undefined}
              disabled={turn.kind !== 'your_draw' || drawing}
              onPress={() => onDraw(card)}
            />
          )}
        />

        {ceremonyUi}
      </Screen>
    );
  }

  // ── Game over: reveal both secrets to winner and loser alike. ──
  if (match.status === 'completed') {
    // The turn-over sequence plays before the verdict shows (PRD 44); a tap —
    // or reduced motion — skips straight to the end screen.
    if (reveal) {
      return <Screen padded={false}>{revealUi}</Screen>;
    }

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
        ) : result ? (
          // A resign during the blind draw can end a game before a secret exists.
          <Text style={styles.revealName}>Never drawn</Text>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );

    // How the game ended shapes the outcome copy — a forfeit or an inactivity
    // claim must not read as a guessed secret.
    const endSubtitle = didIWin
      ? match.ended_reason === 'resign'
        ? `${oppName} resigned.`
        : match.ended_reason === 'claim_inactive'
          ? `You claimed the win — ${oppName} didn't move for 7 days.`
          : `You guessed ${oppName}'s secret.`
      : match.ended_reason === 'resign'
        ? `You resigned — ${oppName} takes the win.`
        : match.ended_reason === 'claim_inactive'
          ? `${oppName} claimed the win after 7 days without a move.`
          : `${oppName} guessed your secret.`;

    return (
      <Screen style={styles.endPanel}>
        <Animated.Text
          entering={ZoomIn.springify().damping(14)}
          style={[styles.endTitle, didIWin ? styles.endWin : styles.endLose]}>
          {didIWin ? 'You won! 🎉' : 'You lost'}
        </Animated.Text>
        <Animated.Text entering={FadeIn.delay(200).duration(300)} style={styles.endSubtitle}>
          {endSubtitle}
        </Animated.Text>
        <Animated.View entering={FadeInDown.delay(350).duration(300)} style={styles.revealRow}>
          <RevealCard label={`${oppName}'s secret`} card={oppSecretCard} />
          <RevealCard label="Your secret" card={mySecretRevealCard} />
        </Animated.View>
      </Screen>
    );
  }

  // ── Active play: the board owns the viewport; the thread lives behind ──
  // ── the chat bubble → chat modal (ADR 0001). Guessing stays on-board. ──
  const stripText = guessMode
    ? 'Tap their secret tile'
    : turn.kind === 'your_question'
      ? 'Your move'
      : turn.kind === 'your_answer'
        ? 'Answer the question'
        : turn.kind === 'their_answer'
          ? `${oppName} is answering…`
          : `${oppName}'s move…`;

  // First-match orientation: until a question exists, say how the game works.
  const stripHint = guessMode
    ? 'A wrong guess costs your turn'
    : turn.kind === 'your_question'
      ? events.length === 0
        ? 'Ask with 💬 · cross off tiles'
        : 'Ask with 💬 or make a guess'
      : undefined;

  return (
    <Screen padded={false} style={{ paddingBottom: insets.bottom }}>
      <TurnStrip
        phaseLabel={guessMode ? 'Guess' : 'Questions'}
        myMove={Boolean(turn.myMove) || guessMode}
        text={stripText}
        hint={stripHint}
        onReview={() => setReviewOpen(true)}
        onResign={onResign}
        resignDisabled={ending}
      />

      {turnError && <Text style={styles.error}>{turnError}</Text>}
      {guessFeedback && (
        // After a wrong guess the review panel is one tap away, so the player
        // can regroup over their cross-offs and Q/A history.
        <View style={styles.guessFeedback}>
          <Text style={styles.guessFeedbackText}>{guessFeedback}</Text>
          <Pressable hitSlop={8} onPress={() => setReviewOpen(true)}>
            <Text style={styles.guessFeedbackLink}>Review your clues</Text>
          </Pressable>
        </View>
      )}
      {!guessMode && claimUi}

      <BoardGrid
        cards={cards}
        renderTile={(card, index) => (
          // Crossing off physically flips the tile face-down (issue 14); the
          // flip is presentation over the optimistic `useBoardMarks` state.
          <Tile
            key={card.id}
            card={card}
            faceDown={marks.has(card.id)}
            dealIndex={index}
            mine={card.id === mySecretId}
            targeted={guessTarget?.id === card.id}
            shakeNonce={shake?.cardId === card.id ? shake.nonce : 0}
            onPress={() => onCardPress(card)}
            onLongPress={() => setSelected(card)}
          />
        )}
      />

      {guessMode && (
        // Guess confirm bar: the one flow that stays on the board.
        <View style={styles.guessBar}>
          <Button
            title="Cancel"
            variant="secondary"
            disabled={guessing}
            onPress={cancelGuess}
            style={styles.guessCancel}
          />
          <Button
            title={guessTarget ? `Guess ${displayName(guessTarget.name)}` : 'Pick a tile'}
            disabled={!guessTarget}
            busy={guessing}
            onPress={onConfirmGuess}
            style={styles.guessConfirm}
          />
        </View>
      )}

      {!guessMode && (
        <ChatBubble
          pulse={iAsk || iAnswer}
          dot={iAsk || iAnswer || hasUnread}
          bottom={insets.bottom + spacing.lg}
          onPress={() => setChatOpen(true)}
        />
      )}

      {/* Chat modal: the thread + composition, over the dimmed board. The
          draft lives in screen state, so dismissing to peek at the board and
          reopening never loses a composed question or answer. */}
      <CardModal
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        title="Questions & answers">
        <ScrollView
          ref={threadRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          onContentSizeChange={() => threadRef.current?.scrollToEnd({ animated: true })}>
          {events.length === 0 && (
            <Text style={styles.threadEmpty}>
              No questions yet. Ask anything with a yes/no answer.
            </Text>
          )}
          {events.map((ev) => {
            const mine = ev.author_id === user?.id;
            const author = mine ? 'You' : nameFor(ev.author_slot, 'Opponent');
            return (
              <View key={ev.id} style={[styles.eventRow, mine && styles.eventRowMine]}>
                <Text style={styles.eventMeta}>
                  {author} · {ev.kind === 'question' ? 'asked' : 'answered'}
                </Text>
                <View style={[styles.eventBubble, mine && styles.eventBubbleMine]}>
                  <Text style={[styles.eventBody, ev.kind === 'answer' && styles.eventAnswer]}>
                    {ev.body}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {turnError && <Text style={styles.error}>{turnError}</Text>}

        {iAnswer && (
          <View style={styles.quickRow}>
            <Button
              title="Yes"
              variant="accent"
              disabled={sending}
              onPress={() => sendAnswer('Yes')}
              style={styles.quickBtn}
            />
            <Button
              title="No"
              variant="accent"
              disabled={sending}
              onPress={() => sendAnswer('No')}
              style={styles.quickBtn}
            />
          </View>
        )}

        {iAsk || iAnswer ? (
          <View style={styles.inputRow}>
            <TextField
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={iAsk ? 'Ask a yes/no question…' : 'Type your answer…'}
              editable={!sending}
              onSubmitEditing={onSend}
              returnKeyType="send"
            />
            <Button title="Send" busy={sending} disabled={!input.trim()} onPress={onSend} />
          </View>
        ) : (
          <Text style={styles.waitingHint}>
            {turn.kind === 'their_answer'
              ? `Waiting for ${oppName} to answer…`
              : `Waiting for ${oppName}…`}
          </Text>
        )}

        {/* On your turn you may ask a question XOR make a guess. */}
        {iAsk && (
          <Button
            title="Make a guess instead"
            variant="secondary"
            onPress={enterGuessMode}
            style={styles.guessStart}
          />
        )}
      </CardModal>

      {/* Review: own cross-offs + the paired Q/A history. */}
      <CardModal visible={reviewOpen} onClose={() => setReviewOpen(false)} title="Review">
        <Text style={styles.reviewSummary}>
          {review.crossedOff.length} crossed off · {review.remaining.length} remaining
        </Text>
        <ScrollView style={styles.reviewScroll} contentContainerStyle={styles.reviewContent}>
          <Text style={styles.reviewSection}>Your crossed-off tiles</Text>
          {review.crossedOff.length === 0 ? (
            <Text style={styles.reviewEmpty}>Nothing crossed off yet.</Text>
          ) : (
            <View style={styles.reviewGrid}>
              {review.crossedOff.map((card) => (
                <View key={card.id} style={styles.reviewCard}>
                  <Image
                    source={{ uri: card.sprite_url }}
                    style={styles.reviewSprite}
                    contentFit="contain"
                  />
                  <Text style={styles.reviewCardName} numberOfLines={1}>
                    {card.name}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.reviewSection}>Questions & answers</Text>
          {qaHistory.length === 0 ? (
            <Text style={styles.reviewEmpty}>No questions asked yet.</Text>
          ) : (
            qaHistory.map(({ question, answer }) => (
              <View key={question.id} style={styles.reviewQa}>
                <Text style={styles.reviewQaMeta}>
                  {question.author_id === user?.id
                    ? 'You asked'
                    : `${nameFor(question.author_slot, 'Opponent')} asked`}
                </Text>
                <Text style={styles.reviewQuestion}>{question.body}</Text>
                <Text style={styles.reviewAnswer}>
                  {answer ? answer.body : 'Awaiting answer…'}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </CardModal>

      {/* Tile details (long-press). */}
      <CardModal visible={selected !== null} onClose={() => setSelected(null)}>
        {selected && (
          <View style={styles.detailRow}>
            <Image
              source={{ uri: selected.sprite_url }}
              style={styles.detailSprite}
              contentFit="contain"
            />
            <View style={styles.detailInfo}>
              <Text style={styles.detailName}>{selected.name}</Text>
              <View style={styles.typeRow}>
                {selected.types.map((t) => (
                  <View
                    key={t}
                    style={[styles.typeChip, { backgroundColor: typeColors[t] ?? colors.inkMuted }]}>
                    <Text style={styles.typeChipText}>{t}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.detailGen}>Generation {selected.generation}</Text>
            </View>
          </View>
        )}
      </CardModal>

      {/* A second drawer's ceremony rides the draw → active switch; the
          guesser's reveal starts here, before the completed row lands. */}
      {ceremonyUi}
      {revealUi}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, marginTop: spacing.sm, textAlign: 'center' },

  // Turn strip
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.border,
  },
  stripBody: { flex: 1 },
  stripText: { ...type.label, fontSize: 14 },
  stripHint: { ...type.caption, fontSize: 11 },
  stripReview: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  stripResign: { color: colors.danger, fontWeight: '800', fontSize: 13 },

  // Board: fixed rows split the available height — 24 tiles, no scrolling.
  // (Tile faces, card backs, and the flip live in @/components/match/Tile.)
  board: { flex: 1, padding: spacing.sm, gap: spacing.sm },
  boardRow: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  boardLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Draw phase
  secretBanner: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
  },
  secretLabel: { color: colors.accentPressed, fontWeight: '700', fontSize: 12 },
  secretCardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  secretSprite: { width: 44, height: 44 },
  secretName: { ...type.heading, textTransform: 'capitalize' },

  // Chat bubble
  bubble: {
    position: 'absolute',
    right: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.primaryPressed,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.floating,
  },
  bubbleIcon: { fontSize: 26 },
  bubbleDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 15,
    height: 15,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
  },

  // Chat modal
  thread: { maxHeight: 280, flexGrow: 0 },
  threadContent: { paddingBottom: spacing.xs },
  threadEmpty: { ...type.caption, textAlign: 'center', paddingVertical: spacing.md },
  eventRow: { marginBottom: spacing.sm, alignItems: 'flex-start' },
  eventRowMine: { alignItems: 'flex-end' },
  eventMeta: { ...type.caption, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  eventBubble: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    maxWidth: '90%',
  },
  eventBubbleMine: { backgroundColor: colors.primarySoft },
  eventBody: { ...type.body },
  eventAnswer: { fontWeight: '700' },
  quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  quickBtn: { flex: 1 },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.sm },
  input: { flex: 1 },
  waitingHint: { ...type.caption, textAlign: 'center', marginTop: spacing.sm, fontStyle: 'italic' },
  guessStart: { marginTop: spacing.sm },

  // Guessing
  guessBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  guessCancel: { flex: 1 },
  guessConfirm: { flex: 2 },
  guessFeedback: {
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    marginHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  guessFeedbackText: { color: colors.danger, fontWeight: '700', textAlign: 'center' },
  guessFeedbackLink: {
    color: colors.danger,
    fontWeight: '800',
    textDecorationLine: 'underline',
    marginTop: spacing.xs,
  },

  // Claim
  claimWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  claimCountdown: { ...type.caption, textAlign: 'center', marginTop: spacing.xs + 2 },

  // Review modal
  reviewSummary: { ...type.caption, marginBottom: spacing.sm },
  reviewScroll: { maxHeight: 380, flexGrow: 0 },
  reviewContent: { paddingBottom: spacing.sm },
  reviewSection: {
    ...type.caption,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  reviewEmpty: { ...type.caption, fontStyle: 'italic', marginBottom: spacing.xs },
  reviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reviewCard: {
    width: '15%',
    minWidth: 52,
    alignItems: 'center',
    backgroundColor: colors.surfaceSunken,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    opacity: 0.75,
  },
  reviewSprite: { width: 40, height: 40 },
  reviewCardName: {
    fontSize: 9,
    color: colors.inkMuted,
    textTransform: 'capitalize',
    textDecorationLine: 'line-through',
  },
  reviewQa: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  reviewQaMeta: { ...type.caption, fontSize: 11, fontWeight: '600' },
  reviewQuestion: { ...type.body, marginTop: 2 },
  reviewAnswer: { ...type.body, fontWeight: '700', marginTop: spacing.xs },

  // Tile details
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  detailSprite: { width: 72, height: 72 },
  detailInfo: { flex: 1 },
  detailName: { ...type.title, textTransform: 'capitalize' },
  typeRow: { flexDirection: 'row', gap: spacing.xs + 2, marginTop: spacing.xs + 2 },
  typeChip: { borderRadius: radii.pill, paddingVertical: 3, paddingHorizontal: spacing.sm + 2 },
  typeChipText: { color: colors.onPrimary, fontWeight: '700', fontSize: 12, textTransform: 'capitalize' },
  detailGen: { ...type.caption, marginTop: spacing.xs + 2, fontWeight: '600' },

  // End screen
  endPanel: { alignItems: 'center', justifyContent: 'center' },
  endTitle: { fontSize: 32, fontWeight: '900', marginBottom: spacing.sm },
  endWin: { color: colors.success },
  endLose: { color: colors.danger },
  endSubtitle: { ...type.body, color: colors.inkMuted, textAlign: 'center', marginBottom: spacing.xl },
  revealRow: { flexDirection: 'row', gap: spacing.lg },
  revealCol: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
    minWidth: 130,
    ...shadows.card,
  },
  revealLabel: { ...type.caption, fontWeight: '700', marginBottom: spacing.sm },
  revealSprite: { width: 88, height: 88 },
  revealName: { ...type.heading, textTransform: 'capitalize', marginTop: spacing.xs },
});
