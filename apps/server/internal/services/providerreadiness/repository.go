package providerreadiness

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

var ErrLedgerFactNotFound = errors.New("provider readiness ledger fact not found")

type Ledger interface {
	LatestApprovalReview(context.Context, Subject) (*ApprovalReview, error)
	ApprovalReviewByID(context.Context, string) (*ApprovalReview, error)
	LatestCertification(context.Context, Subject, EvidenceKind, string) (*CertificationEvidence, error)
	EffectiveRuntimeControl(context.Context, Subject, time.Time) (RuntimeControl, error)
	AppendApprovalReview(context.Context, ApprovalReview) error
	AppendCertification(context.Context, string, CertificationEvidence) error
	AppendRuntimeControl(context.Context, RuntimeControlEvent) error
}

// AuthorizationSource resolves the canonical provider grant attached to an
// account. It is intentionally separate from Ledger so pure evaluation tests
// can use a fact-only ledger while runtime callers share one authorization
// boundary.
type AuthorizationSource interface {
	AuthorizationForAccount(context.Context, models.SocialAccount, time.Time) (AuthorizationEvidence, error)
}

type Repository struct {
	db bun.IDB
}

func NewRepository(db bun.IDB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) AuthorizationForAccount(
	ctx context.Context,
	account models.SocialAccount,
	now time.Time,
) (AuthorizationEvidence, error) {
	if r == nil || r.db == nil {
		return AuthorizationEvidence{}, errors.New("provider readiness repository is unavailable")
	}
	if strings.TrimSpace(account.OAuthGrantID) == "" {
		return AuthorizationForAccount(account, nil, now), nil
	}
	var grant models.OAuthGrant
	err := r.db.NewSelect().Model(&grant).
		Where("id = ?", account.OAuthGrantID).
		Where("workspace_id = ?", account.WorkspaceID).
		Where("provider = ?", account.Platform).
		Where("instance_url = ?", account.InstanceURL).
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return AuthorizationForAccount(account, nil, now), nil
	}
	if err != nil {
		return AuthorizationEvidence{}, fmt.Errorf("load provider authorization: %w", err)
	}
	return AuthorizationForAccount(account, &grant, now), nil
}

func (r *Repository) LatestApprovalReview(ctx context.Context, subject Subject) (*ApprovalReview, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("provider readiness repository is unavailable")
	}
	var row models.ProviderApprovalReview
	err := r.db.NewSelect().Model(&row).
		Where("provider = ?", subject.Provider).
		Where("app_fingerprint = ?", subject.AppFingerprint).
		Where("provider_environment = ?", subject.ProviderEnvironment).
		Where("instance_fingerprint = ?", subject.InstanceFingerprint).
		OrderExpr("reviewed_at DESC, created_at DESC, id DESC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLedgerFactNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load provider approval review: %w", err)
	}
	return approvalReviewFromModel(row), nil
}

func (r *Repository) ApprovalReviewByID(ctx context.Context, id string) (*ApprovalReview, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("provider readiness repository is unavailable")
	}
	if !safeIDPattern.MatchString(strings.TrimSpace(id)) {
		return nil, errors.New("provider approval review ID is invalid")
	}
	var row models.ProviderApprovalReview
	err := r.db.NewSelect().Model(&row).Where("id = ?", strings.TrimSpace(id)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLedgerFactNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load provider approval review by ID: %w", err)
	}
	return approvalReviewFromModel(row), nil
}

