import { Image, ImageContentFit } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ImageStyle, StyleProp, StyleSheet, View } from 'react-native';

import { CardBack } from '@/ui';

/** Attempts after the first before a sprite is declared missing. */
const MAX_RETRIES = 2;
/** Backoff before each retry — long enough to ride out a rate-limit blip. */
const RETRY_DELAY_MS = 1200;

/**
 * A Pokémon sprite that survives a flaky network.
 *
 * Sprites are fetched from a third-party CDN, and a plain `<Image>` failing was
 * silent: no retry, no placeholder, no log — just a blank card and no way to
 * tell whether the URL, the host, or the connection was at fault. This retries
 * with a short backoff, falls back to the card back so a miss still reads as a
 * card rather than a rendering fault, and logs what failed so the cause is
 * diagnosable rather than guessed at.
 *
 * `recyclingKey` changes per attempt, which is what makes expo-image re-request
 * rather than serve its cached failure.
 */
export function PokemonImage({
  uri,
  style,
  contentFit = 'contain',
  /** Show the card back when every attempt fails. Off for inline chips. */
  fallback = true,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  fallback?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  // A new sprite starts its own attempt budget.
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [uri]);

  const onError = useCallback(
    (event: { error: string }) => {
      console.warn(`[sprite] failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}) ${uri}: ${event.error}`);
      if (attempt >= MAX_RETRIES) {
        setFailed(true);
        return;
      }
      const t = setTimeout(() => setAttempt((n) => n + 1), RETRY_DELAY_MS);
      return () => clearTimeout(t);
    },
    [attempt, uri],
  );

  if (failed && fallback) {
    return (
      <View style={[styles.fallback, style]}>
        <CardBack />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      recyclingKey={`${uri}#${attempt}`}
      transition={120}
      onError={onError}
    />
  );
}

/**
 * Warm the cache for a whole board at once, so tiles don't each race the
 * network as they deal in. Fire-and-forget: a failed prefetch costs nothing,
 * because {@link PokemonImage} still fetches and retries on its own.
 */
export function prefetchSprites(uris: string[]): void {
  if (uris.length === 0) return;
  Image.prefetch(uris, { cachePolicy: 'memory-disk' }).catch(() => {});
}

const styles = StyleSheet.create({
  fallback: { overflow: 'hidden' },
});
