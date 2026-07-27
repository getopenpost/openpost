# Android App

OpenPost ships an Android app built with Capacitor. It wraps the same SvelteKit frontend as the web app, so it connects to your self-hosted OpenPost instance instead of a separate mobile backend.

## Install from a Release

Every GitHub release builds an APK asset named:

```text
openpost-app-android.apk
```

Download it from [GitHub Releases](https://github.com/rodrgds/openpost/releases/latest), then install it on your Android device.

Because this is a release APK distributed outside the Play Store, Android may ask you to allow installs from your browser or file manager. Only install APKs from the official OpenPost release page.

## Connect to Your Instance

After installing:

1. Open the Android app.
2. Enter the public URL of your OpenPost instance.
3. Sign in with the same account you use in the web UI.

The instance URL should be reachable from your phone. For normal use this means a public HTTPS URL behind a reverse proxy. Localhost URLs from your server will not work from the phone.

## Server Requirements

Use the same production requirements as the web app:

- `OPENPOST_APP_URL` should match the public URL users open.
- Reverse proxy headers should preserve the public host and scheme.
- OAuth callback URLs in provider apps should match the configured public URL.
- CORS should include any extra origins only when needed.

See [Reverse Proxy](/installation/reverse-proxy) and [CORS and URLs](/configuration/cors-and-urls) for the server-side setup.

## Build Locally

The native Android project lives under `frontend/android` and is synchronized from the SvelteKit build through Capacitor.

From `frontend/`:

```sh
pnpm install
pnpm run build:capacitor
cd android
./gradlew assembleDebug
```

The debug APK is written to:

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

## Signed Release Build

For local signed release builds:

```sh
cd frontend/android
./gradlew assembleRelease \
  -PRELEASE_STORE_FILE=path/to/release.keystore.jks \
  -PRELEASE_STORE_PASSWORD=... \
  -PRELEASE_KEY_ALIAS=... \
  -PRELEASE_KEY_PASSWORD=...
```

The GitHub release workflow uses the same Gradle release path when signing secrets are configured. If signing secrets are not present, it builds an unsigned release APK and still uploads `openpost-app-android.apk`.

## App Configuration

The Capacitor config is in `frontend/capacitor.config.ts`:

- App ID: `com.openpost.app`
- App name: `OpenPost`
- Web directory: `../backend/cmd/openpost/public`
- Android scheme: `https`
- Plugins: `@capacitor/app`, `@capacitor/splash-screen`, `@capacitor/status-bar`, and Capacitor HTTP support

Launcher and splash assets are generated from the shared OpenPost brand icon during `pnpm run build:capacitor`, keeping the Android app visually aligned with the web app.
