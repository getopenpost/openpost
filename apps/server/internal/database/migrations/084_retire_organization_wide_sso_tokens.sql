UPDATE organization_sso_policies
SET api_token_mode = 'scoped'
WHERE api_token_mode = 'allow';
