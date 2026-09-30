import { ClerkProvider } from '@clerk/clerk-expo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { tokenCache } from '@/lib/clerk-token-cache';
import { colors } from '@/ui';

/**
 * Anchor every pushed route to the tabs.
 *
 * A cold start straight onto `/match/[id]` — a relaunch, or a deep link —
 * otherwise leaves the stack with nothing beneath it, and React Navigation
 * renders no back button however the screen is configured. Naming the initial
 * route means there is always somewhere to go back to.
 */
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  return (
    <ClerkProvider
      tokenCache={tokenCache}
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: colors.onPrimary,
            headerTitleAlign: 'center',
          }}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="matchmaking" options={{ title: 'Random Game' }} />
          <Stack.Screen name="lobby/[id]" options={{ title: 'Party Lobby' }} />
          {/* Back was hidden here to stop players wandering out of a game. But
              leaving is harmless — only an explicit resign forfeits, and the
              match waits in the Games list — while Android's hardware back and
              iOS's edge swipe left anyway. A working but invisible exit is the
              worst of both, so it is a labelled button again. */}
          <Stack.Screen name="match/[id]" options={{ title: 'Game', headerBackTitle: 'Games' }} />
        </Stack>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
