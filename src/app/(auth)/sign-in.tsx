import { useSignIn } from '@clerk/clerk-expo';
import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBrand } from '@/components/auth/AuthBrand';
import { Button, Card, Screen, TextField, colors, spacing, type } from '@/ui';

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsSecondFactor, setNeedsSecondFactor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    if (!isLoaded) return;
    setError(null);
    setBusy(true);
    try {
      const attempt = await signIn.create({ identifier: email, password });
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId });
      } else if (attempt.status === 'needs_second_factor') {
        await signIn.prepareSecondFactor({ strategy: 'email_code' });
        setNeedsSecondFactor(true);
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  const onVerifySecondFactor = async () => {
    if (!isLoaded) return;
    setError(null);
    setBusy(true);
    try {
      const attempt = await signIn.attemptSecondFactor({ strategy: 'email_code', code });
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId });
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? 'Verification failed');
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
          {needsSecondFactor ? (
            <>
              <AuthBrand subtitle="New device — check your email" />
              <Card style={styles.form}>
                <Text style={styles.help}>Enter the verification code we sent you.</Text>
                <TextField
                  placeholder="Verification code"
                  keyboardType="number-pad"
                  value={code}
                  onChangeText={setCode}
                  editable={!busy}
                />
                {error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
                <Button title="Verify" onPress={onVerifySecondFactor} busy={busy} disabled={!isLoaded} />
              </Card>
            </>
          ) : (
            <>
              <AuthBrand subtitle="Sign in to keep playing" />
              <Card style={styles.form}>
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
                <Button title="Sign in" onPress={onSignIn} busy={busy} disabled={!isLoaded} />
              </Card>
              <Link href="/(auth)/sign-up" style={styles.link}>
                Need an account? <Text style={styles.linkStrong}>Sign up</Text>
              </Link>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xl },
  form: { gap: spacing.md },
  help: { ...type.body, color: colors.inkMuted },
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
