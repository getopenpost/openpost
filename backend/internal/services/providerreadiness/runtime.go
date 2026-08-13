package providerreadiness

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/providerpolicy"
)

type RuntimeApp struct {
	Config              platform.AppConfig
	Source              ConfigurationSource
	ProviderEnvironment ProviderEnvironment
}

type RuntimeConfiguration struct {
	Provider            string
	AppFingerprint      string
	InstanceFingerprint string
	ProviderEnvironment ProviderEnvironment
	Evidence            ConfigurationEvidence
}

type ConfigurationCatalog struct {
	mu   sync.RWMutex
	apps map[string]RuntimeConfiguration
}

func NewConfigurationCatalog(layers ...[]RuntimeApp) (*ConfigurationCatalog, error) {
	catalog := &ConfigurationCatalog{apps: make(map[string]RuntimeConfiguration)}
	for _, layer := range layers {
		for _, app := range layer {
			if err := catalog.Register(app); err != nil {
				return nil, err
			}
		}
	}
	return catalog, nil
}

func RuntimeApps(configs []platform.AppConfig, source ConfigurationSource, environment ProviderEnvironment) []RuntimeApp {
	result := make([]RuntimeApp, 0, len(configs))
	for _, config := range configs {
		result = append(result, RuntimeApp{Config: config, Source: source, ProviderEnvironment: environment})
	}
	return result
}

func OperatorRuntimeApps(configs []platform.AppConfig, environment ProviderEnvironment) []RuntimeApp {
	result := RuntimeApps(configs, ConfigurationSourceEnvironment, environment)
	for index := range result {
		config := platform.NormalizeAppConfig(result[index].Config)
		if (config.Provider == capabilities.ProviderBluesky || config.Provider == capabilities.ProviderDiscord) && config.ClientID == "" {
			result[index].Source = ConfigurationSourceBuiltIn
		}
	}
	return result
}

