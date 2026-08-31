import { router, Stack } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from "react-native";

import { BodyText, Button, Card, Screen, TextField, useColors } from "@/components/ui";
import { Brand } from "@/components/brand";
import { login, verifyTotp } from "@/lib/auth";
import { errorHaptic, successHaptic } from "@/lib/haptics";
import { clearServer } from "@/lib/server";

export default function LoginScreen() {
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) {
        await verifyTotp(mfaToken, totpCode);
      } else {
        const result = await login(email.trim(), password);
        if (result.kind === "mfa") {
          setMfaToken(result.mfaToken);
          setBusy(false);
          return;
        }
        if (result.kind === "email-verification") {
          setError("Verify your email address on the web first, then sign in again.");
          setBusy(false);
          return;
        }
      }
      void successHaptic();
      router.replace("/onboarding/workspace");
    } catch (err) {
      void errorHaptic();
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Brand compact style={styles.brand} />
          <Text style={[styles.title, { color: colors.text }]}>Sign in</Text>
          <BodyText style={styles.subtitle}>
            {mfaToken
              ? "Enter the 6-digit code from your authenticator app."
              : "Use your OpenPost account."}
          </BodyText>

          {mfaToken ? (
            <TextField
              value={totpCode}
              onChangeText={setTotpCode}
              accessibilityLabel="Authenticator code"
              placeholder="123456"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
              onSubmitEditing={() => void submit()}
            />
          ) : (
            <>
              <TextField
                value={email}
                onChangeText={setEmail}
                accessibilityLabel="Email"
                placeholder="Email"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
              />
              <TextField
                value={password}
                onChangeText={setPassword}
                accessibilityLabel="Password"
                placeholder="Password"
                secureTextEntry
                textContentType="password"
                autoComplete="password"
                onSubmitEditing={() => void submit()}
              />
            </>
          )}

          {error ? (
            <BodyText accessibilityRole="alert" style={{ color: colors.danger }}>
              {error}
            </BodyText>
          ) : null}

          <Button
            title="Continue"
            variant="focal"
            onPress={() => void submit()}
            disabled={busy || (mfaToken ? totpCode.length !== 6 : !email || !password)}
            loading={busy}
            style={styles.continue}
          />

          <Card style={styles.pairCard}>
            <BodyText>Using single sign-on? Pair this device with a browser instead.</BodyText>
            <Button
              title="Pair with browser"
              variant="tinted"
              onPress={() => router.push("/onboarding/pair")}
              style={{ marginTop: 10 }}
            />
          </Card>

          <Button
            title="Use a different server"
            variant="plain"
            onPress={() => {
              void clearServer().then(() => router.replace("/onboarding/server"));
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingTop: 40,
    paddingBottom: 40,
    gap: 12,
  },
  brand: {
    marginBottom: 28,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    marginBottom: 12,
  },
  continue: {
    marginTop: 4,
  },
  pairCard: {
    marginTop: 24,
  },
});
