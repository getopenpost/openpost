### Fixed

- Bluesky direct messages no longer bring in empty messages: entries that `chat.bsky.convo.getMessages` returns for a message the account deleted for itself (`deletedMessageView`) or for a group event such as a member joining (`systemMessageView`) are skipped instead of being stored as blank inbound messages that raise the unread count and send a new-message notification.
