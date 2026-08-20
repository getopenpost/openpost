package account_saver

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

var slugUnsafeChars = regexp.MustCompile(`[^a-z0-9]+`)

// AccountSaver handles saving social account information to the database.
// This service extracts the duplicated account-saving logic from the OAuth handler.
type AccountSaver struct {
	db          *bun.DB
	crypto      *crypto.TokenEncryptor
	entitlement entitlements.Service
}

type SaveAccountInput struct {
	Actor                 workspaceaccess.ActorFacts
	UserID                string
	PlatformName          string
	WorkspaceID           string
	AccountID             string
	AccountUsername       string
	AccountAvatarURL      string
	InstanceURL           string
	Token                 *platform.TokenResult
	CapabilityState       map[string]string
	Grant                 AuthorizationGrantInput
	FirstConnectionOrigin string
}

type AuthorizationGrantInput struct {
	ProviderProjectID string
	ProviderSubject   string
	ExecutionMode     string
	Evidence          map[string]string
	ConsentedAt       time.Time
	ValidatedAt       time.Time
}

type preparedGrant struct {
	grant      *models.OAuthGrant
	isExisting bool
}

// NewAccountSaver creates a new AccountSaver instance.
func NewAccountSaver(db *bun.DB, crypto *crypto.TokenEncryptor, entitlement ...entitlements.Service) *AccountSaver {
	entitlementService := entitlements.Service(entitlements.NewSelfHostedService())
	if len(entitlement) > 0 && entitlement[0] != nil {
		entitlementService = entitlement[0]
	}
	return &AccountSaver{
		db:          db,
		crypto:      crypto,
		entitlement: entitlementService,
	}
}

func (s *AccountSaver) SetEntitlement(entitlement entitlements.Service) {
	if entitlement != nil {
		s.entitlement = entitlement
	}
}

// SaveAccount saves a social account with encrypted tokens.
// It handles the common logic of extracting account info, encrypting tokens,
// and inserting into the social_accounts table.
//
//nolint:gocyclo
func (s *AccountSaver) SaveAccount(ctx context.Context, actor workspaceaccess.ActorFacts, platformName, workspaceID, accountID, accountUsername, instanceURL string, tokenResp *platform.TokenResult) (*models.SocialAccount, error) {
	return s.SaveAccountFromInput(ctx, SaveAccountInput{
		Actor:           actor,
		UserID:          actor.UserID,
		PlatformName:    platformName,
		WorkspaceID:     workspaceID,
		AccountID:       accountID,
		AccountUsername: accountUsername,
		InstanceURL:     instanceURL,
		Token:           tokenResp,
	})
}

func (s *AccountSaver) SaveAccountFromInput(ctx context.Context, input SaveAccountInput) (*models.SocialAccount, error) {
	accounts, err := s.SaveAccountsFromInputs(ctx, []SaveAccountInput{input})
	if err != nil {
		return nil, err
	}
	return accounts[0], nil
}

