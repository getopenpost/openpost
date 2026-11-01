# Calm UX

OpenPost serves solo founders and creators who do not want to waste time. Small teams and agencies must still work. The product should feel calm, approachable, and delightful. This contract supersedes older visual guidance where they conflict.

## Principles

1. Each screen answers one question. Lead with the answer, not the mechanism.
2. One filled accent action per screen. Everything else is outline or ghost.
3. Say things once. A sentence that repeats the title, a label, or the state goes.
4. A notice appears only when the reader can act on it. Explanation belongs in a tooltip, a help link, or the empty state. Keep functional warnings, recovery controls, provider limits, and inspectable status. Calm is not hiding truth.
5. Nothing is unexplained. A disabled control says why. An empty state offers the next action.
6. Unmeasured is not zero. Show `-` for unmeasured values and state coverage once.

## Visual system

- Default theme: `calm` in `packages/ui/src/lib/themes/builtins/calm.ts`. Saved organization and Workspace themes keep precedence.
- Type: Manrope. `text-sm` (14px) for controls and body; `text-xs` is 13px and the minimum outside editors. Editors set `data-density="editor"` and keep 12px. Never use arbitrary sizes under 13px outside editors.
- Sentence case. No uppercase tracking labels.
- Separate regions with spacing and one soft border, never nested cards. Cards are for groups that act as one object.
- Solid fills for charts and buttons. Dither appears only in brand moments such as onboarding completion, never on controls or data.
- Motion is short and purposeful: 160ms to 240ms ease-out, respecting reduced motion, no idle animation.
- Touch targets stay 44px on coarse pointers. Keep visible focus in both schemes.

## Shared grammar

- `PageContainer`: title equals the navigation label. `description` only when it reports state. Default to none.
- One tab idiom: underline `Tabs` for peer views. Use a segmented view switch only for two or three representations of the same data, such as List and Calendar. Tabs never clip; phones scroll them or use a select.
- Filters: one row, with search and a single filter popover. Do not stack navigation, filter, and sort rows.
- `InlineNotice`: error and warning that need action. Success goes through toast. Info rarely.
- `EmptyState`: one short title, at most one line of help, and an action when one exists.
- Rows: one line, title first, status as a quiet badge, metadata in muted text. Hide zero counts.

## Navigation

Desktop: logo, workspace switcher, notifications, New post. Then Home, Posts, Inbox, Analytics. Then Ideas, Studio, Media, Automations. Footer: Accounts, Settings, profile.

Phone: Home, Posts, New, Inbox, More, all labelled. More owns Analytics, Ideas, Studio, Media, Automations, Accounts, Settings, Workspace, and Profile.

Find people lives under Inbox. Reposts lives under Automations. Posting schedule lives with the queue. Editors, Templates, Voice profiles, and Prompts live in Studio.

`/` stays the composer URL. App entry at `/` without parameters follows the device landing preference: Home by default, New post for writing-first users, who also get Drafts in the sidebar. Every composer entry goes through `ui.startNewPost()`.

## Surfaces

- **Home**: what is going out, what needs you (failed posts, replies, approvals, disconnected accounts), how it is going in one sentence, and quick actions. Setup checklist lives here until complete. Ends with a closure line such as "You're covered until Thursday."
- **Onboarding**: one question about how the person works, connect one account inline, write the first post. Keep the draft through connection. No plan card, no feedback box.
- **Composer**: spacious canvas, live preview beside it on wide screens by default, one primary action. Disabled actions explain themselves.
- **Posts**: one header row, single-line rows, about ten per screen, no zero counters.
- **Inbox**: title Inbox, Unread default, search plus one filter popover, All, Comments, Messages, Reviews.
- **Analytics**: one sentence, three tiles that switch the chart, one coverage line, dashes for unmeasured.
- **Settings**: left rail. You, Workspace, Plan, Advanced. Organization and Instance scopes stay under Advanced and appear only for people who can use them. Branding merges into one page. Accounts is its own destination.
