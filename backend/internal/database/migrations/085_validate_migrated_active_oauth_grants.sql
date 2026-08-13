UPDATE oauth_grants
SET validation_status = 'valid',
    validated_at = created_at,
    updated_at = current_timestamp
WHERE validation_status = 'legacy_unverified'
  AND revoked_at IS NULL
  AND length(access_token_encrypted) > 0
  AND EXISTS (
      SELECT 1
      FROM social_accounts
      WHERE social_accounts.oauth_grant_id = oauth_grants.id
        AND social_accounts.workspace_id = oauth_grants.workspace_id
        AND social_accounts.platform = oauth_grants.provider
        AND social_accounts.is_active = TRUE
  );
