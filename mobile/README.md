# OpenPost Mobile

OpenPost Mobile is a standalone Expo app. It uses native tabs and Android controls instead of a web view, and talks to the same `/api/v1` contract as the web app.

## What it includes

- OpenPost Hosted or a self-hosted HTTPS server
- Email, password, TOTP, and browser device pairing
- Workspace selection and secure token storage
- Quick draft capture, the full composer, photos, and Android share capture
- Destination selection, per-platform text, scheduling, and publish now
- Calendar, queue, retry state, and provider-level post results
- Light and dark themes with Android safe areas and native symbols

Settings stay in the web app. Use **Open web app** in the Drafts menu.

## Prerequisites

- Bun from the root Devenv shell
- JDK 21
- Android SDK platform 36, build tools 36.0.0, NDK 27.1.12297006, and CMake 3.22.1
- An Android device or emulator for install checks

Run all mobile commands from this directory.

## Install and check

```sh
bun install --frozen-lockfile
bun run check
```

`bun run check` runs TypeScript, Expo lint, Expo Doctor, and the mobile unit tests. Regenerate the API types after the backend contract changes:

```sh
bun run generate:api
```

## Run on Android

For normal development with an attached device or running emulator:

```sh
bun run android
```

Expo Go can show JavaScript-only screens, but it cannot test the native share receiver. Use the native Android build for full testing.

## Build an installable APK

```sh
bun run build:android:apk
```

The command does a clean Expo prebuild, compiles only `arm64-v8a`, and writes:

```text
android/app/build/outputs/apk/release/app-release.apk
```

This local APK uses Android's generated debug key. It is fit for emulator, device, and private preview installs. It is not a Play Store or production release signature.

Install and launch it with:

```sh
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.openpost.app/.MainActivity
```

Inspect the package before sharing it:

```sh
unzip -t android/app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging \
  android/app/build/outputs/apk/release/app-release.apk | head
shasum -a 256 android/app/build/outputs/apk/release/app-release.apk
```

## Build the CI release candidate

```sh
bun run build:android:candidate
```

This produces the unsigned universal candidate at:

```text
android/app/build/outputs/apk/release/app-release-unsigned.apk
```

Do not send or publish that unsigned file as an installable release. Candidate CI keeps it unchanged. The tag release workflow signs and verifies that exact candidate with the project release key, then publishes it as `openpost-app-android.apk`.

## GitHub Actions

The **Native mobile Android candidate** job in `.github/workflows/ci.yml` runs when `mobile/`, `frontend/openapi.json`, `packages/api-contract/`, or `packages/query-catalog/` changes. It:

1. Installs the pinned Android SDK parts and mobile lockfile.
2. Runs `bun run check`.
3. Builds the unsigned universal release candidate.
4. Checks the APK archive and records its SHA-256 digest.
5. Uploads the unsigned release input for the tag workflow.
6. Signs a separate installable preview with Android's debug key and uploads it for device checks.

The two artifacts have different names so no one can mistake a preview signature for the release input.

## Generated native projects

`android/` and `ios/` come from Expo prebuild and stay out of Git. Put persistent native configuration in `app.json` or a config plugin under `plugins/`. Never edit generated Gradle or Xcode files as the source of truth.

The release-signing plugin intentionally fails if Expo changes the Gradle template it patches. That makes a signing drift visible during prebuild instead of silently shipping a debug-signed release candidate.

## Main code seams

- `src/lib/server.ts`: server state and readiness probe
- `src/lib/api/token-store.ts`: token and workspace state in SecureStore
- `src/lib/api/client.ts`: typed OpenAPI client backed by the shared contract
- `../packages/api-contract/`: the generated API declarations for web and mobile
- `../packages/query-catalog/`: shared Query keys, policies, and read definitions
- `src/lib/auth.ts`: login, TOTP, and pairing
- `src/lib/media.ts`: direct upload sessions
- `src/lib/share.ts`: content received from the Android share sheet
- `src/app/`: Expo Router screens and native tabs

For background on local production builds and APKs, see the [Expo local app development guide](https://docs.expo.dev/guides/local-app-development/), [local production guide](https://docs.expo.dev/guides/local-app-production/), and [APK guide](https://docs.expo.dev/build-reference/apk/).
