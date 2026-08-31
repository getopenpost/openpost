# Mobile publishing loop revamp

## Scope

Revamp the signed-in Android publishing loop while preserving onboarding and server configuration. The changed mobile routes are Drafts, Composer, Calendar, Queue, and Publication detail. The web change is limited to failed-Publication dismissal and restoration.

## User flow

1. Drafts starts with a real multiline "Jot an idea" field.
2. The user can keep writing manually or generate a post from the idea.
3. AI generation returns one canonical post plus destination-specific Renditions for the selected Social Set. It never schedules or publishes.
4. The composer uses one main writing field. It does not show the internal Publication title.
5. Photos from the library, camera, and Android share intent remain ordered, removable, uploadable, and visible before queueing.
6. Social Sets apply their snapshotted destinations. The default Social Set is the initial fast path when no destinations are already saved.
7. "Queue next slot" generates or saves the reviewed content, requests the Workspace's next available posting slot, and schedules the Publication. Manual date and time selection remains available.

## Failed Publications

- Dismissal acknowledges a failed Publication without deleting it or its delivery evidence.
- Dismissed failures leave failed lists on mobile and web.
- Publication detail still exposes the failed outcome and can restore it.
- Mobile provides a right-swipe action and an accessible button. Both surfaces offer immediate Undo.
- Retrying clears dismissal so a repeated failure becomes visible again.

## API boundaries

- `POST /post-builder/generate` accepts bounded idea text and selected account IDs within one editable Workspace. It returns canonical source text and one optional body per requested destination. It does not persist content.
- `POST /publications/{id}/failure-dismissal` dismisses a currently failed Publication.
- `DELETE /publications/{id}/failure-dismissal` restores it.
- Generated content uses the shared provider-neutral AI generator and shared text-generation model configuration.

## Compatibility

- The Publication title remains in storage and the public contract for existing clients. Mobile stops editing it and derives labels from source or Rendition text.
- Existing drafts, schedules, Renditions, media, and Social Sets need no migration beyond the nullable failure-dismissal timestamp.
- Self-hosted deployments without an AI provider keep manual composition and receive a clear unavailable response from generation.

## Verification

- Service and HTTP tests cover generated-output validation, Workspace and account isolation, unavailable and rate-limited AI, dismissal filtering, restoration, and retry visibility.
- Mobile tests cover the Android date-then-time state machine and exact seven-cell calendar weeks.
- Run mobile type, lint, Expo Doctor, and unit checks.
- Build, install, and exercise the release APK on an Android emulator or device. Capture phone light, phone dark, and enlarged-font screenshots, and inspect logs for crashes.
- Exercise failed dismissal in the web app at desktop and phone widths in both themes.
