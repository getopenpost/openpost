ALTER TABLE users ADD COLUMN totp_secret_encrypted BLOB;
ALTER TABLE users ADD COLUMN totp_enabled_at DATETIME;
ALTER TABLE users ADD COLUMN passkey_enabled_at DATETIME;

CREATE TABLE IF NOT EXISTS user_passkeys (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	name TEXT NOT NULL,
	credential_id BLOB NOT NULL UNIQUE,
	credential_json TEXT NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_used_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON user_passkeys(user_id);

CREATE TABLE IF NOT EXISTS auth_challenges (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	type TEXT NOT NULL,
	payload TEXT NOT NULL,
	expires_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_user_id ON auth_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at ON auth_challenges(expires_at);
