# Provider Verification Log

> **Empty evidence template. No provider is verified by this file.** Replace `_Not tested_` only after the exact account and format complete a live end-to-end rehearsal.

Implemented, configured, and live-verified are separate states:

- **Implemented:** the adapter and OpenPost path exist in the repository.
- **Configured:** the current server and account satisfy provider app, permission, public-media, and quota requirements.
- **Live-verified:** the exact account and format published recently, and the final provider result was recorded.

## Campaign context

- Campaign: `[CAMPAIGN NAME]`
- OpenPost version or commit: `[VERSION]`
- Instance: `[HOSTED SERVICE OR SELF-HOSTED; DO NOT RECORD SECRETS]`
- Verification window: `[START]` to `[END]`
- Reviewer: `[NAME]`

## Exact-path results

Create separate rows for text, image, video, carousel, Story, thread/reply, and scheduling paths. Do not infer one format from another.

| Provider | Account ID or slug | Format and media shape | Code status | Runtime configured | Connect result | Validation result | Schedule result | Final provider result | Published URL or failure ID | Verified at | Verified by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| X |  |  | Launch adapter | _Not checked_ | _Not tested_ | _Not tested_ | _Not tested_ | _Not tested_ |  |  |  |
| Mastodon |  |  | Launch adapter | _Not checked_ | _Not tested_ | _Not tested_ | _Not tested_ | _Not tested_ |  |  |  |
| Bluesky |  |  | Launch adapter | _Not checked_ | _Not tested_ | _Not tested_ | _Not tested_ | _Not tested_ |  |  |  |
| LinkedIn |  |  | Launch adapter | _Not checked_ | _Not tested_ | _Not tested_ | _Not tested_ | _Not tested_ |  |  |  |
| Threads |  |  | Launch adapter | _Not checked_ | _Not tested_ | _Not tested_ | _Not tested_ | _Not tested_ |  |  |  |
| Facebook Pages |  |  | Preview adapter | _Not checked_ | _Not tested_ | _Not tested_ | _Not tested_ | _Not tested_ |  |  |  |
| Instagram Business |  |  | Preview adapter | _Not checked_ | _Not tested_ | _Not tested_ | _Not tested_ | _Not tested_ |  |  |  |
| TikTok |  |  | Preview adapter; audit gate | _Not checked_ | _Not tested_ | _Not tested_ | _Not tested_ | _Not tested_ |  |  |  |
| YouTube |  |  | Preview adapter; audit gate | _Not checked_ | _Not tested_ | _Not tested_ | _Not tested_ | _Not tested_ |  |  |  |

## Evidence required for `live-verified`

- OpenPost version or commit and verification date;
- provider account ID or non-secret slug;
- exact content profile and media count/type;
- connection and readiness result;
- scheduled time and workspace timezone when scheduling is shown;
- final OpenPost lifecycle event;
- provider post ID and URL, or an honest failure ID and message;
- reviewer name and any manual edits made after agent preparation.

## Demo rule

The main demo may use only rows with a successful final provider result for the exact format shown. Keep Facebook, Instagram, TikTok, YouTube, and any other preview or audit-gated path out unless their status changes and the exact path is re-verified.

Do not commit tokens, provider secrets, private account data, or screenshots that expose them.
