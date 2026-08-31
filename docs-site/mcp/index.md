# Use OpenPost With an AI Assistant

MCP lets AI tools work with your OpenPost account. An assistant can read your drafts, prepare posts, and schedule approved work. It never receives the keys for your social accounts.

::: warning Choose what the assistant can do
Use `mcp:read` when an assistant only needs to view data. OpenPost blocks all changes made with this token. Use `mcp:full` when an assistant needs to create, change, schedule, or publish posts. Limit the token to one workspace when you can. Check every account and approve each publish action.
:::

Use it when you want an assistant to:

- View workspaces, accounts, media, drafts, and scheduled posts
- Turn an idea into a draft
- Write a separate version for each account
- Add saved media or upload media from a public link
- Find the next open posting time
- Schedule approved posts or cancel scheduled posts

## Ways to connect

### ChatGPT-style clients

Use the remote MCP endpoint from your OpenPost instance:

```txt
https://your-openpost-host.example/mcp
```

OAuth-aware clients can use OpenPost's browser account-linking flow. Clients that need a manual token can create `mcp:read` or `mcp:full` access from **Settings → Personal → Developer access**. OAuth requests default to `mcp:full` when they omit a scope, so choose `mcp:read` explicitly for inspection-only connections.

When you approve OAuth or create a token, limit it to the current workspace unless the client needs access to all your workspaces.

### Desktop MCP clients

Install and authenticate the OpenPost CLI with the MCP proxy, then run the local stdio proxy:

```sh
curl -fsSL https://raw.githubusercontent.com/getopenpost/openpost/main/scripts/install-cli.sh | sh -s -- --with-mcp
openpost --profile local auth login https://your-openpost-host.example
openpost-mcp --profile local
```

The proxy uses the selected CLI profile to connect to the remote `/mcp` address. It does not open the database or need social account keys on your computer.

## Available tools

OpenPost gives the assistant a small set of tools. The assistant can then look up the exact action it needs.

An `mcp:read` connection gets three tools:

- `search_operations` finds actions that only view data.
- `query_operation` runs an action that only views data.
- `render_scheduler_widget` shows a schedule in clients that support it.

An `mcp:full` connection also gets `execute_operation`, which can change OpenPost or contact a social network.

`search_operations` tells the assistant whether it must use `query_operation` or `execute_operation`. It returns nothing when the request is unclear or OpenPost cannot do it. OpenPost also checks the tool choice: `query_operation` cannot make changes, and `execute_operation` cannot run view-only actions.

These tools cover workspaces, social networks, accounts, media, drafts, account versions, all post types, checks, schedules, publishing, status, cancellation, activity, comments, and open posting times. You can ask for what you want in plain language.

## Safe steps

1. Start with an `mcp:read` token limited to one workspace. Ask the assistant to check the workspace, accounts, recent media, and account setup.
2. If the assistant must create or change work, use an `mcp:full` token limited to that workspace. Test each account and post type before you rely on it.
3. Open the post in the web app. Check the text, account versions, media, alt text, post type, and time.
4. Approve `execute_operation` only when the content and accounts are correct.
5. Check Activity after publishing. A scheduled post has not yet been published.

OpenPost checks workspace access and account ownership before it reads or changes data. Schedules and media uploads use the same plan limits as the web app and CLI.

For a sample brief, prompt, account versions, test log, and review list, see the public [OpenPost Launch Kit](https://github.com/getopenpost/openpost/tree/main/launch-kit). These are examples, not proof of a live publish.

## What OpenPost protects

| Area                | What OpenPost does                                                                          | What you must do                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Social account keys | Encrypts access and refresh tokens and never returns them through MCP.                      | Protect your OpenPost encryption key, database, backups, and server.                     |
| Workspace access    | Lets you limit a token to one workspace and checks account ownership.                       | Grant access to the smallest useful workspace. Remove access when the work ends.         |
| View or change      | Blocks changes with `mcp:read`. Checks that the client uses the right tool with `mcp:full`. | Start with `mcp:read`. Approve each `execute_operation` call after you grant `mcp:full`. |
| Post checks         | Checks current media rules, account support, and plan limits.                               | Test the exact account and post type. Social networks can still change or reject a post. |
| Your review         | Keeps drafts and account versions in the web app so you can edit them.                      | Review the work before you approve it. OpenPost does not force this step.                |

## View use or remove access

Recent MCP actions appear in **Settings → Personal → Developer access** when the client uses its own MCP or CLI token. Remove the token there to disconnect the client.

For protocol details, Apps SDK metadata, OAuth discovery, and implementation notes, see [MCP And ChatGPT App](/development/mcp) in the developer docs.
