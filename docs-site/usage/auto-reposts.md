# Auto Reposts

This page is for people configuring native same-network repost rules after publication.

Auto repost rules let a connected account use its network's native repost action after one of your posts publishes. OpenPost supports native reposts on X, Mastodon, Bluesky, and LinkedIn. The source and target must be on the same network. OpenPost does not copy the post to a different network.

## Create a workspace rule

Open **Settings → Workspace → Reposts**, then select **Add rule**. A rule contains:

- source accounts whose published posts can trigger the rule; leaving the list on **Any compatible source account** covers every supported account in the workspace;
- one or more target accounts that should repost;
- one or more repost stages, each scheduled at a cumulative delay from the original publish time;
- an optional **Remove previous repost first** action on later stages, which removes the preceding native repost before creating the next one;
- an evaluation window after which OpenPost stops waiting;
- optional minimum likes, comments, reposts, and views;
- **Require all** or **Require any** when more than one minimum is set;
- an optional stable-growth check that waits for the stored engagement totals to remain unchanged for several checks.

Save the page to activate the rules. Disabled rules remain saved but do not create candidates for newly published posts.

## How engagement gates work

The worker reads the latest saved publication analytics. Opening Settings or the composer does not call a social network.

A minimum of `0` disables that metric. A provider-reported zero is a real value. A missing metric is not treated as zero and cannot pass an enabled gate. This distinction prevents a post from being reposted merely because its network does not report the selected number.

At each stage's delay, OpenPost checks the same engagement gates again. If the gates have not passed, it keeps checking until the evaluation window ends. Restarting the server does not lose the current stage or its history. Each native repost write runs once; an ambiguous network timeout is recorded as failed instead of being retried and risking a duplicate action. Safe removal retries use persisted backoff and stop at the evaluation deadline.

Stage delays are measured from the original publication time, not from the preceding repost. Later stages must therefore use a larger delay than earlier stages. When **Remove previous repost first** is enabled, OpenPost records the successful removal before it attempts the next repost, so a worker restart cannot repeat a completed removal.

Each attempt counts toward the workspace's monthly provider-write limit. If that limit is reached, OpenPost skips the repost and records the reason without calling the network.

## Override one post

Open **Repost settings** in the publication composer.

- **Use workspace rules** applies every matching enabled rule.
- **Do not repost** disables automation for that post.
- **Custom** replaces workspace rules with the target accounts, timing, and engagement gates selected in the composer.

The override is part of the saved publication, so it survives draft edits, scheduling, OpenPost Image Editor round trips, and restarts.

## Use an account from another workspace

Workspace admins can select a target account from another workspace they also administer. Saving creates a scoped repost grant. The account token stays encrypted under its owning workspace and is never copied into the source workspace.

Admins of the target workspace can revoke the grant from **Settings → Workspace → Reposts**. Revocation stops future reposts through that account. It does not remove reposts already published on the network.
