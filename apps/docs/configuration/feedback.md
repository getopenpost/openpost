# User Feedback

This page is for operators configuring feedback delivery, diagnostics, and privacy limits.

OpenPost can show authenticated users a report form for bugs, ideas, and questions. It is disabled by default and has no hardcoded destination.

## Configure a destination

Set all three values and restart OpenPost:

```sh
OPENPOST_FEEDBACK_ENABLED=true
OPENPOST_FEEDBACK_DESTINATION_URL_FILE=/run/secrets/openpost-feedback-webhook
OPENPOST_FEEDBACK_RECIPIENT="Example operator"
```

`OPENPOST_FEEDBACK_DESTINATION_URL` must be an HTTPS Discord-compatible webhook. The first implementation supports that destination format only. The URL stays on the server. `OPENPOST_FEEDBACK_RECIPIENT` is the exact name users see before sending.

Hosted OpenPost uses the same configuration. A self-hosted instance does not send reports to the OpenPost maintainers unless its operator explicitly configures such a destination and names that recipient.

Set `OPENPOST_FEEDBACK_SUPPORT_URL` to an HTTPS issue or support page. When delivery is disabled, the app shows this link instead of a dead form. Its query string and fragment are removed before display.

## What the user controls

The message is required. Screenshot and diagnostics are off by default and independent:

- A screenshot is captured only after the user enables it. The user sees it and can remove it.
- Diagnostics show their categories and exact JSON before send.
- Closing the form sends nothing.

A saved response means OpenPost saved the report and will send it in the background. It does not mean the receiving service has it yet. OpenPost retries a failed webhook up to the job limit.

## Privacy limits

Diagnostics may contain:

- OpenPost version and current route path;
- the Svelte route template when known;
- viewport and browser family/version;
- up to 10 recent route paths;
- up to 15 failed OpenPost API requests with method, path, status, duration, and time;
- up to 10 client errors reduced to coarse messages.

Diagnostics never include cookies, headers, tokens, OAuth codes, request or response bodies, post text, uploaded files, arbitrary page state, full browser user-agent strings, local paths, private hosts, or query values. The browser sanitizes the report first and the server repeats validation before queueing and again before delivery.

Screenshots omit the feedback dialog, form controls, cross-origin images, and elements marked with `data-feedback-redact` or `data-feedback-ignore`. They use a pixel ratio of 1, are capped at 1600 by 1200 in the browser, and must pass the server's MIME, dimension, pixel, and 1 MiB encoded-image limits. A report body is capped at 2 MiB. Screenshot failure leaves the text report usable.

Normal logs contain job and destination failure status, not report diagnostics or provider response bodies.

## Current decisions

- Feedback is available only to authenticated users and is limited to five submissions per user per minute. The fixed window is stored in the database, so a restart or a second hosted app instance does not reset the limit.
- The destination is server-configured; there is no browser-to-webhook path and no maintainer endpoint.
- Queued delivery and failed attempts remain visible through the existing jobs administration surface. Normal logs do not contain the report body or diagnostics.
- A post retry uses the same saved job. You can retry one failed account or all failed accounts without posting again to accounts that worked.