// SaveAccountsFromInputs validates quota once and saves every selected
// identity in one transaction. Reconnecting a provider identity updates and
// reactivates its existing row so publications keep a stable account foreign
// key. This is also used when one OAuth grant connects several Pages or
// organizations.
//
//nolint:gocyclo // Validation, grant grouping, slug allocation, and writes share one transaction boundary.
func (s *AccountSaver) SaveAccountsFromInputs(ctx context.Context, inputs []SaveAccountInput) ([]*models.SocialAccount, error) {
	if len(inputs) == 0 {
		return nil, fmt.Errorf("at least one account is required")
	}
	first := inputs[0]
	if err := s.validateSaveAccountInput(ctx, first); err != nil {
		return nil, err
	}
	for _, input := range inputs {
		if input.UserID != first.UserID || input.WorkspaceID != first.WorkspaceID {
			return nil, fmt.Errorf("selected accounts must belong to the same user and workspace")
		}
		if input.Token == nil {
			return nil, fmt.Errorf("token response is required")
		}
	}

	normalizedInputs := append([]SaveAccountInput(nil), inputs...)
	existingAccounts := make([]*models.SocialAccount, len(normalizedInputs))
	seenIdentities := make(map[string]struct{}, len(normalizedInputs))
	var quotaAmount int64
	for index := range normalizedInputs {
		normalizedInputs[index].AccountID = accountIDFromToken(normalizedInputs[index].AccountID, normalizedInputs[index].Token)
		identity := accountIdentityKey(normalizedInputs[index])
		if _, exists := seenIdentities[identity]; exists {
			return nil, fmt.Errorf("the same provider account was selected more than once")
		}
		seenIdentities[identity] = struct{}{}

		existing, err := s.findExistingAccount(ctx, normalizedInputs[index])
		if err != nil {
			return nil, err
		}
		existingAccounts[index] = existing
		if existing == nil || !existing.IsActive {
			quotaAmount++
		}
	}
	if quotaAmount > 0 {
		if err := s.checkSocialAccountQuota(ctx, first.UserID, first.WorkspaceID, quotaAmount); err != nil {
			return nil, err
		}
	}

	var activeAccounts []models.SocialAccount
	if err := s.db.NewSelect().
		Model(&activeAccounts).
		Column("id", "slug").
		Where("workspace_id = ?", first.WorkspaceID).
		Where("is_active = ?", true).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("loading account slugs: %w", err)
	}
	usedSlugs := make(map[string]string, len(activeAccounts)+len(normalizedInputs))
	for _, account := range activeAccounts {
		usedSlugs[account.Slug] = account.ID
	}

	now := time.Now().UTC()
	preparedGrants, grantIndexes, err := s.prepareGrants(ctx, normalizedInputs, existingAccounts, now)
	if err != nil {
		return nil, err
	}

	accounts := make([]*models.SocialAccount, 0, len(normalizedInputs))
	isExisting := make([]bool, 0, len(normalizedInputs))
	for index, input := range normalizedInputs {
		capabilityState, capabilityCheckedAt, err := encodeCapabilityState(input.CapabilityState)
		if err != nil {
			return nil, err
		}

		existing := existingAccounts[index]
		account := &models.SocialAccount{}
		if existing != nil {
			*account = *existing
		} else {
			account.ID = uuid.New().String()
			account.CreatedAt = now
		}

		baseSlug := defaultSlug(input.PlatformName, input.AccountUsername, input.AccountID, input.InstanceURL)
		if existing == nil || (usedSlugs[account.Slug] != "" && usedSlugs[account.Slug] != account.ID) {
			account.Slug = nextAvailableOwnedSlug(baseSlug, usedSlugs)
		}
		usedSlugs[account.Slug] = account.ID

		account.WorkspaceID = input.WorkspaceID
		account.Platform = input.PlatformName
		account.AccountID = input.AccountID
		account.AccountUsername = input.AccountUsername
		account.AccountAvatarURL = input.AccountAvatarURL
		account.InstanceURL = input.InstanceURL
		account.OAuthGrantID = preparedGrants[grantIndexes[index]].grant.ID
		account.AccessTokenEnc = []byte{}
		account.RefreshTokenEnc = []byte{}
		account.TokenExpiresAt = time.Time{}
		// Keep this non-secret mirror while account capability queries are moved
		// to grant joins. The credential and expiry have no account-row copy.
		account.GrantedScopes = grantedScopesFromToken(input.Token)
		account.CapabilityState = capabilityState
		account.CapabilityCheckedAt = capabilityCheckedAt
		account.IsActive = true
		account.ErrorMessage = ""

		accounts = append(accounts, account)
		isExisting = append(isExisting, existing != nil)
	}

	if err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, prepared := range preparedGrants {
			if err := persistAuthorizationGrant(txCtx, tx, prepared); err != nil {
				return err
			}
		}
		for index, account := range accounts {
			if !isExisting[index] {
				if _, err := tx.NewInsert().Model(account).Exec(txCtx); err != nil {
					return err
				}
				continue
			}
			if _, err := tx.NewUpdate().
				Model(account).
				Column(
					"workspace_id", "slug", "platform", "account_id", "account_username",
					"account_avatar_url", "instance_url", "oauth_grant_id", "access_token_encrypted",
					"refresh_token_encrypted", "token_expires_at", "granted_scopes",
					"capability_state_json", "capability_checked_at", "is_active", "error_message",
				).
				WherePK().
				Exec(txCtx); err != nil {
				return err
			}
		}
		claim := &models.WorkspaceFirstConnection{
			WorkspaceID: first.WorkspaceID,
			AccountID:   accounts[0].ID,
			OriginKey:   first.FirstConnectionOrigin,
			CreatedAt:   now,
		}
		result, err := tx.NewInsert().Model(claim).On("CONFLICT (workspace_id) DO NOTHING").Exec(txCtx)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		accounts[0].ClaimedFirst = rows == 1
		if !accounts[0].ClaimedFirst && first.FirstConnectionOrigin != "" {
			var stored models.WorkspaceFirstConnection
			if err := tx.NewSelect().Model(&stored).Where("workspace_id = ?", first.WorkspaceID).Scan(txCtx); err != nil {
				return err
			}
			accounts[0].ClaimedFirst = stored.OriginKey == first.FirstConnectionOrigin
		}
		return nil
	}); err != nil {
		return nil, err
	}

	for _, prepared := range preparedGrants {
		if err := tokenmanager.ScheduleGrantRefreshJob(ctx, s.db, prepared.grant.ID, prepared.grant.AccessTokenExpiresAt); err != nil {
			log.Printf("[AccountSaver] Failed to schedule refresh job for grant %s: %v", prepared.grant.ID, err)
		}
	}

	return accounts, nil
}

