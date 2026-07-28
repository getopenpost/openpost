# Discord Webhooks

Discord uses an incoming webhook URL instead of OAuth. In **Accounts**, choose **Discord**, paste a webhook URL, and connect it. OpenPost verifies the webhook before saving it and stores the complete URL as an encrypted credential.

Create a webhook in the target Discord channel under **Integrations → Webhooks**. Treat its URL like a password. Anyone who has it can post to that channel.

## Publishing

OpenPost supports:

- text messages;
- up to 10 file attachments;
- attachment descriptions from media alt text;
- reply references for text-and-thread segments;
- scheduled publishing and deletion of messages created by the webhook.

Text and files are sent together as a streamed `multipart/form-data` webhook request with `wait=true`, so OpenPost records the provider message ID. User and role mentions are disabled by default to prevent scheduled content from notifying a server unexpectedly.

OpenPost only accepts HTTPS webhook URLs on Discord-owned hosts and the exact webhook path shape. It rejects custom ports, credentials in the URL, fragments, control characters, and lookalike hosts.

## Limits

Discord applies the upload size limit of the server or account that owns the webhook. OpenPost validates the attachment count, but Discord remains the source of truth for byte limits and rate limits.

Discord webhooks are outbound-only. They do not provide a channel inbox, personal Discord notifications, or direct messages.
