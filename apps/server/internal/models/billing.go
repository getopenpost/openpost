package models

import (
	"time"

	"github.com/uptrace/bun"
)

type UsageCounter struct {
	bun.BaseModel `bun:"table:usage_counters"`

	WorkspaceID string    `bun:",pk" json:"workspace_id"`
	Metric      string    `bun:",pk" json:"metric"`
	PeriodStart time.Time `bun:",pk" json:"period_start"`
	Value       int64     `bun:",notnull,default:0" json:"value"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// ProviderUsageEvent is an immutable estimate of a confirmed successful hosted
// provider request. OperationKey makes one confirmed request idempotent without
// retaining post text, provider responses, or credentials.
type ProviderUsageEvent struct {
	bun.BaseModel `bun:"table:provider_usage_events"`

	ID               string    `bun:",pk" json:"id"`
	WorkspaceID      string    `bun:",notnull" json:"workspace_id"`
	Provider         string    `bun:",notnull" json:"provider"`
	Operation        string    `bun:",notnull" json:"operation"`
	OperationKey     string    `bun:",notnull,unique" json:"operation_key"`
	Units            int64     `bun:",notnull" json:"units"`
	UnitCostMicrousd int64     `bun:",notnull" json:"unit_cost_microusd"`
	CostMicrousd     int64     `bun:",notnull" json:"cost_microusd"`
	OccurredAt       time.Time `bun:",notnull" json:"occurred_at"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// ProviderUsageReservation holds the bounded cost exposure for an in-flight or
// ambiguous provider request. It is mutable operational state, not billable
// usage, and is removed after a confirmed success or definite failure.
type ProviderUsageReservation struct {
	bun.BaseModel `bun:"table:provider_usage_reservations"`

	OperationKey     string    `bun:",pk" json:"operation_key"`
	WorkspaceID      string    `bun:",notnull" json:"workspace_id"`
	Provider         string    `bun:",notnull" json:"provider"`
	Operation        string    `bun:",notnull" json:"operation"`
	State            string    `bun:",notnull" json:"state"`
	Units            int64     `bun:",notnull" json:"units"`
	UnitCostMicrousd int64     `bun:",notnull" json:"unit_cost_microusd"`
	CostMicrousd     int64     `bun:",notnull" json:"cost_microusd"`
	OccurredAt       time.Time `bun:",notnull" json:"occurred_at"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// ProviderUsagePeriodCounter is a monthly projection of immutable confirmed
// usage events plus active reservations. It can be rebuilt from both sources.
type ProviderUsagePeriodCounter struct {
	bun.BaseModel `bun:"table:provider_usage_period_counters"`

	WorkspaceID        string    `bun:",pk" json:"workspace_id"`
	PeriodStart        time.Time `bun:",pk" json:"period_start"`
	Provider           string    `bun:",pk" json:"provider"`
	Operation          string    `bun:",pk" json:"operation"`
	EventCount         int64     `bun:",notnull,default:0" json:"event_count"`
	Units              int64     `bun:",notnull,default:0" json:"units"`
	CostMicrousd       int64     `bun:",notnull,default:0" json:"cost_microusd"`
	ReservedEventCount int64     `bun:",notnull,default:0" json:"reserved_event_count"`
	ReservedUnits      int64     `bun:",notnull,default:0" json:"reserved_units"`
	ReservedMicrousd   int64     `bun:"reserved_cost_microusd,notnull,default:0" json:"reserved_cost_microusd"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

const (
	// BillingProviderPaddle identifies subscriptions managed by Paddle checkout.
	BillingProviderPaddle = "paddle"
	// BillingProviderAdmin identifies administrator-managed plan overrides that
	// grant entitlements without a checkout or payment.
	BillingProviderAdmin = "admin"
)

type BillingSubscription struct {
	bun.BaseModel `bun:"table:billing_subscriptions"`

	OrganizationID         string    `bun:",pk" json:"organization_id"`
	WorkspaceID            string    `bun:",nullzero" json:"workspace_id,omitempty"`
	Provider               string    `bun:",notnull,default:'paddle'" json:"provider"`
	ProviderCustomerID     string    `bun:",notnull" json:"provider_customer_id"`
	ProviderSubscriptionID string    `bun:",notnull,unique" json:"provider_subscription_id"`
	ProviderProductID      string    `json:"provider_product_id"`
	ProviderPriceID        string    `json:"provider_price_id"`
	Status                 string    `bun:",notnull" json:"status"`
	PlanID                 string    `bun:",notnull,default:''" json:"plan_id"`
	EntitlementSnapshot    string    `bun:",notnull,default:'{}'" json:"entitlement_snapshot"`
	CurrentPeriodEnd       time.Time `bun:",nullzero" json:"current_period_end"`
	CancelAtPeriodEnd      bool      `bun:",notnull,default:false" json:"cancel_at_period_end"`
	ProviderUpdatedAt      time.Time `bun:",nullzero" json:"provider_updated_at"`
	PastDueSince           time.Time `bun:",nullzero" json:"past_due_since"`
	RawPayload             string    `bun:",notnull,default:'{}'" json:"raw_payload"`
	CreatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type BillingWebhookEvent struct {
	bun.BaseModel `bun:"table:billing_webhook_events"`

	EventID                   string    `bun:",pk" json:"event_id"`
	Provider                  string    `bun:",notnull,default:'paddle'" json:"provider"`
	EventType                 string    `bun:",notnull" json:"event_type"`
	OccurredAt                time.Time `bun:",nullzero" json:"occurred_at"`
	ProcessedAt               time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"processed_at"`
	DiscordNotificationSentAt time.Time `bun:"discord_notification_sent_at,nullzero" json:"-"`
}

type BillingCheckoutAttempt struct {
	bun.BaseModel `bun:"table:billing_checkout_attempts"`

	CheckoutAttemptID      string    `bun:",pk" json:"checkout_attempt_id"`
	OrganizationID         string    `bun:",notnull" json:"organization_id"`
	WorkspaceID            string    `json:"workspace_id,omitempty"`
	UserID                 string    `json:"user_id,omitempty"`
	Provider               string    `bun:",notnull,default:'paddle'" json:"provider"`
	ProviderPriceID        string    `bun:",notnull" json:"provider_price_id"`
	ProviderSubscriptionID string    `json:"provider_subscription_id,omitempty"`
	PlanID                 string    `bun:",notnull" json:"plan_id"`
	BillingPeriod          string    `bun:",notnull" json:"billing_period"`
	ConfirmationKey        string    `bun:"confirmation_key,notnull,default:''" json:"-"`
	ReturnPath             string    `bun:"return_path,notnull,default:''" json:"-"`
	Status                 string    `bun:",notnull,default:'created'" json:"status"`
	ReturnConsumedAt       time.Time `bun:"return_consumed_at,nullzero" json:"-"`
	CreatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// BillingCheckoutCancellation is the content-free provider reconciliation
// boundary retained when a checkout is canceled. It deliberately has no
// Organization foreign key so a late Paddle completion can still be canceled
// after the Organization has been removed.
type BillingCheckoutCancellation struct {
	bun.BaseModel `bun:"table:billing_checkout_cancellations"`

	CheckoutAttemptID      string    `bun:",pk" json:"checkout_attempt_id"`
	OrganizationID         string    `bun:",notnull" json:"organization_id"`
	Provider               string    `bun:",notnull,default:'paddle'" json:"provider"`
	ProviderSubscriptionID string    `bun:",notnull,default:''" json:"provider_subscription_id,omitempty"`
	CanceledAt             time.Time `bun:",notnull" json:"canceled_at"`
	ResolvedAt             time.Time `bun:",nullzero" json:"resolved_at,omitempty"`
}

type BillingCustomer struct {
	bun.BaseModel `bun:"table:billing_customers"`

	Provider           string    `bun:",pk,notnull" json:"provider"`
	ProviderCustomerID string    `bun:",pk,notnull" json:"provider_customer_id"`
	Email              string    `bun:",notnull,default:''" json:"email"`
	Name               string    `bun:",notnull,default:''" json:"name"`
	RawPayload         string    `bun:",notnull,default:'{}'" json:"raw_payload"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type MCPToolCall struct {
	bun.BaseModel `bun:"table:mcp_tool_calls"`

	ID                string    `bun:",pk" json:"id"`
	UserID            string    `bun:",notnull" json:"user_id"`
	WorkspaceID       string    `bun:",nullzero" json:"workspace_id"`
	ClientID          string    `bun:",nullzero" json:"client_id"`
	ClientName        string    `json:"client_name"`
	ClientScope       string    `json:"client_scope"`
	ClientTokenPrefix string    `json:"client_token_prefix"`
	ToolName          string    `bun:",notnull" json:"tool_name"`
	Status            string    `bun:",notnull" json:"status"`
	ErrorMessage      string    `json:"error_message"`
	DurationMs        int64     `bun:",notnull,default:0" json:"duration_ms"`
	CreatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}
