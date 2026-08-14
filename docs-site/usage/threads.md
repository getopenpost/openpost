# Threads

This page is for people creating ordered multi-post sequences.

Threads let you publish multi-post sequences in order.

## How they work

- Each reply keeps its place in the thread.
- OpenPost publishes one part at a time, in order.
- Each social network receives replies in the form its API requires.

## Caveats

- LinkedIn sends thread parts after the first one as comments. An operator can turn this off with `LINKEDIN_DISABLE_THREAD_REPLIES`. When it is off, OpenPost marks the account as unable to publish a thread.
- Failures in early posts can block later posts in the same thread.