func (c *ConfigurationCatalog) Register(app RuntimeApp) error {
	if c == nil {
		return errors.New("provider configuration catalog is unavailable")
	}
	config := platform.NormalizeAppConfig(app.Config)
	if !providerPattern.MatchString(config.Provider) || !validConfigurationSource(app.Source) ||
		!validProviderEnvironment(app.ProviderEnvironment) {
		return errors.New("runtime provider app configuration is invalid")
	}
	fingerprint, err := AppFingerprint(config)
	if err != nil {
		return err
	}
	instanceFingerprint, err := InstanceFingerprint(config.InstanceURL)
	if err != nil {
		return err
	}
	resolved := RuntimeConfiguration{
		Provider:            config.Provider,
		AppFingerprint:      fingerprint,
		InstanceFingerprint: instanceFingerprint,
		ProviderEnvironment: app.ProviderEnvironment,
		Evidence: ConfigurationEvidence{
			State:          ConfigurationStateConfigured,
			Source:         app.Source,
			AppFingerprint: fingerprint,
		},
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.apps[platform.AppConfigMergeKey(config)] = resolved
	return nil
}

func (c *ConfigurationCatalog) Resolve(provider, instanceURL string, environment ProviderEnvironment) RuntimeConfiguration {
	provider = strings.ToLower(strings.TrimSpace(provider))
	instanceURL = strings.TrimRight(strings.TrimSpace(instanceURL), "/")
	key := provider
	if provider == capabilities.ProviderMastodon {
		key += ":" + instanceURL
	}
	if c != nil {
		c.mu.RLock()
		configured, ok := c.apps[key]
		c.mu.RUnlock()
		if ok {
			return configured
		}
	}
	instanceFingerprint, _ := InstanceFingerprint(instanceURL)
	return RuntimeConfiguration{
		Provider:            provider,
		AppFingerprint:      missingAppFingerprint(provider, instanceFingerprint),
		InstanceFingerprint: instanceFingerprint,
		ProviderEnvironment: environment,
		Evidence:            ConfigurationEvidence{State: ConfigurationStateMissing, Source: ConfigurationSourceUnknown},
	}
}

// ContainsSubject reports whether the exact non-secret provider-app identity
// represented by a certification subject is still present in the effective
// runtime configuration. It deliberately compares fingerprints rather than
// accepting a provider name or adapter registration as configuration proof.
func (c *ConfigurationCatalog) ContainsSubject(subject Subject) bool {
	if c == nil {
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, configured := range c.apps {
		if configured.Provider == subject.Provider &&
			configured.AppFingerprint == subject.AppFingerprint &&
			configured.InstanceFingerprint == subject.InstanceFingerprint &&
			configured.ProviderEnvironment == subject.ProviderEnvironment {
			return true
		}
	}
	return false
}

// AppFingerprint binds certification to the provider app identity and callback
// contract without storing or hashing the client secret. Secret rotation does
// not change provider approval or capability semantics.
func AppFingerprint(config platform.AppConfig) (string, error) {
	config = platform.NormalizeAppConfig(config)
	if !providerPattern.MatchString(config.Provider) {
		return "", errors.New("provider app is invalid")
	}
	return digestJSON(struct {
		Provider    string `json:"provider"`
		ClientID    string `json:"client_id"`
		RedirectURI string `json:"redirect_uri"`
		InstanceURL string `json:"instance_url"`
	}{
		Provider:    config.Provider,
		ClientID:    config.ClientID,
		RedirectURI: config.RedirectURI,
		InstanceURL: config.InstanceURL,
	})
}

func InstanceFingerprint(instanceURL string) (string, error) {
	instanceURL = strings.TrimRight(strings.TrimSpace(instanceURL), "/")
	if instanceURL == "" {
		return "", nil
	}
	return digestJSON(instanceURL)
}

// AccountReferenceHash binds live certification to the exact internal account
// used for the test without storing the provider account ID, username, or
// workspace identity in the certification ledger.
func AccountReferenceHash(account models.SocialAccount) (string, error) {
	if strings.TrimSpace(account.ID) == "" || strings.TrimSpace(account.WorkspaceID) == "" ||
		!providerPattern.MatchString(strings.TrimSpace(account.Platform)) {
		return "", errors.New("provider certification account reference is invalid")
	}
	return digestJSON(struct {
		SchemaVersion int    `json:"schema_version"`
		WorkspaceID   string `json:"workspace_id"`
		AccountID     string `json:"account_id"`
		Provider      string `json:"provider"`
	}{
		SchemaVersion: 1,
		WorkspaceID:   strings.TrimSpace(account.WorkspaceID),
		AccountID:     strings.TrimSpace(account.ID),
		Provider:      strings.TrimSpace(account.Platform),
	})
}

func missingAppFingerprint(provider, instanceFingerprint string) string {
	digest, _ := digestJSON(struct {
		Missing             bool   `json:"missing"`
		Provider            string `json:"provider"`
		InstanceFingerprint string `json:"instance_fingerprint"`
	}{Missing: true, Provider: provider, InstanceFingerprint: instanceFingerprint})
	return digest
}

func digestJSON(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func PublicationContract(
	capability capabilities.Capability,
	operation Operation,
	enforceCertification bool,
	accountKind string,
	policyMode string,
) (CertificationContract, error) {
	if operation != OperationPublishImmediate && operation != OperationPublishScheduled {
		return CertificationContract{}, errors.New("publication readiness operation is invalid")
	}
	capabilityDigest, err := digestJSON(capability)
	if err != nil {
		return CertificationContract{}, err
	}
	accountKind = normalizedPolicyToken(accountKind, "standard")
	policyMode = normalizedPolicyToken(policyMode, capability.Provider+".unspecified")
	subject := Subject{
		Provider: capability.Provider, AccountKind: accountKind,
		OutputProfile: capability.OutputProfile, Operation: operation, PolicyMode: policyMode,
	}
	scopes := RequiredScopesForSubject(subject)
	policyDigest, err := policyDigest(capability.Provider, capability.OutputProfile, operation, policyMode, scopes)
	if err != nil {
		return CertificationContract{}, err
	}
	requirements := Requirements{
		RequireConfiguration:         true,
		RequireProductionDeployment:  enforceCertification,
		RequireProductionProviderApp: enforceCertification,
		RequireApproval:              enforceCertification,
		RequireAuthorization:         true,
		RequireLocalEvidence:         enforceCertification,
		RequireLiveEvidence:          enforceCertification,
		AllowTrialExecution:          enforceCertification,
	}
	if enforceCertification {
		requirements.RequiredScopes = scopes
		checks := publicationCheckRequirements(operation)
		requirements.RequiredLocalChecks = append([]CheckRequirement(nil), checks...)
		requirements.RequiredLiveChecks = append([]CheckRequirement(nil), checks...)
	}
	return CertificationContract{
		SchemaVersion:    CertificationContractSchemaVersion,
		CapabilityDigest: capabilityDigest,
		PolicyDigest:     policyDigest,
		Requirements:     requirements,
	}, nil
}

func ConnectionContract(provider string, enforceCertification bool) (CertificationContract, error) {
	provider = strings.TrimSpace(provider)
	capabilityDigest, err := digestJSON(struct {
		SchemaVersion int    `json:"schema_version"`
		Provider      string `json:"provider"`
		Operation     string `json:"operation"`
	}{SchemaVersion: 1, Provider: provider, Operation: string(OperationConnect)})
	if err != nil {
		return CertificationContract{}, err
	}
	policyDigest, err := policyDigest(provider, "connect", OperationConnect, "default", nil)
	if err != nil {
		return CertificationContract{}, err
	}
	return CertificationContract{
		SchemaVersion:    CertificationContractSchemaVersion,
		CapabilityDigest: capabilityDigest,
		PolicyDigest:     policyDigest,
		Requirements: Requirements{
			RequireConfiguration:         true,
			RequireProductionDeployment:  enforceCertification,
			RequireProductionProviderApp: enforceCertification,
			RequireApproval:              enforceCertification,
			AllowTrialExecution:          enforceCertification,
		},
	}, nil
}

// PublicationPolicyMode normalizes provider policy dimensions that can change
// approval, scope, or delivery semantics. Scheduling remains represented by
// Operation and never enters this value.
func PublicationPolicyMode(
	account models.SocialAccount,
	capability capabilities.Capability,
	settings map[string]any,
) string {
	return providerpolicy.Mode(account, capability, settings)
}

func normalizedPolicyToken(value, fallback string) string {
	return providerpolicy.NormalizeToken(value, fallback)
}

// RequiredScopesForSubject binds authorization evidence to account kind,
// output, operation, and provider policy rather than a provider-wide union.
func RequiredScopesForSubject(subject Subject) []string {
	if !subject.Operation.IsPublish() {
		return nil
	}
	switch subject.Provider {
	case capabilities.ProviderFacebook:
		return []string{"pages_manage_posts", "pages_read_engagement"}
	case capabilities.ProviderInstagram:
		return []string{"instagram_basic", "instagram_content_publish"}
	case capabilities.ProviderYouTube:
		return []string{"https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.upload"}
	case capabilities.ProviderTikTok:
		if strings.HasPrefix(subject.PolicyMode, "tiktok.upload") {
			return []string{"user.info.basic", "video.upload"}
		}
		return []string{"user.info.basic", "video.publish"}
	case capabilities.ProviderLinkedIn:
		if subject.AccountKind == "organization" {
			return []string{"w_organization_social"}
		}
		return []string{"w_member_social"}
	case capabilities.ProviderThreads:
		return []string{"threads_basic", "threads_content_publish"}
	default:
		return nil
	}
}

func AuthorizationForAccount(account models.SocialAccount, grant *models.OAuthGrant, now time.Time) AuthorizationEvidence {
	grantedScopes := splitScopeSet(account.GrantedScopes)
	if !account.IsActive {
		return AuthorizationEvidence{
			State:         AuthorizationStateReconnectRequired,
			GrantedScopes: grantedScopes,
			ReasonCode:    "account_inactive",
		}
	}
	if grant == nil || grant.ID == "" || grant.ValidationStatus != "valid" || !grant.RevokedAt.IsZero() || grant.ValidatedAt.IsZero() {
		return AuthorizationEvidence{
			State:         AuthorizationStateReconnectRequired,
			GrantedScopes: grantedScopes,
			ReasonCode:    "grant_unverified",
		}
	}
	grantedScopes = splitScopeSet(grant.GrantedScopes)
	expiresAt := grant.AccessTokenExpiresAt
	if len(grant.RefreshTokenEnc) > 0 {
		expiresAt = grant.RefreshTokenExpiresAt
	}
	state := AuthorizationStateValid
	reason := ""
	if !expiresAt.IsZero() && !expiresAt.After(now) {
		state = AuthorizationStateReconnectRequired
		reason = "grant_expired"
	}
	return AuthorizationEvidence{
		State:         state,
		GrantedScopes: grantedScopes,
		ValidatedAt:   grant.ValidatedAt,
		ExpiresAt:     expiresAt,
		ReasonCode:    reason,
	}
}

func AccountKind(account models.SocialAccount) string {
	return providerpolicy.AccountKind(account)
}

func splitScopeSet(raw string) []string {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t'
	})
	seen := make(map[string]struct{}, len(fields))
	result := make([]string, 0, len(fields))
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		if _, duplicate := seen[field]; duplicate {
			continue
		}
		seen[field] = struct{}{}
		result = append(result, field)
	}
	slices.Sort(result)
	return result
}

