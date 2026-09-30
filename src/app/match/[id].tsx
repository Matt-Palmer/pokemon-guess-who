import { useUser } from '@clerk/clerk-expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

import { CardDetail } from '@/components/match/CardDetail';
import { PokemonImage, prefetchSprites } from '@/components/match/PokemonImage';
import { GuessReveal } from '@/components/match/GuessReveal';
import { PickCeremony } from '@/components/match/PickCeremony';
import { Tile, TileView } from '@/components/match/Tile';
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
  revealMySecret,
  useBoardMarks,
  useBoardPokemon,
  useMatch,
  useMatchEvents,
  useMatchPlayers,
  useMatchResult,
  useMySecret,
} from '@/lib/matches';
import { useSupabase } from '@/lib/supabase';
import {
  Badge,
  Button,
  CardModal,
  ConfirmDialog,
  Screen,
  TextField,
  colors,
  radii,
  shadows,
  spacing,
  type,
  type Confirmation,
} from '@/ui';

const BOARD_COLUMNS = 4;

/** The deliberate beat on "waiting for game to start" before play opens. */
const PICK_HOLD_MS = 3000;

/** Floating chat-bubble diameter. The board reserves this much clear space at
 *  the bottom so the bubble never sits on top of the last tile (ADR 0001: all
 *  24 tiles must stay visible). */
const BUBBLE_SIZE = 60;

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

/**
 * Slim always-visible phase + whose-move indicator; resign/review live here.
 *
 * It also carries your own secret during play (issue 4). Your secret sits on the
 * shared board like any other card, so crossing it off — which you will, while
 * eliminating candidates — used to flip it face-down and take its name, types
 * and region with it, exactly when an opponent's question needs them. The chip
 * is the one copy of your secret that can't be crossed off, and it opens the
 * full detail card on tap.
 */
