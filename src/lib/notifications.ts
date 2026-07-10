import { useAuth, useUser } from '@clerk/clerk-expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Href, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { Profile } from '@/lib/profile';
import { useSupabase } from '@/lib/supabase';

// The PRD notifies only when the app is backgrounded: an open app already
// shows every state change live (Realtime), so foreground presentation is
// suppressed entirely. This also makes the server's game-ended send-to-both
// correct — the player who just ended the game never sees their own push.
//
// expo-notifications has no web implementation (its module functions throw on
// web), so every entry point in this file is native-only — including this
// module-scope call, which would otherwise crash `expo start --web` at import.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * The device's Expo push token, or null wherever push can't work: simulators,
 * Expo Go (remote push support was removed in SDK 53 — a dev build is
 * required), a project not yet linked to EAS (no projectId), or permission
 * denied. Callers treat null as "this install doesn't receive pushes".
 */
async function getPushTokenOrNull(): Promise<string | null> {
  // Web reports Device.isDevice = true, but the notifications module isn't
  // available there — bail before touching it.
  if (Platform.OS === 'web' || !Device.isDevice) return null;

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    // Android requires a channel before any notification can be delivered.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Game updates',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

/**
 * Registers this install for push and stores the Expo token on the signed-in
 * user's profile (`expo_push_token` — one of the client-writable identity
 * columns), where the push Edge Function looks it up. Pass the loaded profile:
 * registration waits for the row to exist and skips the write when the stored
 * token is already current. Fails silently — push being unavailable must never
 * affect the app.
 */
export function usePushRegistration(profile: Profile | null) {
  const supabase = useSupabase();
  const { user } = useUser();
  const attempted = useRef(false);

  useEffect(() => {
    if (!profile || !user || attempted.current) return;
    attempted.current = true;

    (async () => {
      const token = await getPushTokenOrNull();
      if (!token || token === profile.expo_push_token) return;
      await supabase
        .from('profiles')
        .update({ expo_push_token: token })
        .eq('clerk_id', user.id);
    })().catch(() => {});
  }, [profile, user, supabase]);
}

/**
 * Opens the game a tapped notification points at. Every push carries a
 * `data.url` expo-router path (`/lobby/[id]` or `/match/[id]`);
 * `useLastNotificationResponse` covers both a cold start from a tap and taps
 * while backgrounded. Each response is handled once (guarded by identifier) so
 * re-renders never re-navigate.
 */
export function useNotificationDeepLink() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const response = Notifications.useLastNotificationResponse();
  const handledId = useRef<string | null>(null);

  useEffect(() => {
    // Wait for the session on cold start: match/lobby screens assume a
    // signed-in user, and the response is still here once auth resolves.
    if (!isLoaded || !isSignedIn || !response) return;
    const id = response.notification.request.identifier;
    if (handledId.current === id) return;
    handledId.current = id;

    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) {
      router.push(url as Href);
    }
  }, [isLoaded, isSignedIn, response, router]);
}
