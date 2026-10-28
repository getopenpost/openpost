### Fixed

- Collected direct messages that were stored without content keep their text and attachments once the provider describes them again, instead of staying blank because the remote message already existed. Only blank, not deleted messages change, and a repair does not notify.
- Threads mentions keep their activity time. Graph and Threads return offsets without a colon (`2026-10-24T10:00:00+0000`), and provider timestamps now share one parser that accepts every layout the providers send.
