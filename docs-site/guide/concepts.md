# Concepts

Use this page when you need the product terms used by the app and documentation.

These terms appear in the app and docs.

These definitions do not override provider rules, account permissions, or plan limits.

## Workspace

A workspace keeps a brand or client's accounts, posts, media, prompts, schedule, and members together.

Each member has a role. A pending invite uses a team seat until someone accepts it, you cancel it, or it expires.

## Social account

A connected social account, such as one X account or one Mastodon profile.

## Publication

A publication is OpenPost's saved record for one post, thread, Story, short video, or video. It keeps the shared content, selected accounts, account versions, media, schedule, and status together.

The app usually calls this a **post**. The API and CLI use **publication**.

## Draft

An editable publication that has not gone live. You can create a draft from the web app, CLI, API, or MCP.

## Thread

A set of posts published in order. OpenPost sends each reply in the form required by the social network.

## Account version

The text, media, format, and settings for one selected account. It can use the shared content or override it.

The API and CLI call this a **rendition**.

## Media

Files saved in the media library and attached to posts. Threads, Facebook, Instagram, and some TikTok publishing flows need a public media link set through `OPENPOST_MEDIA_URL`.

## Job

Work that OpenPost saves in its database and runs in the background. Saved jobs let scheduled posts survive a server restart.

## Provider

A social network that OpenPost can connect to. Technical docs may also use **provider** for the code that handles a network.

## Callback URL

The address a social network returns to after sign-in. It must match the address set in that network's developer portal.

## Public media URL

The public base address for uploaded media. Threads, Facebook, Instagram, and some TikTok flows use it to fetch a file.
