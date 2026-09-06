-- 088: Make a provider subdestination a first-class rendition identity.

ALTER TABLE renditions ADD COLUMN target_key TEXT NOT NULL DEFAULT '';

UPDATE renditions
SET target_key = CASE
  WHEN platform = 'mastodon' THEN 'mastodon:' || COALESCE(
    (SELECT instance_url FROM social_accounts WHERE social_accounts.id = renditions.social_account_id),
    ''
  )
  ELSE platform
END
WHERE target_key = '';

DROP INDEX IF EXISTS renditions_publication_account_idx;

CREATE UNIQUE INDEX renditions_publication_account_target_idx
  ON renditions (publication_id, social_account_id, target_key);

CREATE INDEX renditions_account_target_status_idx
  ON renditions (social_account_id, target_key, status);
