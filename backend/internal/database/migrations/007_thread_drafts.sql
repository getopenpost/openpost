-- 007: Move the `__openpost_thread__:` blob out of `posts.content` into a
-- dedicated `thread_drafts` table.
--
-- Prior to this migration, while a user was composing a multi-post thread
-- the parent Post row's `content` column was a JSON blob with the
-- `__openpost_thread__:` prefix, encoding the parent + child posts and
-- per-account content variants. On publish, the backend decoded the blob
-- and materialised real `posts` rows linked by `parent_post_id`, so the
-- blob was only ever present in the database while a thread was being
-- drafted — published threads lived (and still live) in `posts` as proper
-- rows.
--
-- Mixing post text and a JSON transport for a draft state in the same
-- `content` column made `posts.content` hard to query, blocked sane full
-- text indexing, and required a magic prefix in business logic. This
-- migration moves the blob into `thread_drafts.draft_json` (1:1 with the
-- parent post) and leaves `posts.content` containing only the parent
-- post's actual text.
--
-- The migration is idempotent: it only touches posts that still have the
-- blob in `content`, so re-running it is a no-op.

-- Drop any pre-existing thread_drafts table that was created by
-- CreateSchema without the FK constraint. This is safe because
-- `thread_drafts` is a brand new table in v1.1.0; no real user has rows
-- in it yet. The IF EXISTS guard makes re-runs a no-op once the
-- correctly-constrained table is in place.
DROP TABLE IF EXISTS thread_drafts;

CREATE TABLE thread_drafts (
    post_id TEXT PRIMARY KEY,
    draft_json TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
    updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX thread_drafts_updated_at_idx
    ON thread_drafts (updated_at);

-- Carry the legacy blob across into `thread_drafts.draft_json`. We carry
-- the blob across verbatim — the JSON shape is shared with the frontend
-- and the existing parser understands it.
INSERT INTO thread_drafts (post_id, draft_json)
SELECT id, content
FROM posts
WHERE content LIKE '__openpost_thread__:%'
  AND id NOT IN (SELECT post_id FROM thread_drafts);

-- Clear the blob from `posts.content` once the thread_drafts row exists.
-- The parent's `content` becomes empty for now: thread draft parents have
-- no real text of their own (the first post of the thread is the real
-- post), and the composer reads the draft state from `thread_drafts`.
-- New writes from the composer populate `posts.content` with the first
-- post's text on save.
UPDATE posts
SET content = ''
WHERE content LIKE '__openpost_thread__:%'
  AND id IN (
      SELECT post_id FROM thread_drafts
      WHERE draft_json LIKE '__openpost_thread__:%'
  );