func (r *Repository) LatestCertification(
	ctx context.Context,
	subject Subject,
	kind EvidenceKind,
	accountReferenceHash string,
) (*CertificationEvidence, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("provider readiness repository is unavailable")
	}
	var row models.ProviderCertificationRun
	query := r.db.NewSelect().Model(&row).
		Where("provider = ?", subject.Provider).
		Where("app_fingerprint = ?", subject.AppFingerprint).
		Where("deployment_environment = ?", subject.DeploymentEnvironment).
		Where("provider_environment = ?", subject.ProviderEnvironment).
		Where("instance_fingerprint = ?", subject.InstanceFingerprint).
		Where("account_kind = ?", subject.AccountKind).
		Where("output_profile = ?", subject.OutputProfile).
		Where("operation = ?", subject.Operation).
		Where("policy_mode = ?", subject.PolicyMode).
		Where("evidence_kind = ?", kind)
	if kind == EvidenceKindLive {
		if !digestPattern.MatchString(accountReferenceHash) {
			return nil, errors.New("live provider certification account reference is invalid")
		}
		query = query.Where("account_reference_hash = ?", accountReferenceHash)
	}
	err := query.
		OrderExpr("tested_at DESC, created_at DESC, id DESC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLedgerFactNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load provider certification: %w", err)
	}

	var checks []models.ProviderCertificationCheck
	if err := r.db.NewSelect().Model(&checks).
		Where("certification_run_id = ?", row.ID).
		OrderExpr("kind ASC, id ASC").
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load provider certification checks: %w", err)
	}
	return certificationFromModels(row, checks)
}

func (r *Repository) EffectiveRuntimeControl(ctx context.Context, subject Subject, now time.Time) (RuntimeControl, error) {
	if r == nil || r.db == nil {
		return RuntimeControl{}, errors.New("provider readiness repository is unavailable")
	}
	var rows []models.ProviderRuntimeControlEvent
	err := r.db.NewSelect().Model(&rows).
		Where("provider = ?", subject.Provider).
		Where("app_fingerprint = '' OR app_fingerprint = ?", subject.AppFingerprint).
		Where("deployment_environment = '' OR deployment_environment = ?", subject.DeploymentEnvironment).
		Where("provider_environment = '' OR provider_environment = ?", subject.ProviderEnvironment).
		Where("instance_fingerprint = '' OR instance_fingerprint = ?", subject.InstanceFingerprint).
		Where("account_kind = '' OR account_kind = ?", subject.AccountKind).
		Where("output_profile = '' OR output_profile = ?", subject.OutputProfile).
		Where("operation = '' OR operation = ?", subject.Operation).
		Where("policy_mode = '' OR policy_mode = ?", subject.PolicyMode).
		Where("starts_at <= ?", now).
		Where("expires_at IS NULL OR expires_at > ?", now).
		OrderExpr("created_at DESC, id DESC").
		Scan(ctx)
	if err != nil {
		return RuntimeControl{}, fmt.Errorf("load provider runtime controls: %w", err)
	}
	if len(rows) == 0 {
		return RuntimeControl{}, ErrLedgerFactNotFound
	}

	seenScopes := make(map[string]struct{}, len(rows))
	effective := RuntimeControl{State: RuntimeControlStateEnabled}
	found := false
	for _, row := range rows {
		key := runtimeControlScopeKey(row)
		if _, seen := seenScopes[key]; seen {
			continue
		}
		seenScopes[key] = struct{}{}
		found = true
		candidate := RuntimeControl{
			State:      RuntimeControlState(row.State),
			ReasonCode: row.ReasonCode,
			ExpiresAt:  row.ExpiresAt,
		}
		if runtimeControlSeverity(candidate.State) > runtimeControlSeverity(effective.State) {
			effective = candidate
		}
	}
	if !found {
		return RuntimeControl{}, ErrLedgerFactNotFound
	}
	return effective, nil
}

func (r *Repository) AppendApprovalReview(ctx context.Context, review ApprovalReview) error {
	if r == nil || r.db == nil {
		return errors.New("provider readiness repository is unavailable")
	}
	if err := validateApprovalReview(review); err != nil {
		return err
	}
	_, err := r.db.NewInsert().Model(&models.ProviderApprovalReview{
		ID:                  review.ID,
		Provider:            review.Provider,
		AppFingerprint:      review.AppFingerprint,
		ProviderEnvironment: string(review.ProviderEnvironment),
		InstanceFingerprint: review.InstanceFingerprint,
		ApprovalState:       string(review.Evidence.State),
		ApprovalTier:        review.Evidence.Tier,
		SourceURL:           review.Evidence.SourceURL,
		ReviewedAt:          review.Evidence.ReviewedAt,
		ExpiresAt:           review.Evidence.ExpiresAt,
		OperatorRef:         review.OperatorRef,
		CreatedAt:           review.CreatedAt,
	}).Exec(ctx)
	if err != nil {
		return fmt.Errorf("append provider approval review: %w", err)
	}
	return nil
}

