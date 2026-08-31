import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from "react-native";

import {
  BodyText,
  Button,
  Card,
  Screen,
  SectionHeader,
  TextField,
  useColors,
} from "@/components/ui";
import { Brand } from "@/components/brand";
import { errorHaptic, successHaptic } from "@/lib/haptics";
import { HOSTED_URL, probeServer, setServer } from "@/lib/server";

export default function ServerScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const [url, setUrl] = useState("");
  const [showSelfHosted, setShowSelfHosted] = useState(false);
  const [busy, setBusy] = useState<"hosted" | "custom" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(target: string, kind: "hosted" | "custom") {
    setBusy(kind);
    setError(null);
    const result = await probeServer(target);
    if (!result.ok) {
      setBusy(null);
      setError(result.error);
      void errorHaptic();
      return;
    }
    await setServer(result.baseUrl);
    void successHaptic();
    setBusy(null);
    router.replace(params.from === "settings" ? "/" : "/onboarding/login");
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Brand style={styles.brand} />
          <Text style={[styles.title, { color: colors.text }]}>Sign in to OpenPost</Text>
          <BodyText style={styles.subtitle}>Choose where to sign in.</BodyText>

          <Card style={styles.hostedCard}>
            <Text style={[styles.hostedTitle, { color: colors.text }]}>OpenPost Hosted</Text>
            <BodyText>Managed at {HOSTED_URL.replace("https://", "")}</BodyText>
            <Button
              title="Continue to sign in"
              variant="focal"
              disabled={busy !== null}
              loading={busy === "hosted"}
              onPress={() => void choose(HOSTED_URL, "hosted")}
              style={styles.hostedButton}
            />
          </Card>

          {error ? (
            <BodyText accessibilityRole="alert" style={{ color: colors.danger }}>
              {error}
            </BodyText>
          ) : null}

          <Button
            title={showSelfHosted ? "Hide self-hosted setup" : "Connect a self-hosted server"}
            variant="plain"
            accessibilityHint={`${showSelfHosted ? "Hides" : "Shows"} the self-hosted server address field`}
            accessibilityState={{ expanded: showSelfHosted }}
            disabled={busy !== null}
            onPress={() => setShowSelfHosted((current) => !current)}
          />

          {showSelfHosted ? (
            <>
              <SectionHeader label="Your server" />
              <TextField
                value={url}
                onChangeText={setUrl}
                accessibilityLabel="Self-hosted server address"
                placeholder="openpost.example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={() => void choose(url, "custom")}
              />
              <BodyText>Use the HTTPS address for your OpenPost server.</BodyText>
              <Button
                title="Connect to server"
                variant="tinted"
                disabled={busy !== null || url.trim().length === 0}
                loading={busy === "custom"}
                onPress={() => void choose(url, "custom")}
                style={styles.connectButton}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingTop: 44,
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
    marginBottom: 16,
  },
  hostedCard: {
    gap: 4,
  },
  hostedTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  hostedButton: {
    marginTop: 12,
  },
  connectButton: {
    marginTop: 4,
  },
});
