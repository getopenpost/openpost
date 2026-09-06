# Android App

This page is for Android users installing OpenPost and connecting it to OpenPost Hosted or a self-hosted instance. OpenPost ships a standalone native Android app built with Expo. It uses the same API as the web app and does not load the web app in a wrapper.

## Install from a release

Official GitHub releases publish this APK:

```text
openpost-app-android.apk
```

Download it from [GitHub Releases](https://github.com/getopenpost/openpost/releases/latest), then open the file on your Android device. Because this is a release APK distributed outside the Play Store, Android may ask you to allow installs from your browser or file manager. Only install APKs from the official OpenPost release page.

## Connect to OpenPost

1. Open the Android app.
2. Choose OpenPost Hosted, or enter the public HTTPS URL of your server.
3. Sign in with email and password, or pair the device from a signed-in browser.
4. Choose a workspace.

A self-hosted server must be reachable from the phone. `localhost`, private development names, URL credentials, and plain HTTP do not work in the production app.

## Server requirements

- Set `OPENPOST_APP_URL` to the public URL users open.
- Preserve the public host and scheme in reverse proxy headers.
- Match provider OAuth callback URLs to the public server URL.
- Use HTTPS with a certificate the Android device trusts.

See [Reverse Proxy](/installation/reverse-proxy) and [CORS and URLs](/configuration/cors-and-urls) for server setup.

## Mobile features

The first native app covers the common work away from a desk:

- Capture and edit drafts
- Receive text, links, and photos through Android sharing
- Select Social Sets or individual destinations
- Adjust text per destination
- Schedule, publish, cancel, retry, and inspect provider results
- Review the calendar and queue

Account connections, billing, and advanced settings remain in the web app. The mobile Drafts menu links to it.

## Build from source

The mobile source lives in `apps/mobile/`. From that directory:

```sh
bun install --frozen-lockfile
bun run check
bun run build:android:apk
```

The installable ARM64 preview APK is written to:

```text
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Local preview builds use Android's generated debug key. They are for an emulator, a device, or private testing. Official releases use the project release key in GitHub Actions.

See `apps/mobile/README.md` in the source tree for the full emulator, package inspection, CI candidate, and signing procedure.

## Release safety

Candidate CI builds an unsigned universal APK and keeps its SHA-256 digest. The tag release workflow downloads that exact artifact, signs it with the project release key, verifies the package and signer, and only then publishes `openpost-app-android.apk`.

CI also uploads a separate debug-signed preview APK. Its artifact name includes `preview`, and it never enters the release workflow.
