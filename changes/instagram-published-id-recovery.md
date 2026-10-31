### Fixed

- When Instagram accepts a post but the publish response is lost, resuming the destination now recovers the published post's ID by matching the account's recent published media against the authored caption and media type. Post links and analytics work again instead of recording an accepted post with no external ID; ambiguous or empty-caption cases keep the previous behavior rather than guessing.
