---
version: 1
slug: 'src-routes-checkout-page-svelte'
primary_target: 'src/routes/checkout/+page.svelte'
related_targets: []
---

# Checkout

- Scope and mode: standalone `/checkout` route in Operate mode.
- Audience and job: an authenticated workspace owner selects a hosted plan, reviews the exact trial terms, and enters payment details without losing trust or context.
- Primary task: complete Paddle's hosted one-page checkout directly in the page; plan and billing-period changes refresh the same payment surface.
- Content and proof: localized Paddle prices, selected plan limits, the 14-day card-required trial, exact first-charge date, cancellation terms, and Merchant of Record disclosure.
- Direction: a calm two-part workbench with a compact plan rail and one dominant secure payment surface. It inherits OpenPost's warm neutral tokens and restrained orange signal.
- Memorable moment: payment is already ready in the page. There is no second continue action, nested modal, or full-screen interruption.
- Constraints: keep Paddle's fields and compliance footer intact, use a contrast-safe light payment canvas in both app themes, preserve 312px iframe width at 320px, and retain success, confirmation, loading, and error recovery states.
