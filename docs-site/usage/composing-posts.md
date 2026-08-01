# Composing Posts

OpenPost uses the text-and-thread composer for Post and Thread. A focused editor handles Stories, short videos, videos, and their extra fields. Both save the shared content and each account version together.

## Steps

1. Choose Post, Thread, Story, Short video, or Video.
2. Write the shared content and add media.
3. Select connected accounts in **Publish to**.
4. Open an account's settings to review its final version and options.
5. Fix any errors, then save, check, schedule, or publish.

Multiple images stay in the Post. OpenPost sends them as an image, carousel, multi-image post, or photo post based on the platform. If you add a video to Post, the editor asks you to switch to Short video or Video.

## Drafts and account versions

A draft keeps the shared text, thread parts, and media. Each selected account has its own final text, platform settings, thread changes, and media settings.

The status row shows whether you are editing shared text or one account version. It also shows whether the draft is saved, saving, not saved, or in conflict, and how many accounts are ready. Use **Reset to shared content** to remove custom text for one account.

Deselecting an account keeps its saved version and settings. Use **Delete account version** only when you want to remove them.

Each save includes the draft version loaded by the editor. OpenPost saves shared content, thread parts, media, selected accounts, custom text, and settings together. It finishes one save before starting the next. Scheduling and publishing wait for an active save.

If another tab or teammate saves first, OpenPost stops instead of overwriting their work. The conflict dialog lists the affected areas and lets you:

- reload the saved version;
- save your current work as a new draft;
- overwrite only after reviewing the latest revision;
- keep editing without taking an action yet.

When OpenPost knows who made the latest change, the dialog names that person without showing draft content or other workspace data. **Overwrite** first loads the latest saved version, then saves your copy over it.

Closing or hiding a tab triggers a best-effort save, but browsers do not guarantee unload requests. Wait for the saved state before closing when the content matters.

## Platform previews

The **Publish to** menu shows each selected account, including more than one account from the same platform. Each row shows the final output and a short settings summary. Account settings show custom content and only the options that fit the current post, format, and media.

You can save an incomplete draft. Before scheduling or publishing, OpenPost checks the account again. It blocks old privacy choices, removed playlists, expired access, invalid media, and conflicting files.

See [Account Options](/usage/destination-options) for the options each social network supports.

## Practical advice

- Keep the shared text simple. Change it only when an account needs a different version.
- Add alt text and media tags in account settings because platforms use different media details.
- Fix all errors before scheduling. A warning may point to app review, API limits, or account limits that OpenPost cannot change.
