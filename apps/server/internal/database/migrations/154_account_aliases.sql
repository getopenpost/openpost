-- Internal labels never replace provider usernames or publishing identities.
ALTER TABLE social_accounts ADD COLUMN alias TEXT NOT NULL DEFAULT '';
