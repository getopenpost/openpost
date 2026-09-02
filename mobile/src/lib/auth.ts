import {
  api,
  apiRequestIdentityIsCurrent,
  captureApiRequestIdentity,
  clearTokenForIdentity,
  commitTokenForIdentity,
  errorMessage,
} from "./api/client";
import Constants from "expo-constants";
import { Platform } from "react-native";

export type LoginResult =
  | { kind: "signed-in" }
  | { kind: "mfa"; mfaToken: string; methods: string[] }
  | { kind: "email-verification" };

export async function login(email: string, password: string): Promise<LoginResult> {
  const identity = captureApiRequestIdentity();
  const { data, error, response } = await api().POST("/auth/login", {
    body: { email, password },
  });
  if (error || !data) throw new Error(await errorMessage(response, "Sign in failed"));
  requireCurrentIdentity(identity);
  if (data.requires_mfa) {
    return {
      kind: "mfa",
      mfaToken: data.mfa_token ?? "",
      methods: data.mfa_methods ?? ["totp"],
    };
  }
  if (data.requires_email_verification) return { kind: "email-verification" };
  if (!data.token) throw new Error("Sign in did not return a session");
  requireCommittedIdentity(await commitTokenForIdentity(data.token, identity));
  return { kind: "signed-in" };
}

export async function verifyTotp(mfaToken: string, code: string): Promise<void> {
  const identity = captureApiRequestIdentity();
  const { data, error, response } = await api().POST("/auth/login/totp", {
    body: { mfa_token: mfaToken, code },
  });
  if (error || !data) throw new Error(await errorMessage(response, "Invalid code"));
  if (!data.token) throw new Error("Verification did not return a session");
  requireCommittedIdentity(await commitTokenForIdentity(data.token, identity));
}

export type PairingState = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
};

export type PairPoll =
  | { status: "pending"; intervalMs: number }
  | { status: "approved" }
  | { status: "denied" }
  | { status: "expired" };

export async function startPairing(clientName = "OpenPost Mobile"): Promise<PairingState> {
  const identity = captureApiRequestIdentity();
  const { data, error, response } = await api().POST("/cli/auth/start", {
    body: {
      client_name: clientName,
      client_os: Platform.OS,
      client_version: Constants.expoConfig?.version ?? "unknown",
    },
  });
  if (error || !data) throw new Error(await errorMessage(response, "Could not start pairing"));
  requireCurrentIdentity(identity);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url,
  };
}

export async function pollPairing(deviceCode: string): Promise<PairPoll> {
  const identity = captureApiRequestIdentity();
  const { data, error, response } = await api().POST("/cli/auth/poll", {
    body: { device_code: deviceCode },
  });
  if (error || !data) throw new Error(await errorMessage(response, "Pairing check failed"));
  requireCurrentIdentity(identity);
  switch (data.status) {
    case "authorization_pending":
      return { status: "pending", intervalMs: (data.interval ?? 5) * 1000 };
    case "access_denied":
      return { status: "denied" };
    case "expired_token":
      return { status: "expired" };
    default:
      if (data.token) {
        requireCommittedIdentity(await commitTokenForIdentity(data.token, identity));
        return { status: "approved" };
      }
      return { status: "pending", intervalMs: (data.interval ?? 5) * 1000 };
  }
}

export async function signOut(): Promise<boolean> {
  const identity = captureApiRequestIdentity();
  try {
    await api().POST("/auth/logout");
  } catch {
    // A network failure does not prevent clearing the captured local session.
  }
  return clearTokenForIdentity(identity);
}

function requireCurrentIdentity(identity: ReturnType<typeof captureApiRequestIdentity>): void {
  if (!apiRequestIdentityIsCurrent(identity)) throw sessionChanged();
}

function requireCommittedIdentity(committed: boolean): void {
  if (!committed) throw sessionChanged();
}

function sessionChanged(): DOMException {
  return new DOMException("The sign-in session changed", "AbortError");
}