function TurnStrip({
  phaseLabel,
  myMove,
  text,
  hint,
  secret,
  onSecretPress,
  onReview,
  onResign,
  resignDisabled,
}: {
  phaseLabel: string;
  myMove: boolean;
  text: string;
  hint?: string;
  secret?: PokemonCard | null;
  onSecretPress?: () => void;
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
      {secret && (
        <Pressable
          hitSlop={8}
          onPress={onSecretPress}
          style={styles.stripSecret}
          accessibilityRole="button"
          accessibilityLabel={`Your secret is ${secret.name}. Tap for its details.`}>
          <PokemonImage uri={secret.sprite_url} style={styles.stripSecretSprite} fallback={false} />
          <Text style={styles.stripSecretName} numberOfLines={1}>
            {secret.name}
          </Text>
        </Pressable>
      )}
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

/** Segmented control for the board-wide facet view: Pokémon · Type · Region. */
function ViewToggle({ value, onChange }: { value: TileView; onChange: (v: TileView) => void }) {
  const options: { key: TileView; label: string }[] = [
    { key: 'pokemon', label: 'Pokémon' },
    { key: 'type', label: 'Type' },
    { key: 'region', label: 'Region' },
  ];
  return (
    <View style={styles.viewToggle}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            style={[styles.viewOption, active && styles.viewOptionActive]}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}>
            <Text style={[styles.viewOptionText, active && styles.viewOptionTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useUser();
  const supabase = useSupabase();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { match, loading, error, refetch } = useMatch(id);
  const cards = useBoardPokemon(match?.board);
  const { secret: mySecretId, refetch: refetchSecret } = useMySecret(id);
  const events = useMatchEvents(id, match?.last_activity_at);
  const { marks, toggle: toggleMark } = useBoardMarks(id);
  const bothDrawn = Boolean(match?.player1_drawn && match?.player2_drawn);
  const players = useMatchPlayers(id);
  const result = useMatchResult(id, match?.status === 'completed');
  const [view, setView] = useState<TileView>('pokemon');
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  /** The tile highlighted during the secret pick. Nothing is written until it
   *  is confirmed, so browsing and changing your mind are free. */
  const [selected, setSelected] = useState<PokemonCard | null>(null);
  /** The card whose full details are open, from the pick bar or the secret chip. */
  const [detailCard, setDetailCard] = useState<PokemonCard | null>(null);
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
  /** The pending confirmation, if any. Replaces `Alert.alert`, which React
   *  Native Web silently no-ops — every confirm-gated action was dead in a
   *  browser because the dialog never opened. */
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const threadRef = useRef<ScrollView>(null);
  // Motion state (issue 14) — presentation over already-written game state.
  const [reveal, setReveal] = useState<{ outcome: 'win' | 'loss'; card: PokemonCard | null } | null>(null);
  const [shake, setShake] = useState<{ cardId: number; nonce: number } | null>(null);
  /** Holds the pick ceremony on "waiting for game to start" for a deliberate
   *  beat once both secrets are in, so play never opens as a jump-cut. */
  const [startHold, setStartHold] = useState(false);

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

  // Both secrets just landed: hold the ceremony on "waiting for game to start"
  // for a beat before play opens. Only a transition counts — returning to a
  // match that is already under way must go straight to the board, which is why
  // the first observed value seeds the ref instead of triggering the hold.
  const bothDrawnRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = bothDrawnRef.current;
    bothDrawnRef.current = bothDrawn;
    if (prev !== false || !bothDrawn) return;
    setStartHold(true);
    const t = setTimeout(() => setStartHold(false), PICK_HOLD_MS);
    return () => clearTimeout(t);
  }, [bothDrawn]);

  // Warm the whole board's sprites as soon as the cards arrive, so 24 tiles
  // don't each race the network as they deal in.
  useEffect(() => {
    prefetchSprites(cards.map((c) => c.sprite_url));
  }, [cards]);

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

  /** Commit the highlighted tile as your secret. The only write in the pick
   *  phase, and it is final — hence the explicit confirm behind it. */
  const onConfirmPick = async () => {
    if (!id || !selected || drawing) return;
    setDrawError(null);
    setDrawing(true);
    try {
      await drawSecret(supabase, id, selected.id);
      await refetchSecret();
      await refetch();
    } catch (err: any) {
      setDrawError(err?.message ?? 'Could not lock in that card.');
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
    setConfirmation(null);
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
    setConfirmation({
      title: 'Resign this game?',
      message: `${oppName} wins and you take the loss.`,
      confirmLabel: 'Resign',
      cancelLabel: 'Keep playing',
      danger: true,
      onConfirm: doResign,
    });
  };

  const doReveal = async () => {
    if (!id || ending) return;
    setConfirmation(null);
    setTurnError(null);
    setEnding(true);
    try {
      await revealMySecret(supabase, id);
      await refetch();
    } catch (err: any) {
      setTurnError(err?.message ?? 'Could not reveal your secret.');
    } finally {
      setEnding(false);
    }
  };

  const onReveal = () => {
    setConfirmation({
      title: 'Reveal your secret?',
      message: `${oppName} will see your card and the game ends. Do this once they have guessed it.`,
      confirmLabel: 'Reveal',
      cancelLabel: 'Not yet',
      onConfirm: doReveal,
    });
  };

  const doClaim = async () => {
    if (!id || ending) return;
    setConfirmation(null);
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
    setConfirmation({
      title: 'Claim the win?',
      message: `${oppName} hasn't moved in 7 days. Claiming ends the game as your win.`,
      confirmLabel: 'Claim the win',
      cancelLabel: 'Not yet',
      onConfirm: doClaim,
    });
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
  const confirmUi = (
    <ConfirmDialog confirmation={confirmation} busy={ending} onCancel={() => setConfirmation(null)} />
  );

  /* Review: own cross-offs + the paired Q/A history. Reachable during play
     from the turn strip, and again from the outcome screen — the end of a
     match is the natural moment to look back at how it went. */
  const reviewUi = (
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
                  <PokemonImage uri={card.sprite_url} style={styles.reviewSprite} />
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
  );

  // ── Secret pick: the board is face-up and both players choose at once. ──
  if (!bothDrawn || startHold) {
    // Locked in. The board falls away and your card takes the screen; this is
    // also the waiting state, so there is no separate spinner screen.
    if (myDrawn) {
      return (
        <Screen padded={false} style={{ paddingBottom: insets.bottom }}>
          {mySecretCard ? (
            <PickCeremony
              card={mySecretCard}
              wait={bothDrawn ? 'start' : 'opponent'}
              oppName={oppName}
            />
          ) : (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
        </Screen>
      );
    }

    return (
      <Screen padded={false} style={{ paddingBottom: insets.bottom }}>
        {/* Deliberately NOT the match screen's furniture. The pick used to
            reuse the turn strip and the view toggle, so it was visually
            identical to the board mid-game — players arrived here and assumed
            the game had started without them, or had broken. A setup screen
            should announce itself. */}
        <View style={styles.pickHeader}>
          <Text style={styles.pickTitle}>Choose your secret</Text>
          <Text style={styles.pickSubtitle}>
            Pick the Pokémon {oppName} will try to guess. They&apos;re choosing at the same
            time — you won&apos;t see each other&apos;s.
          </Text>
          {onResign && (
            <Pressable hitSlop={8} disabled={ending} onPress={onResign} style={styles.pickQuit}>
              <Text style={styles.pickQuitText}>Quit game</Text>
            </Pressable>
          )}
        </View>

        {drawError && <Text style={styles.error}>{drawError}</Text>}
        {turnError && <Text style={styles.error}>{turnError}</Text>}
        {claimUi}

        <BoardGrid
          cards={cards}
          renderTile={(card, index) => (
            <Tile
              key={card.id}
              card={card}
              faceDown={false}
              dealIndex={index}
              targeted={selected?.id === card.id}
              disabled={drawing}
              onPress={() => setSelected(card)}
            />
          )}
        />

        {/* Nothing reaches the server until you lock in, so browsing and
            changing your mind are free — and the commit, which is final, is a
            deliberate act rather than a stray tap on a small tile. */}
        <View style={styles.pickBar}>
          <Button
            title="Details"
            variant="secondary"
            disabled={!selected}
            onPress={() => setDetailCard(selected)}
            style={styles.pickDetails}
          />
          <Button
            title={selected ? `Lock in ${displayName(selected.name)}` : 'Pick a tile'}
            disabled={!selected}
            busy={drawing}
            onPress={onConfirmPick}
            style={styles.pickConfirm}
          />
        </View>

        <CardModal visible={Boolean(detailCard)} onClose={() => setDetailCard(null)}>
          {detailCard && <CardDetail card={detailCard} />}
        </CardModal>
        {confirmUi}
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

    // A local match ends with no winner: the app never saw a guess, so it has
    // nothing to record and neither player is told they lost.
    const noWinner = !match.winner_id;
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
            <PokemonImage uri={card.sprite_url} style={styles.revealSprite} />
            <Text style={styles.revealName}>{card.name}</Text>
          </>
        ) : result ? (
          // A resign during the secret pick can end a game before a secret exists.
          <Text style={styles.revealName}>Never drawn</Text>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );

    // How the game ended shapes the outcome copy — a forfeit or an inactivity
    // claim must not read as a guessed secret.
    const endSubtitle = noWinner
      ? match.ended_reason === 'revealed'
        ? 'Secrets revealed.'
        : 'This game ended without a winner.'
      : didIWin
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
          style={[styles.endTitle, noWinner ? undefined : didIWin ? styles.endWin : styles.endLose]}>
          {noWinner ? 'Game over' : didIWin ? 'You won! 🎉' : 'You lost'}
        </Animated.Text>
        <Animated.Text entering={FadeIn.delay(200).duration(300)} style={styles.endSubtitle}>
          {endSubtitle}
        </Animated.Text>
        <Animated.View entering={FadeInDown.delay(350).duration(300)} style={styles.revealRow}>
          <RevealCard label={`${oppName}'s secret`} card={oppSecretCard} />
          <RevealCard label="Your secret" card={mySecretRevealCard} />
        </Animated.View>

        {/* A screen that ends a game needs a deliberate way off it. The header
            back button covers the reflex; this covers everyone else. */}
        <Animated.View entering={FadeInDown.delay(500).duration(300)} style={styles.endActions}>
          {/* Nothing to review in a local game — the questions were spoken,
              never written, so the panel would open on an empty thread. */}
          {match.mode !== 'local' && (
            <Button
              title="Review the questions"
              variant="secondary"
              onPress={() => setReviewOpen(true)}
            />
          )}
          <Button title="Back to Games" onPress={() => router.replace('/(tabs)')} />
        </Animated.View>

        {match.mode !== 'local' && reviewUi}
      </Screen>
    );
  }

  // ── Local play: a digital version of the physical board. No turns, no ──
  // ── thread, no in-app guessing — the game is happening in the room and ──
  // ── the app only holds each player's board. It ends when someone turns ──
  // ── their own card over to confirm a spoken guess.                     ──
  if (match.mode === 'local') {
    return (
      <Screen padded={false} style={{ paddingBottom: insets.bottom }}>
        <TurnStrip
          phaseLabel="Same room"
          myMove={false}
          text="Your board"
          hint="Ask out loud · cross off tiles"
          secret={mySecretCard}
          onSecretPress={() => setDetailCard(mySecretCard)}
        />

        {turnError && <Text style={styles.error}>{turnError}</Text>}

        <ViewToggle value={view} onChange={setView} />

        <BoardGrid
          cards={cards}
          renderTile={(card, index) => (
            <Tile
              key={card.id}
              card={card}
              faceDown={marks.has(card.id)}
              dealIndex={index}
              mine={card.id === mySecretId}
              view={view}
              onPress={() => onToggleCross(card)}
            />
          )}
        />

        {/* The only way a same-room game ends. You reveal your *own* card —
            never your opponent's — so there is no way to peek. */}
        <View style={styles.revealBar}>
          <Button
            title="Reveal my secret"
            variant="secondary"
            busy={ending}
            onPress={onReveal}
          />
        </View>

        <CardModal visible={Boolean(detailCard)} onClose={() => setDetailCard(null)}>
          {detailCard && <CardDetail card={detailCard} />}
        </CardModal>
        {confirmUi}
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
        secret={mySecretCard}
        onSecretPress={() => setDetailCard(mySecretCard)}
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

      <ViewToggle value={view} onChange={setView} />

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
            view={view}
            onPress={() => onCardPress(card)}
          />
        )}
      />

      {/* Reserve a clear band below the grid so the floating chat bubble never
          covers the last tile — the board still shows all 24 and never scrolls
          (ADR 0001). Guess mode swaps in its own bottom bar instead. */}
      {!guessMode && <View style={{ height: insets.bottom + spacing.lg + BUBBLE_SIZE }} />}

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

      {/* Card details, opened from the secret chip on the strip. */}
      <CardModal visible={Boolean(detailCard)} onClose={() => setDetailCard(null)}>
        {detailCard && <CardDetail card={detailCard} />}
      </CardModal>

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


      {reviewUi}
      {confirmUi}

      {/* The guesser's reveal starts here, before the completed row lands.
          (The second picker's ceremony no longer needs to ride this switch —
          `startHold` keeps them in the pick branch until play opens.) */}
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
  stripSecret: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 110,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  stripSecretSprite: { width: 24, height: 24 },
  stripSecretName: {
    color: colors.accentPressed,
    fontWeight: '800',
    fontSize: 11,
    textTransform: 'capitalize',
    flexShrink: 1,
  },
  stripReview: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  stripResign: { color: colors.danger, fontWeight: '800', fontSize: 13 },

  // Board: fixed rows split the available height — 24 tiles, no scrolling.
  // (Tile faces, card backs, and the flip live in @/components/match/Tile.)
  board: { flex: 1, padding: spacing.sm, gap: spacing.sm },
  boardRow: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  boardLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Draw phase
  revealBar: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },

  // Secret pick — its own look, so it never reads as the game board.
  pickHeader: {
    backgroundColor: colors.accentSoft,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  pickTitle: { ...type.title, color: colors.accentPressed },
  pickSubtitle: { ...type.caption, lineHeight: 17 },
  pickQuit: { alignSelf: 'flex-start', marginTop: spacing.xs },
  pickQuitText: { color: colors.danger, fontWeight: '800', fontSize: 12 },
  pickBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  pickDetails: { flex: 1 },
  pickConfirm: { flex: 2 },

  // Chat bubble
  bubble: {
    position: 'absolute',
    right: spacing.lg,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
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

  // View toggle (segmented control)
  viewToggle: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceSunken,
    borderRadius: radii.pill,
    padding: 3,
    gap: 3,
  },
  viewOption: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs + 2, borderRadius: radii.pill },
  viewOptionActive: { backgroundColor: colors.primary, ...shadows.card },
  viewOptionText: { fontSize: 12, fontWeight: '800', color: colors.inkMuted },
  viewOptionTextActive: { color: colors.onPrimary },

  // End screen
  endPanel: { alignItems: 'center', justifyContent: 'center' },
  endTitle: { fontSize: 32, fontWeight: '900', marginBottom: spacing.sm },
  endWin: { color: colors.success },
  endLose: { color: colors.danger },
  endActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.xl },
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
