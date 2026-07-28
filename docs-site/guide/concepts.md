# Concepts

Understanding OpenPost's model makes the OAuth and scheduling docs easier to follow.

## Workspace

A workspace groups accounts, media, prompts, and scheduling settings. Most content in OpenPost is workspace-scoped.

Workspace members belong to a workspace with a role. Pending invitations reserve
team seats until they are accepted, revoked, or expire.

## Social account

A connected provider account, such as one X account or one Mastodon profile.

## Post

A scheduled or published artifact that can target one or multiple provider
accounts. A post starts from base content and can carry destination-specific
renditions when one copy does not fit every platform.

## Draft

An editable post before it is scheduled or published. Drafts can be created
from the web app, CLI, API, or MCP tools.

## Thread

A chain of posts published in sequence. OpenPost maps thread replies to each provider's API model.

## Rendition

Account-specific content for a post when one message does not fit every
connected destination equally well.

## Media

Files stored locally and attached to posts. Some providers, especially Threads, require the media to be publicly reachable through `OPENPOST_MEDIA_URL`.

## Job

Durable background work stored in the configured OpenPost database. Publishing should go through the jobs table rather than transient goroutines.

## Provider

An adapter implementing one social platform's auth, publish, and media behavior.

## Callback URL

The URL a provider redirects back to after auth. These must match what you configure in the provider developer console.

## Public media URL

The externally reachable base URL for uploaded media. This matters most for Threads.
