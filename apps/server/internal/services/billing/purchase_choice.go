package billing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const PurchaseChoiceTTL = 24 * time.Hour

var (
	ErrPurchaseChoiceMissing  = errors.New("purchase choice is required")
	ErrPurchaseChoiceInvalid  = errors.New("purchase choice is invalid")
	ErrPurchaseChoiceExpired  = errors.New("purchase choice has expired")
	ErrPurchaseChoiceMismatch = errors.New("purchase choice does not match the selected plan and billing period")
)

type PurchaseChoice struct {
	Token          string
	PlanID         string
	PlanName       string
	BillingPeriod  string
	ListPriceUSD   int
	TrialDays      int
	CardRequired   bool
	DueTodayUSD    int
	CatalogVersion string
	ExpiresAt      time.Time
}

type purchaseChoiceClaims struct {
	Version        int    `json:"v"`
	CatalogVersion string `json:"catalog_version"`
	PlanID         string `json:"plan_id"`
	BillingPeriod  string `json:"billing_period"`
	ExpiresAt      int64  `json:"expires_at"`
}

func (s *Service) CreatePurchaseChoice(planID, billingPeriod string) (PurchaseChoice, error) {
	planID = strings.ToLower(strings.TrimSpace(planID))
	if planID == "" || strings.TrimSpace(billingPeriod) == "" {
		return PurchaseChoice{}, ErrPurchaseChoiceMissing
	}
	period, err := canonicalPurchaseBillingPeriod(billingPeriod)
	if err != nil {
		return PurchaseChoice{}, err
	}
	plan, ok := s.paddle.Plans[planID]
	if !ok {
		return PurchaseChoice{}, fmt.Errorf("%w: unknown plan %q", ErrPurchaseChoiceInvalid, planID)
	}
	if len(s.purchaseChoiceSecret) == 0 {
		return PurchaseChoice{}, configurationError("purchase choice signing is not configured")
	}
	expiresAt := s.now().UTC().Add(PurchaseChoiceTTL)
	claims := purchaseChoiceClaims{
		Version:        1,
		CatalogVersion: PlanCatalogVersion,
		PlanID:         planID,
		BillingPeriod:  period,
		ExpiresAt:      expiresAt.Unix(),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return PurchaseChoice{}, fmt.Errorf("encoding purchase choice: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	token := encoded + "." + s.signPurchaseChoice(encoded)
	return purchaseChoiceFromPlan(token, planID, period, plan, expiresAt), nil
}

func (s *Service) ResolvePurchaseChoice(token, expectedPlanID, expectedBillingPeriod string) (PurchaseChoice, error) {
	token = strings.TrimSpace(token)
	claims, expiresAt, err := s.resolvePurchaseChoiceClaims(token)
	if err != nil {
		return PurchaseChoice{}, err
	}
	period, err := canonicalPurchaseBillingPeriod(claims.BillingPeriod)
	if err != nil {
		return PurchaseChoice{}, ErrPurchaseChoiceInvalid
	}
	plan, ok := s.paddle.Plans[claims.PlanID]
	if !ok {
		return PurchaseChoice{}, ErrPurchaseChoiceInvalid
	}
	if expectedPlanID != "" && strings.ToLower(strings.TrimSpace(expectedPlanID)) != claims.PlanID {
		return PurchaseChoice{}, ErrPurchaseChoiceMismatch
	}
	if expectedBillingPeriod != "" {
		expectedPeriod, periodErr := canonicalPurchaseBillingPeriod(expectedBillingPeriod)
		if periodErr != nil || expectedPeriod != period {
			return PurchaseChoice{}, ErrPurchaseChoiceMismatch
		}
	}
	return purchaseChoiceFromPlan(token, claims.PlanID, period, plan, expiresAt), nil
}

func (s *Service) resolvePurchaseChoiceClaims(token string) (purchaseChoiceClaims, time.Time, error) {
	if token == "" {
		return purchaseChoiceClaims{}, time.Time{}, ErrPurchaseChoiceMissing
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(s.purchaseChoiceSecret) == 0 {
		return purchaseChoiceClaims{}, time.Time{}, ErrPurchaseChoiceInvalid
	}
	if !hmac.Equal([]byte(parts[1]), []byte(s.signPurchaseChoice(parts[0]))) {
		return purchaseChoiceClaims{}, time.Time{}, ErrPurchaseChoiceInvalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return purchaseChoiceClaims{}, time.Time{}, ErrPurchaseChoiceInvalid
	}
	var claims purchaseChoiceClaims
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Version != 1 || claims.CatalogVersion != PlanCatalogVersion {
		return purchaseChoiceClaims{}, time.Time{}, ErrPurchaseChoiceInvalid
	}
	expiresAt := time.Unix(claims.ExpiresAt, 0).UTC()
	if !expiresAt.After(s.now().UTC()) {
		return purchaseChoiceClaims{}, time.Time{}, ErrPurchaseChoiceExpired
	}
	return claims, expiresAt, nil
}

func (s *Service) signPurchaseChoice(payload string) string {
	mac := hmac.New(sha256.New, s.purchaseChoiceSecret)
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func canonicalPurchaseBillingPeriod(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "monthly":
		return "monthly", nil
	case "annual":
		return "annual", nil
	case "":
		return "", ErrPurchaseChoiceMissing
	default:
		return "", fmt.Errorf("%w: unknown billing period %q", ErrPurchaseChoiceInvalid, value)
	}
}

func purchaseChoiceFromPlan(token, planID, period string, plan PlanConfig, expiresAt time.Time) PurchaseChoice {
	price := plan.MonthlyPriceUSD
	if period == "annual" {
		price = plan.AnnualPriceUSD
	}
	return PurchaseChoice{
		Token:          token,
		PlanID:         planID,
		PlanName:       plan.Name,
		BillingPeriod:  period,
		ListPriceUSD:   price,
		TrialDays:      TrialDays,
		CardRequired:   PlanCatalogCardRequired,
		DueTodayUSD:    PlanCatalogDueTodayUSD,
		CatalogVersion: PlanCatalogVersion,
		ExpiresAt:      expiresAt,
	}
}