func publicationCheckRequirements(operation Operation) []CheckRequirement {
	checks := []CheckRequirement{
		{Kind: CheckConnect},
		{Kind: CheckAuthorization},
		{Kind: CheckFinalResult},
		{Kind: CheckRefresh, AllowNotApplicable: true},
		{Kind: CheckRevoke, AllowNotApplicable: true},
	}
	if operation == OperationPublishScheduled {
		checks = append(checks, CheckRequirement{Kind: CheckPublishScheduled})
	} else {
		checks = append(checks, CheckRequirement{Kind: CheckPublishImmediate})
	}
	return checks
}

func policyDigest(provider, outputProfile string, operation Operation, policyMode string, scopes []string) (string, error) {
	return digestJSON(struct {
		SchemaVersion  int       `json:"schema_version"`
		PolicyRevision string    `json:"policy_revision"`
		Provider       string    `json:"provider"`
		OutputProfile  string    `json:"output_profile"`
		Operation      Operation `json:"operation"`
		PolicyMode     string    `json:"policy_mode"`
		RequiredScopes []string  `json:"required_scopes"`
	}{
		SchemaVersion:  1,
		PolicyRevision: "2026-08-09.1",
		Provider:       provider,
		OutputProfile:  outputProfile,
		Operation:      operation,
		PolicyMode:     policyMode,
		RequiredScopes: append([]string(nil), scopes...),
	})
}