func (s *AccountSaver) prepareGrants(
	ctx context.Context,
	inputs []SaveAccountInput,
	existingAccounts []*models.SocialAccount,
	now time.Time,
) ([]preparedGrant, []int, error) {
	type grantGroup struct {
		indexes []int
	}
	groups := make([]grantGroup, 0, len(inputs))
	groupByKey := make(map[string]int, len(inputs))
	grantIndexes := make([]int, len(inputs))
	for index := range inputs {
		key, err := authorizationGrantKey(inputs[index])
		if err != nil {
			return nil, nil, err
		}
		groupIndex, ok := groupByKey[key]
		if !ok {
			groupIndex = len(groups)
			groupByKey[key] = groupIndex
			groups = append(groups, grantGroup{})
		}
		groups[groupIndex].indexes = append(groups[groupIndex].indexes, index)
		grantIndexes[index] = groupIndex
	}

	claimedExisting := map[string]struct{}{}
	prepared := make([]preparedGrant, 0, len(groups))
	for _, group := range groups {
		firstIndex := group.indexes[0]
		input := inputs[firstIndex]
		encAccess, encRefresh, err := s.encryptAccountTokens(input.Token)
		if err != nil {
			return nil, nil, err
		}
		metadata, evidenceJSON, err := normalizedAuthorizationGrant(input, now)
		if err != nil {
			return nil, nil, err
		}
		grant := &models.OAuthGrant{
			ID:                    uuid.NewString(),
			WorkspaceID:           input.WorkspaceID,
			Provider:              input.PlatformName,
			ProviderProjectID:     metadata.ProviderProjectID,
			ProviderSubject:       metadata.ProviderSubject,
			InstanceURL:           input.InstanceURL,
			AccessTokenEnc:        encAccess,
			RefreshTokenEnc:       encRefresh,
			AccessTokenExpiresAt:  tokenExpiresAtFrom(now, input.Token.ExpiresIn),
			RefreshTokenExpiresAt: tokenExpiresAtFrom(now, input.Token.RefreshExpiresIn),
			GrantedScopes:         grantedScopesFromToken(input.Token),
			TokenType:             input.Token.TokenType,
			TokenVersion:          1,
			ExecutionMode:         metadata.ExecutionMode,
			AuthorizationEvidence: evidenceJSON,
			ConsentedByID:         input.UserID,
			ConsentedAt:           metadata.ConsentedAt,
			ValidatedAt:           metadata.ValidatedAt,
			ValidationStatus:      "valid",
			CreatedAt:             now,
			UpdatedAt:             now,
		}

		reuseID := commonExistingGrantID(group.indexes, existingAccounts)
		if reuseID != "" {
			if _, claimed := claimedExisting[reuseID]; !claimed {
				var existingGrant models.OAuthGrant
				err := s.db.NewSelect().Model(&existingGrant).
					Where("id = ? AND workspace_id = ? AND provider = ?", reuseID, input.WorkspaceID, input.PlatformName).
					Where("provider_project_id = ? AND provider_subject = ?", metadata.ProviderProjectID, metadata.ProviderSubject).
					Where("instance_url = ? AND execution_mode = ?", input.InstanceURL, metadata.ExecutionMode).
					Where("revoked_at IS NULL").
					Scan(ctx)
				if err == nil {
					grant.ID = existingGrant.ID
					grant.TokenVersion = existingGrant.TokenVersion
					grant.CreatedAt = existingGrant.CreatedAt
					if len(grant.RefreshTokenEnc) == 0 {
						grant.RefreshTokenEnc = existingGrant.RefreshTokenEnc
						grant.RefreshTokenExpiresAt = existingGrant.RefreshTokenExpiresAt
					}
					claimedExisting[reuseID] = struct{}{}
					prepared = append(prepared, preparedGrant{grant: grant, isExisting: true})
					continue
				}
				if !errors.Is(err, sql.ErrNoRows) {
					return nil, nil, fmt.Errorf("loading existing oauth grant: %w", err)
				}
			}
		}
		prepared = append(prepared, preparedGrant{grant: grant})
	}
	return prepared, grantIndexes, nil
}

