# Data-encryption key rotation

OpenPost encrypts persisted credentials and protected runtime state with
`OPENPOST_ENCRYPTION_KEY`. New keyring writes carry an authenticated version and
key ID. Readers accept the current key, configured previous keys, and legacy
unversioned ciphertext.

Do not replace the key in one step. Keep a verified backup and the previous key
until the rotation command completes successfully.

## Configuration

- `OPENPOST_ENCRYPTION_KEY` is the current primary key.
- `OPENPOST_ENCRYPTION_KEY_ID` is its non-secret stable ID. Leaving it unset
  preserves legacy writes during the first rollback-compatible reader rollout.
- `OPENPOST_ENCRYPTION_PREVIOUS_KEYS` is a JSON object from key ID to previous
  key. Use `OPENPOST_ENCRYPTION_PREVIOUS_KEYS_FILE` in production.
- `OPENPOST_MEDIA_SIGNING_KEY` signs short-lived media URLs. Use its file-backed
  form and keep it stable while rotating the data-encryption key. When unset it
  falls back to `OPENPOST_ENCRYPTION_KEY` for compatibility.

Key IDs may contain letters, numbers, periods, underscores, and hyphens. Never
put key material on the command line or in logs. If a configured key ID,
previous-key, or media-signing `*_FILE` is unreadable or empty, OpenPost refuses
to start instead of falling back to another key.

## Cutover

1. Take and restore-test a current off-host backup.
2. Pin `OPENPOST_MEDIA_SIGNING_KEY` to bytes equal to the old
   `OPENPOST_ENCRYPTION_KEY`. This preserves every URL that was already signed.
   Moving to distinct signing bytes can invalidate existing URLs for up to 15
   minutes, so make that a separate change and wait out the full window.
3. Deploy the keyring-capable binary to every web and worker process with
   `OPENPOST_ENCRYPTION_KEY_ID` still unset. This phase keeps legacy writes and
   can roll back to a pre-keyring binary.
4. After every process runs the new reader, assign the old primary a key ID and
   configure the future key as a previous key. Deploy again. This explicitly
   begins versioned writes, so a pre-keyring binary is no longer a safe rollback.
5. Flip `OPENPOST_ENCRYPTION_KEY` and `OPENPOST_ENCRYPTION_KEY_ID` to the new
   primary. Keep the old key in `OPENPOST_ENCRYPTION_PREVIOUS_KEYS` throughout
   the rollout so old-primary and new-primary processes can read both.
6. Stop every web and worker writer, then wait at least the full 10-minute X
   OAuth request lifetime. Run `openpost rotate-encryption-key` with the same
   database and keyring configuration. The command deletes expired X OAuth
   requests in bounded batches, refuses to continue if any request-secret row
   remains, rewrites bounded 100-row compare-and-swap batches, and then performs
   a full authenticated current-key verification pass.
7. Run the command a second time. It must report zero rotated ciphertexts and a
   successful verification count. If either run fails, retain every previous
   key, fix the reported store, and rerun. Partial completed batches are safe and
   idempotent.
8. Keep every writer stopped. Remove the old key from the maintenance command's
   `OPENPOST_ENCRYPTION_PREVIOUS_KEYS`, then run
   `openpost rotate-encryption-key` once more as a current-only verification.
9. Apply the verified current-only keyring to every role and restart web and
   worker processes only after step 8 succeeds.

The command covers every maintained encrypted model column plus the encrypted
TOTP setup secret in `auth_challenges.payload` and invitation acceptance URL in
`jobs.payload`. It preserves unknown JSON fields and reports only aggregate
counts and store names, never keys, plaintext, or ciphertext.

X OAuth 1.0 request secrets stay in the existing `request_secret` column to
preserve schema compatibility with the previous release. Legacy-write mode
stores the raw value. Explicit keyring mode stores a prefixed encrypted value
and can still consume an in-flight raw value from the first rollout phase.
These one-time requests are valid for at most 10 minutes and are not part of
the ciphertext rewrite. The rotation command deletes them only after they
expire and reports an aggregate deletion count without exposing their values.