func (r *Repository) AppendCertification(ctx context.Context, approvalReviewID string, evidence CertificationEvidence) error {
	if r == nil || r.db == nil {
		return errors.New("provider readiness repository is unavailable")
	}
	if !safeIDPattern.MatchString(approvalReviewID) {
		return errors.New("certification approval review ID is invalid")
	}
	if err := validateCertificationEvidenceRecord(evidence); err != nil {
		return err
	}

	requiredScopes, err := canonicalStringSetJSON(evidence.RequiredScopes)
	if err != nil {
		return err
	}
	grantedScopes, err := canonicalStringSetJSON(evidence.GrantedScopes)
	if err != nil {
		return err
	}
	row := certificationModel(approvalReviewID, evidence, requiredScopes, grantedScopes)
	return r.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var review models.ProviderApprovalReview
		if err := tx.NewSelect().Model(&review).Where("id = ?", approvalReviewID).Scan(txCtx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrLedgerFactNotFound
			}
			return fmt.Errorf("load provider certification approval review: %w", err)
		}
		if err := validateCertificationApprovalReview(review, evidence); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(&row).Exec(txCtx); err != nil {
			return fmt.Errorf("append provider certification run: %w", err)
		}
		checks := certificationCheckModels(evidence)
		for index := range checks {
			if _, err := tx.NewInsert().Model(&checks[index]).Exec(txCtx); err != nil {
				return fmt.Errorf("append provider certification check %s: %w", checks[index].Kind, err)
			}
		}
		return nil
	})
}

func validateCertificationApprovalReview(
	review models.ProviderApprovalReview,
	evidence CertificationEvidence,
) error {
	if review.Provider != evidence.Subject.Provider ||
		review.AppFingerprint != evidence.Subject.AppFingerprint ||
		review.ProviderEnvironment != string(evidence.Subject.ProviderEnvironment) ||
		review.InstanceFingerprint != evidence.Subject.InstanceFingerprint ||
		review.ApprovalState != string(evidence.ApprovalStateAtTest) ||
		review.ApprovalTier != evidence.ApprovalTierAtTest {
		return errors.New("provider certification approval review does not match the evidence subject")
	}
	if evidence.TestedAt.Before(review.ReviewedAt) || !evidence.TestedAt.Before(review.ExpiresAt) ||
		evidence.ExpiresAt.After(review.ExpiresAt) {
		return errors.New("provider certification evidence is outside the approval review window")
	}
	return nil
}

func (r *Repository) AppendRuntimeControl(ctx context.Context, event RuntimeControlEvent) error {
	if r == nil || r.db == nil {
		return errors.New("provider readiness repository is unavailable")
	}
	if err := validateRuntimeControlEvent(event); err != nil {
		return err
	}
	_, err := r.db.NewInsert().Model(&models.ProviderRuntimeControlEvent{
		ID:                    event.ID,
		Provider:              event.Selector.Provider,
		AppFingerprint:        event.Selector.AppFingerprint,
		DeploymentEnvironment: string(event.Selector.DeploymentEnvironment),
		ProviderEnvironment:   string(event.Selector.ProviderEnvironment),
		InstanceFingerprint:   event.Selector.InstanceFingerprint,
		AccountKind:           event.Selector.AccountKind,
		OutputProfile:         event.Selector.OutputProfile,
		Operation:             string(event.Selector.Operation),
		PolicyMode:            event.Selector.PolicyMode,
		State:                 string(event.Control.State),
		ReasonCode:            event.Control.ReasonCode,
		StartsAt:              event.StartsAt,
		ExpiresAt:             event.Control.ExpiresAt,
		OperatorRef:           event.OperatorRef,
		CreatedAt:             event.CreatedAt,
	}).Exec(ctx)
	if err != nil {
		return fmt.Errorf("append provider runtime control: %w", err)
	}
	return nil
}