func commonExistingGrantID(indexes []int, accounts []*models.SocialAccount) string {
	grantID := ""
	for _, index := range indexes {
		account := accounts[index]
		if account == nil || account.OAuthGrantID == "" {
			continue
		}
		if grantID == "" {
			grantID = account.OAuthGrantID
			continue
		}
		if grantID != account.OAuthGrantID {
			return ""
		}
	}
	return grantID
}

func authorizationGrantKey(input SaveAccountInput) (string, error) {
	metadata, _, err := normalizedAuthorizationGrant(input, time.Time{})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal([]string{
		input.WorkspaceID,
		input.PlatformName,
		input.InstanceURL,
		metadata.ProviderProjectID,
		metadata.ProviderSubject,
		metadata.ExecutionMode,
		input.Token.AccessToken,
		input.Token.RefreshToken,
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", sha256.Sum256(payload)), nil
}

func normalizedAuthorizationGrant(input SaveAccountInput, now time.Time) (AuthorizationGrantInput, string, error) {
	metadata := input.Grant
	metadata.ProviderProjectID = strings.TrimSpace(metadata.ProviderProjectID)
	if metadata.ProviderProjectID == "" {
		metadata.ProviderProjectID = input.PlatformName
		if input.InstanceURL != "" {
			metadata.ProviderProjectID += ":" + input.InstanceURL
		}
	}
	metadata.ProviderSubject = strings.TrimSpace(metadata.ProviderSubject)
	if metadata.ProviderSubject == "" {
		metadata.ProviderSubject = firstNonEmptyTokenExtra(input.Token.Extra, "_grant_subject", "user_id", "open_id", "sub")
	}
	if metadata.ProviderSubject == "" {
		metadata.ProviderSubject = input.AccountID
	}
	metadata.ExecutionMode = strings.TrimSpace(metadata.ExecutionMode)
	if metadata.ExecutionMode == "" {
		metadata.ExecutionMode = defaultExecutionMode(input.PlatformName)
	}
	if metadata.ConsentedAt.IsZero() && !now.IsZero() {
		metadata.ConsentedAt = now
	}
	if metadata.ValidatedAt.IsZero() && !now.IsZero() {
		metadata.ValidatedAt = now
	}
	evidence := make(map[string]string, len(metadata.Evidence)+1)
	for key, value := range metadata.Evidence {
		if key = strings.TrimSpace(key); key != "" && strings.TrimSpace(value) != "" {
			evidence[key] = strings.TrimSpace(value)
		}
	}
	if _, ok := evidence["source"]; !ok {
		evidence["source"] = "account_connection"
	}
	encoded, err := json.Marshal(evidence)
	if err != nil {
		return AuthorizationGrantInput{}, "", fmt.Errorf("encoding authorization evidence: %w", err)
	}
	return metadata, string(encoded), nil
}

func defaultExecutionMode(provider string) string {
	switch provider {
	case "x":
		return "oauth1"
	case "bluesky":
		return "app_password"
	case "discord":
		return "webhook"
	default:
		return "oauth2"
	}
}

func persistAuthorizationGrant(ctx context.Context, tx bun.Tx, prepared preparedGrant) error {
	if !prepared.isExisting {
		_, err := tx.NewInsert().Model(prepared.grant).Exec(ctx)
		return err
	}
	grant := prepared.grant
	result, err := tx.NewUpdate().Model((*models.OAuthGrant)(nil)).
		Set("provider_project_id = ?", grant.ProviderProjectID).
		Set("provider_subject = ?", grant.ProviderSubject).
		Set("instance_url = ?", grant.InstanceURL).
		Set("access_token_encrypted = ?", grant.AccessTokenEnc).
		Set("refresh_token_encrypted = ?", grant.RefreshTokenEnc).
		Set("access_token_expires_at = ?", grant.AccessTokenExpiresAt).
		Set("refresh_token_expires_at = ?", grant.RefreshTokenExpiresAt).
		Set("granted_scopes = ?", grant.GrantedScopes).
		Set("token_type = ?", grant.TokenType).
		Set("token_version = token_version + 1").
		Set("execution_mode = ?", grant.ExecutionMode).
		Set("authorization_evidence_json = ?", grant.AuthorizationEvidence).
		Set("consented_by_id = ?", grant.ConsentedByID).
		Set("consented_at = ?", grant.ConsentedAt).
		Set("validated_at = ?", grant.ValidatedAt).
		Set("validation_status = ?", grant.ValidationStatus).
		Set("refresh_lease_owner = ''").
		Set("refresh_lease_expires_at = NULL").
		Set("last_refresh_error = ''").
		Set("updated_at = ?", grant.UpdatedAt).
		Where("id = ? AND token_version = ? AND revoked_at IS NULL", grant.ID, grant.TokenVersion).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return fmt.Errorf("oauth grant %s changed during account connection", grant.ID)
	}
	grant.TokenVersion++
	return nil
}

func (s *AccountSaver) findExistingAccount(ctx context.Context, input SaveAccountInput) (*models.SocialAccount, error) {
	query := s.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", input.WorkspaceID).
		Where("platform = ?", input.PlatformName).
		Where("account_id = ?", input.AccountID).
		Order("is_active DESC", "created_at DESC").
		Limit(1)
	if input.PlatformName == "mastodon" {
		query = query.Where("instance_url = ?", input.InstanceURL)
	}
	var account models.SocialAccount
	if err := query.Scan(ctx, &account); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("loading existing provider account: %w", err)
	}
	return &account, nil
}

