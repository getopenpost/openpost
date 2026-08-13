package providerreadiness

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strings"
)

const CertificationContractSchemaVersion = 1

type canonicalContract struct {
	SchemaVersion                int                `json:"schema_version"`
	CapabilityDigest             string             `json:"capability_digest"`
	PolicyDigest                 string             `json:"policy_digest"`
	RequireConfiguration         bool               `json:"require_configuration"`
	RequireProductionDeployment  bool               `json:"require_production_deployment"`
	RequireProductionProviderApp bool               `json:"require_production_provider_app"`
	RequireExactRevision         bool               `json:"require_exact_revision"`
	RequireApproval              bool               `json:"require_approval"`
	RequireAuthorization         bool               `json:"require_authorization"`
	RequireLocalEvidence         bool               `json:"require_local_evidence"`
	RequireLiveEvidence          bool               `json:"require_live_evidence"`
	AllowTrialExecution          bool               `json:"allow_trial_execution"`
	RequiredScopes               []string           `json:"required_scopes"`
	RequiredLocalChecks          []CheckRequirement `json:"required_local_checks"`
	RequiredLiveChecks           []CheckRequirement `json:"required_live_checks"`
}

// Digest returns the stable certification-contract digest. Slice order does
// not affect it, so equivalent scope and check sets cannot invalidate evidence
// accidentally. Unknown or malformed contracts fail closed.
func (contract CertificationContract) Digest() (string, error) {
	if contract.SchemaVersion != CertificationContractSchemaVersion {
		return "", errors.New("unsupported certification contract schema")
	}
	if !digestPattern.MatchString(contract.CapabilityDigest) || !digestPattern.MatchString(contract.PolicyDigest) {
		return "", errors.New("certification contract source digest is invalid")
	}
	if !validRequirements(contract.Requirements) {
		return "", errors.New("certification contract requirements are invalid")
	}

	requirements := contract.Requirements
	scopes := make([]string, len(requirements.RequiredScopes))
	localChecks := make([]CheckRequirement, len(requirements.RequiredLocalChecks))
	liveChecks := make([]CheckRequirement, len(requirements.RequiredLiveChecks))
	copy(scopes, requirements.RequiredScopes)
	copy(localChecks, requirements.RequiredLocalChecks)
	copy(liveChecks, requirements.RequiredLiveChecks)
	slices.Sort(scopes)
	slices.SortFunc(localChecks, compareCheckRequirements)
	slices.SortFunc(liveChecks, compareCheckRequirements)

	canonical := canonicalContract{
		SchemaVersion:                contract.SchemaVersion,
		CapabilityDigest:             contract.CapabilityDigest,
		PolicyDigest:                 contract.PolicyDigest,
		RequireConfiguration:         requirements.RequireConfiguration,
		RequireProductionDeployment:  requirements.RequireProductionDeployment,
		RequireProductionProviderApp: requirements.RequireProductionProviderApp,
		RequireExactRevision:         requirements.RequireExactRevision,
		RequireApproval:              requirements.RequireApproval,
		RequireAuthorization:         requirements.RequireAuthorization,
		RequireLocalEvidence:         requirements.RequireLocalEvidence,
		RequireLiveEvidence:          requirements.RequireLiveEvidence,
		AllowTrialExecution:          requirements.AllowTrialExecution,
		RequiredScopes:               scopes,
		RequiredLocalChecks:          localChecks,
		RequiredLiveChecks:           liveChecks,
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func compareCheckRequirements(left, right CheckRequirement) int {
	return strings.Compare(string(left.Kind), string(right.Kind))
}