func SubjectDigest(subject Subject) (string, error) {
	if !validSubject(subject) {
		return "", errors.New("provider readiness subject is invalid")
	}
	values := []string{
		subject.Provider,
		subject.AppFingerprint,
		string(subject.DeploymentEnvironment),
		string(subject.ProviderEnvironment),
		subject.InstanceFingerprint,
		subject.AccountKind,
		subject.OutputProfile,
		string(subject.Operation),
		subject.PolicyMode,
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func approvalReviewFromModel(row models.ProviderApprovalReview) *ApprovalReview {
	return &ApprovalReview{
		ID:                  row.ID,
		Provider:            row.Provider,
		AppFingerprint:      row.AppFingerprint,
		ProviderEnvironment: ProviderEnvironment(row.ProviderEnvironment),
		InstanceFingerprint: row.InstanceFingerprint,
		Evidence: ApprovalEvidence{
			State:      ApprovalState(row.ApprovalState),
			Tier:       row.ApprovalTier,
			SourceURL:  row.SourceURL,
			ReviewedAt: row.ReviewedAt,
			ExpiresAt:  row.ExpiresAt,
		},
		OperatorRef: row.OperatorRef,
		CreatedAt:   row.CreatedAt,
	}
}

func certificationFromModels(row models.ProviderCertificationRun, checks []models.ProviderCertificationCheck) (*CertificationEvidence, error) {
	subject := certificationSubject(row)
	digest, err := SubjectDigest(subject)
	if err != nil || digest != row.SubjectDigest {
		return nil, errors.New("provider certification subject digest is invalid")
	}
	var requiredScopes, grantedScopes []string
	if err := json.Unmarshal([]byte(row.RequiredScopesJSON), &requiredScopes); err != nil {
		return nil, fmt.Errorf("decode provider certification required scopes: %w", err)
	}
	if err := json.Unmarshal([]byte(row.GrantedScopesJSON), &grantedScopes); err != nil {
		return nil, fmt.Errorf("decode provider certification granted scopes: %w", err)
	}
	results := make([]CheckResult, 0, len(checks))
	for _, check := range checks {
		results = append(results, CheckResult{
			Kind:                CheckKind(check.Kind),
			Outcome:             CheckOutcome(check.Outcome),
			ErrorClass:          check.ErrorClass,
			NotApplicableReason: check.NotApplicableReason,
			ExternalRefHash:     check.ExternalReferenceHash,
			CompletedAt:         check.CompletedAt,
		})
	}
	return &CertificationEvidence{
		ID:                   row.ID,
		Kind:                 EvidenceKind(row.EvidenceKind),
		Subject:              subject,
		AccountReferenceHash: row.AccountReferenceHash,
		TestedRevision:       row.TestedRevision,
		ContractDigest:       row.ContractDigest,
		TestedAt:             row.TestedAt,
		ExpiresAt:            row.ExpiresAt,
		ApprovalStateAtTest:  ApprovalState(row.ApprovalStateAtTest),
		ApprovalTierAtTest:   row.ApprovalTierAtTest,
		RequiredScopes:       requiredScopes,
		GrantedScopes:        grantedScopes,
		Checks:               results,
		OperatorRef:          row.OperatorRef,
	}, nil
}

func certificationSubject(row models.ProviderCertificationRun) Subject {
	return Subject{
		Provider:              row.Provider,
		AppFingerprint:        row.AppFingerprint,
		DeploymentEnvironment: DeploymentEnvironment(row.DeploymentEnvironment),
		ProviderEnvironment:   ProviderEnvironment(row.ProviderEnvironment),
		InstanceFingerprint:   row.InstanceFingerprint,
		AccountKind:           row.AccountKind,
		OutputProfile:         row.OutputProfile,
		Operation:             Operation(row.Operation),
		PolicyMode:            row.PolicyMode,
	}
}

func certificationModel(approvalReviewID string, evidence CertificationEvidence, requiredScopes, grantedScopes string) models.ProviderCertificationRun {
	digest, _ := SubjectDigest(evidence.Subject)
	return models.ProviderCertificationRun{
		ID:                    evidence.ID,
		ApprovalReviewID:      approvalReviewID,
		EvidenceKind:          string(evidence.Kind),
		SubjectDigest:         digest,
		Provider:              evidence.Subject.Provider,
		AppFingerprint:        evidence.Subject.AppFingerprint,
		DeploymentEnvironment: string(evidence.Subject.DeploymentEnvironment),
		ProviderEnvironment:   string(evidence.Subject.ProviderEnvironment),
		InstanceFingerprint:   evidence.Subject.InstanceFingerprint,
		AccountKind:           evidence.Subject.AccountKind,
		AccountReferenceHash:  evidence.AccountReferenceHash,
		OutputProfile:         evidence.Subject.OutputProfile,
		Operation:             string(evidence.Subject.Operation),
		PolicyMode:            evidence.Subject.PolicyMode,
		TestedRevision:        evidence.TestedRevision,
		ContractDigest:        evidence.ContractDigest,
		ApprovalStateAtTest:   string(evidence.ApprovalStateAtTest),
		ApprovalTierAtTest:    evidence.ApprovalTierAtTest,
		RequiredScopesJSON:    requiredScopes,
		GrantedScopesJSON:     grantedScopes,
		OperatorRef:           evidence.OperatorRef,
		TestedAt:              evidence.TestedAt,
		ExpiresAt:             evidence.ExpiresAt,
		CreatedAt:             time.Now().UTC(),
	}
}

func certificationCheckModels(evidence CertificationEvidence) []models.ProviderCertificationCheck {
	rows := make([]models.ProviderCertificationCheck, 0, len(evidence.Checks))
	for _, check := range evidence.Checks {
		rows = append(rows, models.ProviderCertificationCheck{
			ID:                    uuid.NewString(),
			CertificationRunID:    evidence.ID,
			Kind:                  string(check.Kind),
			Outcome:               string(check.Outcome),
			ErrorClass:            check.ErrorClass,
			NotApplicableReason:   check.NotApplicableReason,
			ExternalReferenceHash: check.ExternalRefHash,
			CompletedAt:           check.CompletedAt,
			CreatedAt:             time.Now().UTC(),
		})
	}
	return rows
}

func validateApprovalReview(review ApprovalReview) error {
	if !safeIDPattern.MatchString(review.ID) || !safeIDPattern.MatchString(review.OperatorRef) {
		return errors.New("provider approval review identifier is invalid")
	}
	if !providerPattern.MatchString(review.Provider) || !digestPattern.MatchString(review.AppFingerprint) ||
		!validProviderEnvironment(review.ProviderEnvironment) ||
		(review.InstanceFingerprint != "" && !digestPattern.MatchString(review.InstanceFingerprint)) {
		return errors.New("provider approval review subject is invalid")
	}
	if review.CreatedAt.IsZero() || review.CreatedAt.Before(review.Evidence.ReviewedAt) ||
		!validApprovalEvidence(review.Evidence, review.CreatedAt) || review.Evidence.SourceURL == "" || review.Evidence.Tier == "" {
		return errors.New("provider approval review evidence is invalid")
	}
	return nil
}

func validateCertificationEvidenceRecord(evidence CertificationEvidence) error {
	if !validCertificationEvidenceEnvelope(evidence) || !validCertificationEvidenceWindowAndScopes(evidence) {
		return errors.New("provider certification evidence is invalid")
	}
	seen := make(map[CheckKind]struct{}, len(evidence.Checks))
	for _, check := range evidence.Checks {
		if !validCheckResult(check) || check.CompletedAt.Before(evidence.TestedAt) || check.CompletedAt.After(evidence.ExpiresAt) {
			return errors.New("provider certification check is invalid")
		}
		if _, duplicate := seen[check.Kind]; duplicate {
			return errors.New("provider certification contains a duplicate check")
		}
		seen[check.Kind] = struct{}{}
	}
	return nil
}

func validCertificationEvidenceEnvelope(evidence CertificationEvidence) bool {
	validAccountReference := evidence.AccountReferenceHash == "" || digestPattern.MatchString(evidence.AccountReferenceHash)
	if evidence.Kind == EvidenceKindLive {
		validAccountReference = digestPattern.MatchString(evidence.AccountReferenceHash)
	}
	return validAccountReference && safeIDPattern.MatchString(evidence.ID) &&
		safeIDPattern.MatchString(evidence.OperatorRef) &&
		(evidence.Kind == EvidenceKindLocal || evidence.Kind == EvidenceKindLive) &&
		validSubject(evidence.Subject) &&
		gitRevisionPattern.MatchString(evidence.TestedRevision) &&
		digestPattern.MatchString(evidence.ContractDigest) &&
		validApprovalState(evidence.ApprovalStateAtTest) &&
		evidence.ApprovalTierAtTest != "" &&
		validOptionalSafeCode(evidence.ApprovalTierAtTest)
}

func validCertificationEvidenceWindowAndScopes(evidence CertificationEvidence) bool {
	return !evidence.TestedAt.IsZero() &&
		!evidence.ExpiresAt.IsZero() &&
		evidence.ExpiresAt.After(evidence.TestedAt) &&
		validUniqueScopes(evidence.RequiredScopes) &&
		validUniqueScopes(evidence.GrantedScopes) &&
		containsAll(evidence.GrantedScopes, evidence.RequiredScopes)
}

func validateRuntimeControlEvent(event RuntimeControlEvent) error {
	if !validRuntimeControlSelector(event.Selector) || !validRuntimeControlEnvelope(event) {
		return errors.New("provider runtime control event is invalid")
	}
	return nil
}

func validRuntimeControlSelector(selector RuntimeControlSelector) bool {
	return providerPattern.MatchString(selector.Provider) &&
		(selector.AppFingerprint == "" || digestPattern.MatchString(selector.AppFingerprint)) &&
		(selector.InstanceFingerprint == "" || digestPattern.MatchString(selector.InstanceFingerprint)) &&
		(selector.DeploymentEnvironment == "" || validDeploymentEnvironment(selector.DeploymentEnvironment)) &&
		(selector.ProviderEnvironment == "" || validProviderEnvironment(selector.ProviderEnvironment)) &&
		(selector.Operation == "" || validOperation(selector.Operation)) &&
		validOptionalSafeCode(selector.AccountKind) &&
		validOptionalSafeCode(selector.OutputProfile) &&
		validOptionalSafeCode(selector.PolicyMode)
}

func validRuntimeControlEnvelope(event RuntimeControlEvent) bool {
	return safeIDPattern.MatchString(event.ID) &&
		safeIDPattern.MatchString(event.OperatorRef) &&
		validRuntimeControlState(event.Control.State) &&
		event.Control.State != RuntimeControlStateUnknown &&
		providerPattern.MatchString(event.Control.ReasonCode) &&
		!event.StartsAt.IsZero() &&
		!event.CreatedAt.IsZero() &&
		(event.Control.ExpiresAt.IsZero() || event.Control.ExpiresAt.After(event.StartsAt))
}

func canonicalStringSetJSON(values []string) (string, error) {
	copyValues := append([]string(nil), values...)
	slices.Sort(copyValues)
	encoded, err := json.Marshal(copyValues)
	if err != nil {
		return "", fmt.Errorf("encode provider certification scopes: %w", err)
	}
	return string(encoded), nil
}

func runtimeControlScopeKey(row models.ProviderRuntimeControlEvent) string {
	return strings.Join([]string{
		row.Provider,
		row.AppFingerprint,
		row.DeploymentEnvironment,
		row.ProviderEnvironment,
		row.InstanceFingerprint,
		row.AccountKind,
		row.OutputProfile,
		row.Operation,
		row.PolicyMode,
	}, "\x1f")
}

func runtimeControlSeverity(state RuntimeControlState) int {
	switch state {
	case RuntimeControlStateDisabled:
		return 3
	case RuntimeControlStateDegraded:
		return 2
	case RuntimeControlStateEnabled:
		return 1
	default:
		return 4
	}
}
