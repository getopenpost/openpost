# Discord Webhooks

This page is for operators configuring Discord and users connecting a channel webhook.

Discord uses an incoming webhook link instead of OAuth. In **Accounts**, choose **Discord**, paste the link, and connect it. OpenPost checks the webhook and encrypts the full link before saving it.

Create a webhook in the target Discord channel under **Integrations → Webhooks**. Treat its URL like a password. Anyone who has it can post to that channel.

## Publishing

OpenPost supports:

- text messages;
- up to 10 file attachments;
- attachment descriptions from media alt text;
- reply references for text-and-thread segments;
- scheduled publishing and deletion of messages created by the webhook.

OpenPost sends the text and files together and saves the Discord message ID. User and role mentions are off by default, so a scheduled post does not send an unexpected alert.

OpenPost only accepts HTTPS webhook links on Discord domains. It rejects unsafe or fake links.

## Optional features

Discord webhooks do not support Direct messages, Comments and replies, Analytics, or Grow. OpenPost only publishes through the webhook. These per-account optional features remain unavailable for Discord even when enabled elsewhere.

## Limits

Discord sets the upload limit for the server or account that owns the webhook. OpenPost checks the file count and uses a safe 10 MiB limit, but Discord can enforce a different limit.

Discord webhooks can only send. They do not let OpenPost read a channel inbox, personal alerts, or direct messages.
