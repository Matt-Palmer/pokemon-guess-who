import { ClerkProvider } from '@clerk/clerk-expo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';
import { tokenCache } from '@/lib/clerk-token-cache';

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
          <Stack.Screen name="new-game" options={{ presentation: 'modal', title: 'New Game' }} />
          <Stack.Screen name="lobby/[id]" options={{ title: 'Party Lobby' }} />
          <Stack.Screen name="match/[id]" options={{ title: 'Game', headerBackVisible: false }} />
        </Stack>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