func accountIdentityKey(input SaveAccountInput) string {
	key := input.PlatformName + "\x00" + input.AccountID
	if input.PlatformName == "mastodon" {
		key += "\x00" + input.InstanceURL
	}
	return key
}

func encodeCapabilityState(state map[string]string) (string, time.Time, error) {
	if len(state) == 0 {
		return "{}", time.Time{}, nil
	}
	if _, ok := state["messages_enabled"]; ok {
		filtered := make(map[string]string, len(state))
		for k, v := range state {
			if k == "messages_enabled" {
				continue
			}
			filtered[k] = v
		}
		state = filtered
		if len(state) == 0 {
			return "{}", time.Time{}, nil
		}
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("encoding account capability state: %w", err)
	}
	return string(encoded), time.Now().UTC(), nil
}

func (s *AccountSaver) validateSaveAccountInput(ctx context.Context, input SaveAccountInput) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("database not initialized")
	}
	if input.UserID == "" {
		return fmt.Errorf("user id is required")
	}
	if input.Actor.UserID == "" || input.Actor.UserID != input.UserID {
		return fmt.Errorf("authenticated actor is required")
	}
	if input.WorkspaceID == "" {
		return fmt.Errorf("workspace id is required")
	}
	if input.Token == nil {
		return fmt.Errorf("token response is required")
	}

	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, input.WorkspaceID, input.Actor, workspaceaccess.LevelEdit)
	if err != nil {
		return fmt.Errorf("validating workspace access: %w", err)
	}
	if !decision.Allowed {
		return fmt.Errorf("workspace not accessible")
	}
	return nil
}

