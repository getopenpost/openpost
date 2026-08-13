# Agent-Assisted, Human-Reviewed Publishing

An AI tool can prepare posts through MCP without seeing your social account keys. OpenPost keeps those keys, workspace data, checks, and post status in the app. A person reviews the work before allowing a change.

This works well for releases, product updates, open-source news, and repeat campaigns that need different text for each account.

## What the agent can do

With an `mcp:read` token limited to one workspace, a tool can read the workspace, connected accounts, platform setup, media, drafts, schedule, post status, and results. It cannot make changes.

With `mcp:full`, an authorized agent can also:

- create or update a shared draft;
- prepare account versions and choose media;
- check a post and suggest an open time;
- schedule or publish through `execute_operation` after the client receives approval;
- read post status, events, published results, and errors.

The tool does not receive social network access or refresh tokens. OpenPost uses them when it calls the network.

::: warning MCP authority
Use `mcp:read` for read-only work. An `mcp:full` token can make changes when the MCP client allows them. Limit it to one workspace, require approval for `execute_operation`, and remove it when the tool no longer needs access.
:::

## Steps

| Stage     | Agent task                                                                   | Human task                                                                 |
| --------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Inspect   | Read the workspace, platform list, accounts, media, drafts, and setup state. | Confirm the workspace and accounts.                                        |
| Prepare   | Draft one shared message and an account version for each account.            | Check facts, tone, links, media rights, and alt text.                      |
| Check     | Check the post and suggest times.                                            | Choose the accounts, format, and time.                                     |
| Approve   | Show the exact change and wait.                                              | Review it in the web app, then approve the exact `execute_operation` call. |
| Follow up | Read post status and events.                                                 | Fix errors and save the real post links.                                   |

A person should review the work. OpenPost does not add a separate server approval step before every allowed change.

## 1. Limit access

Connect through the remote MCP endpoint or the local `openpost-mcp` proxy as shown in [Agent-Assisted Publishing With MCP](/mcp/). Start with an `mcp:read` token limited to the current workspace. Grant `mcp:full` only when the tool must create or change data.

Do not paste social account keys into the prompt. The MCP client needs an OpenPost token, not X, Meta, LinkedIn, Bluesky, Mastodon, TikTok, or Google keys.

## 2. Start with read-only inspection

Ask the tool to use `search_operations` to find the current inputs. It should use `query_operation` for reads and report:

- the workspace ID and intended accounts;
- each platform's setup result;
- relevant media and its accessibility text;
- existing drafts that may overlap;
- candidate posting slots;
- any platform or format that still needs a live test.

App settings, a working OAuth start, or finished code do not prove that a real account and format can publish today. Use the [Launch Verification Matrix](/providers/launch-matrix).

## 3. Prepare a shared post and account versions

Keep the shared message factual and broad enough for each platform. Then tailor it by account:

- shorten and front-load the point for X;
- add context and a clear professional takeaway for LinkedIn;
- use a compact thread when Bluesky needs more room;
- include self-hosting and federation-relevant detail for Mastodon;
- use a more casual account version for Threads after that exact live test works.

Do not paste the same text into every account. Keep the facts and call to action, but change the structure, length, links, and media when needed.

## 4. Review in OpenPost

Before approval, inspect every account in the composer:

1. Confirm the account and platform.
2. Read the account version on its own.
3. Check character, thread, media-count, and format limits.
4. Verify links, mentions, hashtags, titles, descriptions, and alt text.
5. Remove platforms that are not set up or tested for that format.
6. Confirm the workspace timezone and scheduled time.
7. Save edits before you approve the change.

## 5. Approve the exact change

The tool should show the operation name, workspace, account IDs, media IDs, format, and time before it calls `execute_operation`. Approve that exact change, not all future posts from the tool.

## 6. Record outcomes, not intentions

A saved draft only proves that OpenPost saved it. A scheduled state only proves that OpenPost accepted the time. Neither proves that the social network published it.

After OpenPost runs the post, save the result for each account:

- published URL and platform post ID;
- failure message and retry state;
- verification date, account, and format;
- any manual edit made after the agent's draft.

Use the [OpenPost Launch Kit](https://github.com/rodrgds/openpost/tree/main/launch-kit) for a reusable brief, sample prompt, five account versions, a review list, and a result template.

## Managed app access

Managed plans start at $15 per month and include a card-required 14-day trial. OpenPost shows the renewal price and date before you start. An active or trialing plan is required to connect accounts, upload media, schedule, or publish.
