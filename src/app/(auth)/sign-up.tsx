import { useSignUp } from '@clerk/clerk-expo';
import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBrand } from '@/components/auth/AuthBrand';
import { Button, Card, Screen, TextField, colors, spacing, type } from '@/ui';

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignUp = async () => {
    if (!isLoaded) return;
    setError(null);
    setBusy(true);
    try {
      const attempt = await signUp.create({ username, emailAddress: email, password });
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId });
      } else {
        setError(`Sign up incomplete: ${attempt.status} (missing: ${attempt.missingFields?.join(', ') || 'unknown'})`);
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? 'Sign up failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <AuthBrand subtitle="Create your trainer card" />
          <Card style={styles.form}>
            <TextField
              placeholder="Username"
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              editable={!busy}
            />
            <TextField
              placeholder="Email"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!busy}
            />
            <TextField
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              editable={!busy}
            />
            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <Button title="Sign up" onPress={onSignUp} busy={busy} disabled={!isLoaded} />
          </Card>
          <Link href="/(auth)/sign-in" style={styles.link}>
            Already have an account? <Text style={styles.linkStrong}>Sign in</Text>
          </Link>
          {/* Mount point for Clerk's bot-protection captcha widget (web only) */}
          {Platform.OS === 'web' && <div id="clerk-captcha" />}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xl },
  form: { gap: spacing.md },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: { ...type.label, color: colors.danger },
  link: { ...type.body, color: colors.inkMuted, textAlign: 'center', marginTop: spacing.lg },
  linkStrong: { color: colors.primary, fontWeight: '800' },
});
