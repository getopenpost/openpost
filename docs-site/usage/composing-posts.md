# Composing Posts

OpenPost uses a fast text-and-thread composer for Post and Thread. The focused composer handles stories, short videos, videos, and other format-specific fields. Both use the same publication and rendition model.

## Typical workflow

1. Choose Post, Thread, Story, Short video, or Video.
2. Write the shared content and add media.
3. Select connected accounts in **Publish to**.
4. Open an account's cog to review its resolved output and destination options.
5. Fix any compatibility issues, then save, validate, schedule, or publish.

Multiple images stay part of the Post intent. OpenPost resolves them to the provider's image, carousel, multi-image, or photo-post output. If you attach a video to Post, the composer asks you to switch to Short video or Video.

## Drafts and renditions

Draft publications are the source of truth before publishing. Their ordered segments hold shared content and media. Each selected account has a rendition with its resolved output, destination settings, segment overrides, and media-item settings.

Deselecting an account keeps its rendition and settings. Use **Delete destination** only when you want to remove that saved rendition.

Each draft save includes the revision loaded by the editor. OpenPost saves source content, thread parts, media, destinations, overrides, and settings in one transaction. Saves are serialized, and scheduling or publishing waits for the pending save.

If another tab or teammate saves first, OpenPost stops instead of overwriting their work. The conflict dialog lists the affected areas and lets you:

- reload the saved version;
- save your current work as a new draft;
- overwrite only after reviewing the latest revision;
- keep editing without taking an action yet.

Closing or hiding a tab triggers a best-effort save, but browsers do not guarantee unload requests. Wait for the saved state before closing when the content matters.

## Platform previews

The **Publish to** menu shows every selected account separately, including multiple accounts from the same provider. Each row shows the resolved output and a compact settings summary. The account cog opens destination content overrides and only the options that apply to the current intent, output, and media shape.

Drafts can be saved while incomplete. Scheduling and publishing re-resolve live account capabilities and block stale privacy choices, removed playlists, expired permissions, invalid media, and conflicting attachments.

See [Destination Options](/usage/destination-options) for the provider matrix and setting scopes.

## Practical advice

- Keep shared content canonical and customize only where a destination needs it.
- Add alt text and media tags from the destination cog because providers use different media metadata.
- Resolve all errors before scheduling. Warnings can describe provider approval, quota, or live-account limits that OpenPost cannot remove.