func (s *AccountSaver) encryptAccountTokens(token *platform.TokenResult) ([]byte, []byte, error) {
	if s.crypto == nil {
		return nil, nil, fmt.Errorf("token encryptor is not configured")
	}
	if token == nil || strings.TrimSpace(token.AccessToken) == "" {
		return nil, nil, fmt.Errorf("access token is required")
	}
	encAccess, err := s.crypto.Encrypt(token.AccessToken)
	if err != nil {
		return nil, nil, err
	}

	var encRefresh []byte
	if token.RefreshToken != "" {
		encRefresh, err = s.crypto.Encrypt(token.RefreshToken)
		if err != nil {
			return nil, nil, err
		}
	}
	return encAccess, encRefresh, nil
}

func accountIDFromToken(fallback string, token *platform.TokenResult) string {
	// LinkedIn selection stores the complete author URN. The shared member
	// token may also carry a person user_id, which must not replace an
	// organization identity.
	if strings.HasPrefix(strings.TrimSpace(fallback), "urn:li:") {
		return fallback
	}
	if token.Extra == nil {
		return fallback
	}
	if uid, ok := token.Extra["user_id"]; ok && uid != "" {
		return uid
	}
	return fallback
}

func tokenExpiresAtFrom(now time.Time, expiresIn int) time.Time {
	if expiresIn <= 0 {
		return time.Time{}
	}
	return now.Add(time.Duration(expiresIn) * time.Second)
}

func grantedScopesFromToken(token *platform.TokenResult) string {
	if token == nil || token.Extra == nil {
		return ""
	}
	raw := strings.TrimSpace(firstNonEmptyTokenExtra(token.Extra, "scope", "scopes"))
	if raw == "" {
		return ""
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t'
	})
	seen := map[string]struct{}{}
	scopes := make([]string, 0, len(parts))
	for _, part := range parts {
		scope := strings.TrimSpace(part)
		if scope == "" {
			continue
		}
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		scopes = append(scopes, scope)
	}
	sort.Strings(scopes)
	return strings.Join(scopes, " ")
}

func firstNonEmptyTokenExtra(extra map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(extra[key]); value != "" {
			return value
		}
	}
	return ""
}

func (s *AccountSaver) CheckSocialAccountQuota(ctx context.Context, userID, workspaceID string) error {
	return s.checkSocialAccountQuota(ctx, userID, workspaceID, 1)
}

func (s *AccountSaver) checkSocialAccountQuota(ctx context.Context, userID, workspaceID string, amount int64) error {
	current, err := s.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Count(ctx)
	if err != nil {
		return fmt.Errorf("loading social account usage: %w", err)
	}

	decision, err := s.entitlement.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Limit:       entitlements.LimitSocialAccounts,
		Current:     int64(current),
		Amount:      amount,
	})
	if err != nil {
		return fmt.Errorf("checking social account limit: %w", err)
	}
	if !decision.Allowed {
		if decision.Reason != "" {
			return fmt.Errorf("%s", decision.Reason)
		}
		return fmt.Errorf("social account limit exceeded")
	}
	return nil
}

func nextAvailableOwnedSlug(base string, used map[string]string) string {
	if base == "" {
		base = "account"
	}
	for i := 0; ; i++ {
		candidate := base
		if i > 0 {
			candidate = fmt.Sprintf("%s-%d", base, i+1)
		}
		if _, exists := used[candidate]; !exists {
			return candidate
		}
	}
}

func defaultSlug(platformName, accountUsername, accountID, instanceURL string) string {
	label := strings.TrimSpace(accountUsername)
	if label == "" {
		label = strings.TrimSpace(accountID)
	}
	if label == "" {
		label = strings.TrimSpace(instanceURL)
	}
	base := strings.Trim(strings.ToLower(platformName+"-"+label), "-")
	base = slugUnsafeChars.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if len(base) > 63 {
		base = strings.Trim(base[:63], "-")
	}
	if base == "" {
		return strings.ToLower(platformName)
	}
	return base
}
