# Invitation delivery callbacks

This page is for operators integrating an email provider's delivery callbacks.

OpenPost separates email provider acceptance from confirmed delivery. A
successful delivery job marks a Workspace invitation **Sent**. It means the
provider accepted the request. It does not prove delivery. A verified callback
can later mark that exact delivery **Delivered** or **Delivery failed**.

Set `OPENPOST_EMAIL_DELIVERY_WEBHOOK_SECRET` and send callbacks to
`POST /api/v1/email/delivery/webhook`. Sign the exact request body with
HMAC-SHA256 and send the lowercase hexadecimal digest as
`OpenPost-Signature: v1=<digest>`.

```json
{
  "event_id": "provider-event-unique-id",
  "invitation_id": "OpenPost invitation ID",
  "delivery_id": "OpenPost email delivery job ID",
  "outcome": "delivered",
  "occurred_at": "2026-08-14T12:01:00Z"
}
```

`outcome` is `delivered` or `failed`. `event_id` must be stable across provider
retries. OpenPost records only these identifiers, the outcome, and timestamps.
It does not store the callback body, recipient address, provider response, or
invitation secret in callback evidence.

Duplicate event IDs return success without applying the event again. OpenPost
ignores callbacks for an older resend generation, an accepted or revoked
invitation, or an outcome older than the current callback state. Unknown
invitation IDs also return a successful ignored result so the endpoint does not
become an invitation lookup surface.
