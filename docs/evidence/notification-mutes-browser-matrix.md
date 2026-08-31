# Notification Mutes browser evidence

The real application and API path is covered by `e2e-app/notifications.spec.ts` at desktop, 390 px, and 320 px widths. The test creates overlapping account-wide and Workspace Mutes from offset timestamps, verifies their stored UTC instants, shows both scopes and end times on `/inbox/notifications` and `/settings?tab=notifications`, and ends the Workspace Mute from Settings. At phone widths it scrolls Start Mute, End now, and Save preferences into the viewport and verifies that each action stays clear of the fixed navigation. It also checks horizontal overflow, browser console errors, and uncaught page errors before writing these screenshots to the Playwright run output:

- `notification-mutes-1280.png`
- `notification-mutes-390.png`
- `notification-mutes-320.png`
- `settings-notification-mutes-1280.png`
- `settings-notification-mutes-390.png`
- `settings-notification-mutes-320.png`
- `settings-notification-mutes-save-390.png`
- `settings-notification-mutes-save-320.png`
