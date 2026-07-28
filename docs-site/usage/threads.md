# Threads

Threads let you publish multi-post sequences in order.

## How they work

- Each child post references its place in the chain.
- OpenPost publishes sequentially rather than firing every item at once.
- Provider behavior differs underneath the same OpenPost concept.

## Caveats

- LinkedIn child posts are implemented as comment-style replies at the provider layer, but the current synced web composer blocks LinkedIn thread publishing. Unsync LinkedIn for that thread or remove the LinkedIn destination before publishing from the web UI.
- Failures in early posts can block later posts in the same thread.
