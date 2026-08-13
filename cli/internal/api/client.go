// Package api is the OpenPost HTTP client used by every CLI
// subcommand. It is a hand-rolled typed client over the same
// /api/v1 surface the web frontend consumes. The CLI is treated as
// an external client of a running OpenPost instance; it does not
// import backend/internal/... or touch SQLite.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const defaultVersion = "dev"

var (
	versionMu     sync.RWMutex
	clientVersion = defaultVersion
)

func SetVersion(version string) {
	version = strings.TrimSpace(version)
	if version == "" {
		version = defaultVersion
	}
	versionMu.Lock()
	clientVersion = version
	versionMu.Unlock()
}

func Version() string {
	versionMu.RLock()
	defer versionMu.RUnlock()
	return clientVersion
}

// Client is a thin wrapper around *http.Client with the bits every
// OpenPost call needs: base URL, bearer token, JSON helpers, multipart
// upload, and a typed error surface.
type Client struct {
	BaseURL   string
	Token     string
	HTTP      *http.Client
	UserAgent string
}

// New returns a client targeting baseURL with the given bearer token.
// Pass an empty token for unauthenticated calls (e.g. /health).
func New(baseURL, token string) *Client {
	return &Client{
		BaseURL:   strings.TrimRight(baseURL, "/"),
		Token:     token,
		HTTP:      &http.Client{Timeout: 60 * time.Second},
		UserAgent: "openpost-cli/" + Version(),
	}
}

// Error is the wire-format error returned by Huma: { "error": "..." }.
// The CLI maps this to a friendly stderr line.
type Error struct {
	StatusCode int    `json:"-"`
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	Message    string `json:"message"`
}

func (e *Error) Error() string {
	for _, s := range []string{e.Detail, e.Message, e.Title} {
		if s != "" {
			return fmt.Sprintf("HTTP %d: %s", e.StatusCode, s)
		}
	}
	return fmt.Sprintf("HTTP %d", e.StatusCode)
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any, contentType string) error {
	u, err := url.Parse(c.BaseURL + path)
	if err != nil {
		return fmt.Errorf("invalid URL %s: %w", c.BaseURL+path, err)
	}
	var rdr io.Reader
	if body != nil {
		if r, ok := body.(io.Reader); ok {
			rdr = r
		} else if s, ok := body.(string); ok && contentType == "" {
			rdr = strings.NewReader(s)
		} else {
			data, err := json.Marshal(body)
			if err != nil {
				return fmt.Errorf("marshal request: %w", err)
			}
			rdr = bytes.NewReader(data)
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), rdr)
	if err != nil {
		return err
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	} else if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", c.UserAgent)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		apiErr := &Error{StatusCode: resp.StatusCode}
		_ = json.Unmarshal(respBody, apiErr)
		if apiErr.Message == "" && apiErr.Detail == "" {
			apiErr.Message = strings.TrimSpace(string(respBody))
		}
		return apiErr
	}

	if out == nil || len(respBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

func (c *Client) GetJSON(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodGet, path, nil, out, "")
}

func (c *Client) PostJSON(ctx context.Context, path string, body, out any) error {
	return c.do(ctx, http.MethodPost, path, body, out, "")
}

func (c *Client) PatchJSON(ctx context.Context, path string, body, out any) error {
	return c.do(ctx, http.MethodPatch, path, body, out, "")
}

func (c *Client) PutJSON(ctx context.Context, path string, body, out any) error {
	return c.do(ctx, http.MethodPut, path, body, out, "")
}

func (c *Client) DeleteJSON(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodDelete, path, nil, out, "")
}

func listEndpointPath(path, workspaceID, status, extraKey, extraValue string, limit, offset int) string {
	v := url.Values{}
	if workspaceID != "" {
		v.Set("workspace_id", workspaceID)
	}
	if status != "" {
		v.Set("status", status)
	}
	if extraKey != "" && extraValue != "" {
		v.Set(extraKey, extraValue)
	}
	if limit > 0 {
		v.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		v.Set("offset", strconv.Itoa(offset))
	}
	if encoded := v.Encode(); encoded != "" {
		return path + "?" + encoded
	}
	return path
}

// PostForm posts a multipart/form-data request with the given fields
// and a file under fieldName. out is decoded from the JSON body.
func (c *Client) PostForm(ctx context.Context, path, fileField, filePath string, fields map[string]string, out any) error {
	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("open file: %w", err)
	}
	defer func() { _ = f.Close() }()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			return err
		}
	}
	fw, err := mw.CreateFormFile(fileField, filepath.Base(filePath))
	if err != nil {
		return err
	}
	if _, err := io.Copy(fw, f); err != nil {
		return err
	}
	if err := mw.Close(); err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, path, &buf, out, mw.FormDataContentType())
}

// ----- typed endpoints used by the CLI -----

// Health is the public /api/v1/health probe.
func (c *Client) Health(ctx context.Context) error {
	var out struct {
		Status string `json:"status"`
	}
	if err := c.GetJSON(ctx, "/api/v1/health", &out); err != nil {
		return err
	}
	if out.Status != "ok" {
		return fmt.Errorf("health: unexpected status %q", out.Status)
	}
	return nil
}

type Readiness struct {
	Status   string `json:"status"`
	Database string `json:"database"`
}

// Ready is the public /api/v1/ready dependency probe.
func (c *Client) Ready(ctx context.Context) (*Readiness, error) {
	var out Readiness
	if err := c.GetJSON(ctx, "/api/v1/ready", &out); err != nil {
		return nil, err
	}
	if out.Status != "ready" {
		return nil, fmt.Errorf("readiness: unexpected status %q", out.Status)
	}
	if out.Database != "ok" {
		return nil, fmt.Errorf("readiness: unexpected database status %q", out.Database)
	}
	return &out, nil
}

// Me fetches the authenticated user profile.
func (c *Client) Me(ctx context.Context) (*Me, error) {
	var m Me
	if err := c.GetJSON(ctx, "/api/v1/auth/me", &m); err != nil {
		return nil, err
	}
	return &m, nil
}

type Me struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

// ----- Workspaces -----

type Workspace struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

func (c *Client) ListWorkspaces(ctx context.Context) ([]Workspace, error) {
	var out []Workspace
	if err := c.GetJSON(ctx, "/api/v1/workspaces", &out); err != nil {
		return nil, err
	}
	return out, nil
}

type CreateWorkspaceInput struct {
	Name string `json:"name"`
}

func (c *Client) CreateWorkspace(ctx context.Context, in CreateWorkspaceInput) (*Workspace, error) {
	var out Workspace
	if err := c.PostJSON(ctx, "/api/v1/workspaces", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type WorkspaceSettings struct {
	Timezone            string `json:"timezone"`
	WeekStart           int    `json:"week_start"`
	RandomDelayMinutes  int    `json:"random_delay_minutes"`
	DraftGapMinutes     int    `json:"draft_gap_minutes"`
	SlotStartHour       int    `json:"slot_start_hour"`
	SlotEndHour         int    `json:"slot_end_hour"`
	SlotIntervalMinutes int    `json:"slot_interval_minutes"`
}

func (c *Client) GetWorkspaceSettings(ctx context.Context, workspaceID string) (*WorkspaceSettings, error) {
	var out WorkspaceSettings
	if err := c.GetJSON(ctx, "/api/v1/workspaces/"+workspaceID+"/settings", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ----- Billing -----

type BillingStatus struct {
	WorkspaceID       string           `json:"workspace_id"`
	Provider          string           `json:"provider,omitempty"`
	Status            string           `json:"status"`
	PlanID            string           `json:"plan_id,omitempty"`
	CurrentPeriodEnd  string           `json:"current_period_end,omitempty"`
	CancelAtPeriodEnd bool             `json:"cancel_at_period_end"`
	Limits            map[string]int64 `json:"limits"`
	Usage             map[string]int64 `json:"usage"`
	PeriodStart       string           `json:"period_start"`
}

type BillingURL struct {
	URL             string `json:"url"`
	ID              string `json:"id,omitempty"`
	PlanID          string `json:"plan_id,omitempty"`
	BillingPeriod   string `json:"billing_period,omitempty"`
	ProviderPriceID string `json:"provider_price_id,omitempty"`
	TrialEndsAt     string `json:"trial_ends_at,omitempty"`
	ReturnURL       string `json:"return_url,omitempty"`
}

func (c *Client) BillingStatus(ctx context.Context, workspaceID string) (*BillingStatus, error) {
	v := url.Values{}
	v.Set("workspace_id", workspaceID)
	var out BillingStatus
	if err := c.GetJSON(ctx, "/api/v1/billing/status?"+v.Encode(), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) CreateBillingCheckout(ctx context.Context, workspaceID, planID, billingPeriod string) (*BillingURL, error) {
	var out BillingURL
	if err := c.PostJSON(ctx, "/api/v1/billing/checkout", map[string]string{
		"workspace_id":   workspaceID,
		"plan_id":        planID,
		"billing_period": billingPeriod,
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) CreateBillingPortal(ctx context.Context, workspaceID string) (*BillingURL, error) {
	var out BillingURL
	if err := c.PostJSON(ctx, "/api/v1/billing/portal", map[string]string{
		"workspace_id": workspaceID,
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ----- Posting schedules -----

type PostingSchedule struct {
	ID             string `json:"id"`
	WorkspaceID    string `json:"workspace_id"`
	UTCHour        int    `json:"utc_hour"`
	UTCMinute      int    `json:"utc_minute"`
	DayOfWeek      int    `json:"day_of_week"`
	LocalHour      int    `json:"local_hour"`
	LocalMinute    int    `json:"local_minute"`
	LocalDayOfWeek int    `json:"local_day_of_week"`
	Label          string `json:"label,omitempty"`
	IsActive       bool   `json:"is_active"`
	CreatedAt      string `json:"created_at"`
}

type NextAvailableSlotInput struct {
	WorkspaceID string
}

type NextAvailableSlotOutput struct {
	Slot     *PostingSchedule `json:"slot,omitempty"`
	SlotTime string           `json:"slot_time"`
	Message  string           `json:"message"`
}

type CreatePostingScheduleInput struct {
	WorkspaceID    string `json:"workspace_id"`
	UTCHour        int    `json:"utc_hour"`
	UTCMinute      int    `json:"utc_minute"`
	DayOfWeek      int    `json:"day_of_week"`
	LocalHour      *int   `json:"local_hour,omitempty"`
	LocalMinute    *int   `json:"local_minute,omitempty"`
	LocalDayOfWeek *int   `json:"local_day_of_week,omitempty"`
	Label          string `json:"label,omitempty"`
}

type UpdatePostingScheduleInput struct {
	UTCHour   *int    `json:"utc_hour,omitempty"`
	UTCMinute *int    `json:"utc_minute,omitempty"`
	DayOfWeek *int    `json:"day_of_week,omitempty"`
	Label     *string `json:"label,omitempty"`
	IsActive  *bool   `json:"is_active,omitempty"`
}

type SuggestPostingScheduleOutput struct {
	Schedules []PostingSchedule `json:"schedules"`
	Message   string            `json:"message"`
}

func (c *Client) ListPostingSchedules(ctx context.Context, workspaceID string) ([]PostingSchedule, error) {
	v := url.Values{}
	v.Set("workspace_id", workspaceID)
	var out []PostingSchedule
	if err := c.GetJSON(ctx, "/api/v1/posting-schedules?"+v.Encode(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) CreatePostingSchedule(ctx context.Context, in CreatePostingScheduleInput) (*PostingSchedule, error) {
	var out PostingSchedule
	if err := c.PostJSON(ctx, "/api/v1/posting-schedules", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpdatePostingSchedule(ctx context.Context, scheduleID string, in UpdatePostingScheduleInput) (*PostingSchedule, error) {
	var out PostingSchedule
	if err := c.PatchJSON(ctx, "/api/v1/posting-schedules/"+url.PathEscape(scheduleID), in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeletePostingSchedule(ctx context.Context, scheduleID string) error {
	return c.DeleteJSON(ctx, "/api/v1/posting-schedules/"+url.PathEscape(scheduleID), nil)
}

func (c *Client) SuggestPostingSchedule(ctx context.Context, workspaceID string, postsPerDay int) (*SuggestPostingScheduleOutput, error) {
	var out SuggestPostingScheduleOutput
	if err := c.PostJSON(ctx, "/api/v1/posting-schedules/suggest", map[string]any{
		"workspace_id":  workspaceID,
		"posts_per_day": postsPerDay,
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) NextAvailableSlot(ctx context.Context, in NextAvailableSlotInput) (*NextAvailableSlotOutput, error) {
	v := url.Values{}
	v.Set("workspace_id", in.WorkspaceID)
	var out NextAvailableSlotOutput
	if err := c.GetJSON(ctx, "/api/v1/posting-schedules/next-slot?"+v.Encode(), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ----- Accounts -----

type SocialAccount struct {
	ID                     string `json:"id"`
	Slug                   string `json:"slug"`
	Platform               string `json:"platform"`
	AccountID              string `json:"account_id"`
	AccountUsername        string `json:"account_username"`
	InstanceURL            string `json:"instance_url"`
	IsActive               bool   `json:"is_active"`
	ThreadRepliesSupported bool   `json:"thread_replies_supported"`
}

type ProviderInfo struct {
	Platform     string                    `json:"platform"`
	DisplayName  string                    `json:"display_name"`
	AuthMode     string                    `json:"auth_mode"`
	Name         string                    `json:"name,omitempty"`
	InstanceURL  string                    `json:"instance_url,omitempty"`
	Configured   bool                      `json:"configured"`
	Status       string                    `json:"status,omitempty"`
	Description  string                    `json:"description,omitempty"`
	Capabilities []string                  `json:"capabilities,omitempty"`
	Readiness    ProviderReadinessDecision `json:"readiness"`
}

type ProviderReadinessFacts struct {
	Configuration     string `json:"configuration"`
	LocalTest         string `json:"local_test"`
	LiveCertification string `json:"live_certification"`
	Approval          string `json:"approval"`
	Authorization     string `json:"authorization"`
	Control           string `json:"control"`
	Policy            string `json:"policy"`
}

type ProviderReadinessBlocker struct {
	Code   string `json:"code"`
	Detail string `json:"detail,omitempty"`
}

type ProviderReadinessDecision struct {
	State          string                     `json:"state"`
	ContractDigest string                     `json:"contract_digest,omitempty"`
	Executable     bool                       `json:"executable"`
	Connectable    bool                       `json:"connectable"`
	Publishable    bool                       `json:"publishable"`
	Advertisable   bool                       `json:"advertisable"`
	Facts          ProviderReadinessFacts     `json:"facts"`
	Blockers       []ProviderReadinessBlocker `json:"blockers,omitempty"`
}

type ProviderReadinessProfile struct {
	SocialAccountID string                    `json:"social_account_id"`
	OutputProfile   string                    `json:"output_profile"`
	Immediate       ProviderReadinessDecision `json:"immediate"`
	Scheduled       ProviderReadinessDecision `json:"scheduled"`
}

type ProviderReadiness struct {
	Provider           string                     `json:"provider"`
	State              string                     `json:"state"`
	Connectable        bool                       `json:"connectable"`
	Advertisable       bool                       `json:"advertisable"`
	Facts              ProviderReadinessFacts     `json:"facts"`
	Profiles           []ProviderReadinessProfile `json:"profiles,omitempty"`
	ConfiguredAppState string                     `json:"configured_app_state"`
	ConnectedAccounts  int                        `json:"connected_accounts"`
	BlockingIssues     []string                   `json:"blocking_issues,omitempty"`
}

type CapabilityProfile struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type CapabilityMediaConstraint struct {
	MinCount               int      `json:"min_count"`
	MaxCount               int      `json:"max_count"`
	AllowedMIMEs           []string `json:"allowed_mimes"`
	AspectRatios           []string `json:"aspect_ratios,omitempty"`
	MaxDurationSeconds     int      `json:"max_duration_seconds,omitempty"`
	MaxSizeBytes           int64    `json:"max_size_bytes,omitempty"`
	RequiresPublicURL      bool     `json:"requires_public_url"`
	RequiresHTTPSFetchable bool     `json:"requires_https_fetchable"`
}

type Capability struct {
	Provider             string                    `json:"provider"`
	Profile              string                    `json:"profile"`
	OutputProfile        string                    `json:"output_profile"`
	Intents              []string                  `json:"intents"`
	MediaShapes          []string                  `json:"media_shapes"`
	Label                string                    `json:"label"`
	ValidationCategories []string                  `json:"validation_categories,omitempty"`
	TextLimit            int                       `json:"text_limit,omitempty"`
	TitleRequired        bool                      `json:"title_required,omitempty"`
	DescriptionRequired  bool                      `json:"description_required,omitempty"`
	NativeScheduling     bool                      `json:"native_scheduling"`
	OpenPostQueued       bool                      `json:"openpost_queued"`
	RequiresAppReview    bool                      `json:"requires_app_review"`
	RequiresPublicMedia  bool                      `json:"requires_public_media"`
	Media                CapabilityMediaConstraint `json:"media"`
	Settings             []map[string]any          `json:"settings,omitempty"`
	Caveats              []string                  `json:"caveats,omitempty"`
	Metadata             map[string]string         `json:"metadata,omitempty"`
	CapabilityRevision   string                    `json:"capability_revision"`
	ExpiresAt            string                    `json:"expires_at,omitempty"`
	UnavailableReason    string                    `json:"unavailable_reason,omitempty"`
}

type CapabilityCatalog struct {
	Profiles     []CapabilityProfile `json:"profiles"`
	Capabilities []Capability        `json:"capabilities"`
}

type UpdateAccountInput struct {
	Slug string `json:"slug"`
}

func (c *Client) ListAccountProviders(ctx context.Context) ([]ProviderInfo, error) {
	var out []ProviderInfo
	if err := c.GetJSON(ctx, "/api/v1/accounts/providers", &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) GetProviderReadiness(ctx context.Context, workspaceID string) ([]ProviderReadiness, error) {
	v := url.Values{}
	v.Set("workspace_id", workspaceID)
	var out struct {
		Providers []ProviderReadiness `json:"providers"`
	}
	if err := c.GetJSON(ctx, "/api/v1/provider-readiness?"+v.Encode(), &out); err != nil {
		return nil, err
	}
	return out.Providers, nil
}

func (c *Client) ListCapabilities(ctx context.Context) (*CapabilityCatalog, error) {
	var out CapabilityCatalog
	if err := c.GetJSON(ctx, "/api/v1/capabilities", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListAccounts(ctx context.Context, workspaceID string) ([]SocialAccount, error) {
	var out []SocialAccount
	if err := c.GetJSON(ctx, "/api/v1/accounts?workspace_id="+url.QueryEscape(workspaceID), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) UpdateAccount(ctx context.Context, accountID string, in UpdateAccountInput) (*SocialAccount, error) {
	var out SocialAccount
	if err := c.PatchJSON(ctx, "/api/v1/accounts/"+url.PathEscape(accountID), in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DisconnectAccount deactivates a connected social account.
func (c *Client) DisconnectAccount(ctx context.Context, accountID string) error {
	return c.DeleteJSON(ctx, "/api/v1/accounts/"+url.PathEscape(accountID), nil)
}

// ----- Media -----

type Media struct {
	ID               string `json:"id"`
	MimeType         string `json:"mime_type"`
	URL              string `json:"url"`
	Size             int64  `json:"size"`
	Deduped          bool   `json:"deduped"`
	AltText          string `json:"alt_text"`
	OriginalFilename string `json:"original_filename"`
}

type MediaListItem struct {
	ID                 string   `json:"id"`
	WorkspaceID        string   `json:"workspace_id"`
	MimeType           string   `json:"mime_type"`
	Size               int64    `json:"size"`
	OriginalFilename   string   `json:"original_filename"`
	Width              int      `json:"width"`
	Height             int      `json:"height"`
	AltText            string   `json:"alt_text"`
	IsFavorite         bool     `json:"is_favorite"`
	CreatedAt          string   `json:"created_at"`
	URL                string   `json:"url"`
	ThumbnailURL       string   `json:"thumbnail_url"`
	UsageCount         int      `json:"usage_count"`
	CanDelete          bool     `json:"can_delete"`
	ProcessingStatus   string   `json:"processing_status"`
	DurationMS         int64    `json:"duration_ms"`
	FrameRate          float64  `json:"frame_rate"`
	AnalysisStatus     string   `json:"analysis_status"`
	AnalysisError      string   `json:"analysis_error,omitempty"`
	PosterThumbnailURL string   `json:"poster_thumbnail_url,omitempty"`
	PublicURLCheckedAt string   `json:"public_url_checked_at,omitempty"`
	PublicURLStatus    int      `json:"public_url_status"`
	PublicURLError     string   `json:"public_url_error,omitempty"`
	Source             string   `json:"source"`
	AssetKind          string   `json:"asset_kind"`
	ParentMediaID      string   `json:"parent_media_id,omitempty"`
	DesignDocumentID   string   `json:"design_document_id,omitempty"`
	DesignPageID       string   `json:"design_page_id,omitempty"`
	Collections        []string `json:"collections"`
	Tags               []string `json:"tags"`
}

type MediaStorage struct {
	UsedBytes             int64 `json:"used_bytes"`
	AssetCount            int   `json:"asset_count"`
	InternalBytes         int64 `json:"internal_bytes"`
	LimitBytes            int64 `json:"limit_bytes"`
	DirectUploadSupported bool  `json:"direct_upload_supported"`
}

type MediaUsageItem struct {
	Kind        string `json:"kind"`
	ID          string `json:"id"`
	Label       string `json:"label"`
	PostID      string `json:"post_id,omitempty"`
	Content     string `json:"content,omitempty"`
	Status      string `json:"status,omitempty"`
	ScheduledAt string `json:"scheduled_at,omitempty"`
}

type MediaUsage struct {
	Usage []MediaUsageItem `json:"usage"`
	Count int              `json:"count"`
}

func (c *Client) ListMedia(ctx context.Context, workspaceID string, limit int) ([]MediaListItem, error) {
	v := url.Values{}
	v.Set("workspace_id", workspaceID)
	if limit > 0 {
		v.Set("limit", strconv.Itoa(limit))
	}
	var out struct {
		Media []MediaListItem `json:"media"`
		Total int             `json:"total"`
	}
	if err := c.GetJSON(ctx, "/api/v1/media?"+v.Encode(), &out); err != nil {
		return nil, err
	}
	return out.Media, nil
}

// UploadMedia uploads a local file to the active workspace using the multipart media endpoint.
func (c *Client) UploadMedia(ctx context.Context, workspaceID, filePath, altText string) (*Media, error) {
	fields := map[string]string{"workspace_id": workspaceID}
	if altText != "" {
		fields["alt_text"] = altText
	}
	var m Media
	if err := c.PostForm(ctx, "/api/v1/media/upload", "file", filePath, fields, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) DeleteMedia(ctx context.Context, mediaID string) error {
	return c.DeleteJSON(ctx, "/api/v1/media/"+url.PathEscape(mediaID), nil)
}

func (c *Client) UpdateMedia(ctx context.Context, mediaID, altText string) error {
	return c.PatchJSON(ctx, "/api/v1/media/"+url.PathEscape(mediaID), map[string]string{"alt_text": altText}, nil)
}

func (c *Client) GetMediaStorage(ctx context.Context, workspaceID string) (*MediaStorage, error) {
	v := url.Values{}
	v.Set("workspace_id", workspaceID)
	var out MediaStorage
	if err := c.GetJSON(ctx, "/api/v1/media/storage?"+v.Encode(), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetMediaUsage(ctx context.Context, mediaID string) (*MediaUsage, error) {
	var out MediaUsage
	if err := c.GetJSON(ctx, "/api/v1/media/"+url.PathEscape(mediaID)+"/usage", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ----- Posts -----

type PostDestination struct {
	SocialAccountID string `json:"social_account_id"`
	Platform        string `json:"platform"`
	Status          string `json:"status"`
	ErrorMessage    string `json:"error_message,omitempty"`
	ErrorKind       string `json:"error_kind,omitempty"`
	ErrorCode       string `json:"error_code,omitempty"`
	ErrorHTTPStatus int    `json:"error_http_status,omitempty"`
	ErrorRetryable  bool   `json:"error_retryable"`
	ErrorRetryAt    string `json:"error_retry_at,omitempty"`
	ErrorAction     string `json:"error_action,omitempty"`
}

type Post struct {
	ID                 string            `json:"id"`
	PublicationID      string            `json:"publication_id,omitempty"`
	WorkspaceID        string            `json:"workspace_id"`
	CreatedBy          string            `json:"created_by"`
	Content            string            `json:"content"`
	Status             string            `json:"status"`
	Revision           int               `json:"revision"`
	ScheduledAt        string            `json:"scheduled_at"`
	ActualRunAt        string            `json:"actual_run_at,omitempty"`
	CreatedAt          string            `json:"created_at"`
	UpdatedAt          string            `json:"updated_at"`
	RandomDelayMinutes int               `json:"random_delay_minutes"`
	Destinations       []PostDestination `json:"destinations,omitempty"`
	MediaIDs           []string          `json:"media_ids,omitempty"`
	Media              []PostMedia       `json:"media,omitempty"`
	ThreadDraft        *string           `json:"thread_draft,omitempty"`
	Renditions         []PostRendition   `json:"renditions"`
}

type PostRendition struct {
	ID                string   `json:"id"`
	SocialAccountID   string   `json:"social_account_id"`
	Content           string   `json:"content"`
	MediaIDs          []string `json:"media_ids"`
	MediaMode         string   `json:"media_mode"`
	EffectiveMediaIDs []string `json:"effective_media_ids"`
	IsUnsynced        bool     `json:"is_unsynced"`
}

type TextPostPublicationInput struct {
	Title          *string                `json:"title,omitempty"`
	Intent         *string                `json:"intent,omitempty"`
	ContentProfile *string                `json:"content_profile,omitempty"`
	SourceText     *string                `json:"source_text,omitempty"`
	SourceURL      *string                `json:"source_url,omitempty"`
	Goal           *string                `json:"goal,omitempty"`
	Audience       *string                `json:"audience,omitempty"`
	ScheduledAt    *time.Time             `json:"scheduled_at,omitempty"`
	ClearSchedule  bool                   `json:"clear_schedule,omitempty"`
	Metadata       map[string]any         `json:"metadata,omitempty"`
	Segments       []TextPostSegmentInput `json:"segments,omitempty"`
	Renditions     []RenditionInput       `json:"renditions,omitempty"`
}

type TextPostSegmentInput struct {
	ID          string                  `json:"id,omitempty"`
	Body        string                  `json:"body,omitempty"`
	Title       string                  `json:"title,omitempty"`
	Description string                  `json:"description,omitempty"`
	URL         string                  `json:"url,omitempty"`
	Settings    map[string]any          `json:"settings,omitempty"`
	Media       []PublicationMediaInput `json:"media,omitempty"`
}

type TextPostVariantInput struct {
	SocialAccountID string  `json:"social_account_id"`
	Content         *string `json:"content,omitempty"`
	MediaIDs        *string `json:"media_ids,omitempty"`
	IsUnsynced      bool    `json:"is_unsynced"`
}

type CreateTextPostDraftInput struct {
	WorkspaceID        string                   `json:"workspace_id"`
	Content            string                   `json:"content"`
	ScheduledAt        *string                  `json:"scheduled_at,omitempty"`
	SocialAccountIDs   []string                 `json:"social_account_ids"`
	MediaIDs           []string                 `json:"media_ids"`
	RandomDelayMinutes int                      `json:"random_delay_minutes,omitempty"`
	ThreadDraft        *string                  `json:"thread_draft,omitempty"`
	Variants           []TextPostVariantInput   `json:"variants"`
	Publication        TextPostPublicationInput `json:"publication"`
}

type SaveTextPostDraftInput struct {
	ExpectedRevision   int                      `json:"expected_revision"`
	Force              bool                     `json:"force,omitempty"`
	Content            string                   `json:"content"`
	ScheduledAt        *string                  `json:"scheduled_at,omitempty"`
	SocialAccountIDs   []string                 `json:"social_account_ids"`
	MediaIDs           []string                 `json:"media_ids"`
	RandomDelayMinutes int                      `json:"random_delay_minutes,omitempty"`
	ThreadDraft        *string                  `json:"thread_draft,omitempty"`
	Variants           []TextPostVariantInput   `json:"variants"`
	Publication        TextPostPublicationInput `json:"publication"`
}

type TextPostDraftResult struct {
	PostID        string `json:"post_id"`
	PublicationID string `json:"publication_id"`
	Revision      int    `json:"revision"`
	UpdatedAt     string `json:"updated_at"`
}

func (c *Client) CreateTextPostDraft(ctx context.Context, in CreateTextPostDraftInput) (*TextPostDraftResult, error) {
	var out TextPostDraftResult
	if err := c.PostJSON(ctx, "/api/v1/posts/draft", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) SaveTextPostDraft(ctx context.Context, postID string, in SaveTextPostDraftInput) (*TextPostDraftResult, error) {
	var out TextPostDraftResult
	if err := c.PutJSON(ctx, "/api/v1/posts/"+url.PathEscape(postID)+"/draft", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type ListPostsInput struct {
	WorkspaceID string
	Status      string
	Date        string
	Limit       int
	Offset      int
}

func (c *Client) ListPosts(ctx context.Context, in ListPostsInput) ([]Post, error) {
	path := listEndpointPath("/api/v1/posts", in.WorkspaceID, in.Status, "date", in.Date, in.Limit, in.Offset)
	var out []Post
	if err := c.GetJSON(ctx, path, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) GetPost(ctx context.Context, id string) (*Post, error) {
	var out Post
	if err := c.GetJSON(ctx, "/api/v1/posts/"+url.PathEscape(id), &out); err != nil {
		return nil, err
	}
	var variants struct {
		Variants []struct {
			ID              string `json:"id"`
			SocialAccountID string `json:"social_account_id"`
			Content         string `json:"content"`
			MediaIDs        string `json:"media_ids"`
			IsUnsynced      bool   `json:"is_unsynced"`
		} `json:"variants"`
	}
	if err := c.GetJSON(ctx, "/api/v1/posts/"+url.PathEscape(id)+"/variants", &variants); err != nil {
		return nil, err
	}
	for _, variant := range variants.Variants {
		mediaIDs := []string{}
		mediaMode := "inherit"
		if trimmed := strings.TrimSpace(variant.MediaIDs); trimmed != "" {
			if trimmed[0] != '[' {
				return nil, fmt.Errorf("decode rendition %s media_ids: media_ids must be a JSON array", variant.ID)
			}
			if err := json.Unmarshal([]byte(trimmed), &mediaIDs); err != nil {
				return nil, fmt.Errorf("decode rendition %s media_ids: %w", variant.ID, err)
			}
			if len(mediaIDs) == 0 {
				mediaMode = "clear"
			} else {
				mediaMode = "override"
			}
		}
		effectiveMediaIDs := mediaIDs
		if mediaMode == "inherit" {
			effectiveMediaIDs = append([]string(nil), out.MediaIDs...)
			if len(effectiveMediaIDs) == 0 {
				for _, media := range out.Media {
					effectiveMediaIDs = append(effectiveMediaIDs, media.MediaID)
				}
			}
		}
		out.Renditions = append(out.Renditions, PostRendition{ID: variant.ID, SocialAccountID: variant.SocialAccountID, Content: variant.Content, MediaIDs: mediaIDs, MediaMode: mediaMode, EffectiveMediaIDs: effectiveMediaIDs, IsUnsynced: variant.IsUnsynced})
	}
	return &out, nil
}

func (c *Client) DeletePost(ctx context.Context, id string) error {
	return c.DeleteJSON(ctx, "/api/v1/posts/"+url.PathEscape(id), nil)
}

type PostMedia struct {
	MediaID      string `json:"media_id"`
	DisplayOrder int    `json:"display_order"`
	FilePath     string `json:"file_path"`
	MimeType     string `json:"mime_type"`
	AltText      string `json:"alt_text"`
}

type ThreadPostInput struct {
	Content  string   `json:"content"`
	MediaIDs []string `json:"media_ids,omitempty"`
}

type CreateThreadInput struct {
	WorkspaceID        string            `json:"workspace_id"`
	Posts              []ThreadPostInput `json:"posts"`
	ScheduledAt        *time.Time        `json:"scheduled_at,omitempty"`
	SocialAccountIDs   []string          `json:"social_account_ids"`
	RandomDelayMinutes int               `json:"random_delay_minutes,omitempty"`
}

type CreateThreadOutput struct {
	PostIDs []string `json:"post_ids"`
}

func (c *Client) CreateThread(ctx context.Context, in CreateThreadInput) (*CreateThreadOutput, error) {
	var out CreateThreadOutput
	if err := c.PostJSON(ctx, "/api/v1/posts/thread", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ----- Publications -----

type PublicationMediaInput struct {
	MediaID string `json:"media_id"`
	Role    string `json:"role,omitempty"`
	AltText string `json:"alt_text,omitempty"`
}

type RenditionInput struct {
	SocialAccountID string                  `json:"social_account_id"`
	Profile         string                  `json:"profile,omitempty"`
	Body            string                  `json:"body,omitempty"`
	Title           string                  `json:"title,omitempty"`
	Description     string                  `json:"description,omitempty"`
	Settings        map[string]interface{}  `json:"settings,omitempty"`
	Media           []PublicationMediaInput `json:"media,omitempty"`
}

type CreatePublicationInput struct {
	WorkspaceID      string                  `json:"workspace_id"`
	Title            string                  `json:"title"`
	ContentProfile   string                  `json:"content_profile"`
	SourceText       string                  `json:"source_text"`
	SourceURL        string                  `json:"source_url,omitempty"`
	Goal             string                  `json:"goal,omitempty"`
	Audience         string                  `json:"audience,omitempty"`
	ScheduledAt      *time.Time              `json:"scheduled_at,omitempty"`
	Metadata         map[string]interface{}  `json:"metadata,omitempty"`
	SocialAccountIDs []string                `json:"social_account_ids,omitempty"`
	Media            []PublicationMediaInput `json:"media,omitempty"`
	Renditions       []RenditionInput        `json:"renditions,omitempty"`
}

type UpdatePublicationInput struct {
	ExpectedRevision int                    `json:"expected_revision"`
	Force            bool                   `json:"force,omitempty"`
	Title            *string                `json:"title,omitempty"`
	ContentProfile   *string                `json:"content_profile,omitempty"`
	SourceText       *string                `json:"source_text,omitempty"`
	SourceURL        *string                `json:"source_url,omitempty"`
	Goal             *string                `json:"goal,omitempty"`
	Audience         *string                `json:"audience,omitempty"`
	ScheduledAt      *time.Time             `json:"scheduled_at,omitempty"`
	ClearSchedule    bool                   `json:"clear_schedule,omitempty"`
	Metadata         map[string]interface{} `json:"metadata,omitempty"`
}

type Publication struct {
	ID             string                 `json:"id"`
	TextPostID     string                 `json:"text_post_id,omitempty"`
	WorkspaceID    string                 `json:"workspace_id"`
	CreatedBy      string                 `json:"created_by"`
	Title          string                 `json:"title"`
	Intent         string                 `json:"intent"`
	ContentProfile string                 `json:"content_profile"`
	SourceText     string                 `json:"source_text"`
	SourceURL      string                 `json:"source_url,omitempty"`
	Goal           string                 `json:"goal,omitempty"`
	Audience       string                 `json:"audience,omitempty"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
	Status         string                 `json:"status"`
	Revision       int                    `json:"revision"`
	ScheduledAt    string                 `json:"scheduled_at,omitempty"`
	ActualRunAt    string                 `json:"actual_run_at,omitempty"`
	CreatedAt      string                 `json:"created_at"`
	UpdatedAt      string                 `json:"updated_at"`
	Renditions     []Rendition            `json:"renditions"`
}

type Rendition struct {
	ID              string                 `json:"id"`
	SocialAccountID string                 `json:"social_account_id"`
	Platform        string                 `json:"platform"`
	Profile         string                 `json:"profile"`
	Body            string                 `json:"body"`
	Title           string                 `json:"title"`
	Description     string                 `json:"description"`
	Settings        map[string]interface{} `json:"settings"`
	Status          string                 `json:"status"`
	ExternalID      string                 `json:"external_id,omitempty"`
	ExternalURL     string                 `json:"external_url,omitempty"`
	ErrorMessage    string                 `json:"error_message,omitempty"`
	ErrorKind       string                 `json:"error_kind,omitempty"`
	ErrorCode       string                 `json:"error_code,omitempty"`
	ErrorHTTPStatus int                    `json:"error_http_status,omitempty"`
	ErrorRetryable  bool                   `json:"error_retryable"`
	ErrorRetryAt    string                 `json:"error_retry_at,omitempty"`
	ErrorAction     string                 `json:"error_action,omitempty"`
}

type ListPublicationsInput struct {
	WorkspaceID    string
	Status         string
	ContentProfile string
	Limit          int
	Offset         int
}

type ValidationIssue struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
	Provider string `json:"provider,omitempty"`
	Profile  string `json:"profile,omitempty"`
	Field    string `json:"field,omitempty"`
}

type PublicationValidation struct {
	Valid  bool              `json:"valid"`
	Issues []ValidationIssue `json:"issues"`
}

type PublicationActionOutput struct {
	Message  string `json:"message"`
	JobID    string `json:"job_id,omitempty"`
	Revision int    `json:"revision,omitempty"`
}

type RenditionReplyInput struct {
	Body     string                  `json:"body"`
	ParentID string                  `json:"parent_id,omitempty"`
	Settings map[string]interface{}  `json:"settings,omitempty"`
	Media    []PublicationMediaInput `json:"media,omitempty"`
	RunAt    *time.Time              `json:"run_at,omitempty"`
}

type CommentActionOutput struct {
	Message string `json:"message"`
	ID      string `json:"id,omitempty"`
}

type PublicationLifecycleEvent struct {
	ID             string         `json:"id"`
	WorkspaceID    string         `json:"workspace_id"`
	PublicationID  string         `json:"publication_id"`
	RenditionID    string         `json:"rendition_id,omitempty"`
	Type           string         `json:"type"`
	Status         string         `json:"status"`
	Message        string         `json:"message"`
	Metadata       map[string]any `json:"metadata"`
	IdempotencyKey string         `json:"idempotency_key,omitempty"`
	CreatedAt      string         `json:"created_at"`
}

type Comment struct {
	ID                string `json:"id"`
	RenditionID       string `json:"rendition_id"`
	ProviderCommentID string `json:"provider_comment_id"`
	AuthorID          string `json:"author_id,omitempty"`
	AuthorName        string `json:"author_name,omitempty"`
	AuthorAvatarURL   string `json:"author_avatar_url,omitempty"`
	Text              string `json:"text"`
	CreatedAt         string `json:"created_at,omitempty"`
	Hidden            bool   `json:"hidden"`
	CanReply          bool   `json:"can_reply"`
	CanHide           bool   `json:"can_hide"`
	CanDelete         bool   `json:"can_delete"`
}

func (c *Client) CreatePublication(ctx context.Context, in CreatePublicationInput) (*Publication, error) {
	var out Publication
	if err := c.PostJSON(ctx, "/api/v1/publications", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListPublications(ctx context.Context, in ListPublicationsInput) ([]Publication, error) {
	path := listEndpointPath(
		"/api/v1/publications",
		in.WorkspaceID,
		in.Status,
		"content_profile",
		in.ContentProfile,
		in.Limit,
		in.Offset,
	)
	var out []Publication
	if err := c.GetJSON(ctx, path, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) GetPublication(ctx context.Context, id string) (*Publication, error) {
	var out Publication
	if err := c.GetJSON(ctx, "/api/v1/publications/"+url.PathEscape(id), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpdatePublication(ctx context.Context, id string, in UpdatePublicationInput) (*Publication, error) {
	var out Publication
	if err := c.PutJSON(ctx, "/api/v1/publications/"+url.PathEscape(id), in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpsertPublicationRenditions(ctx context.Context, id string, expectedRevision int, renditions []RenditionInput) (*Publication, error) {
	var out Publication
	if err := c.PutJSON(ctx, "/api/v1/publications/"+url.PathEscape(id)+"/renditions", map[string]any{
		"expected_revision": expectedRevision,
		"renditions":        renditions,
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ReplyToRendition(ctx context.Context, id string, in RenditionReplyInput) (*PublicationActionOutput, error) {
	var out PublicationActionOutput
	if err := c.PostJSON(ctx, "/api/v1/renditions/"+url.PathEscape(id)+"/reply", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ValidatePublication(ctx context.Context, id string) (*PublicationValidation, error) {
	var out PublicationValidation
	if err := c.PostJSON(ctx, "/api/v1/publications/"+url.PathEscape(id)+"/validate", map[string]any{}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) PublishPublicationNow(ctx context.Context, id string, expectedRevision int) (*PublicationActionOutput, error) {
	var out PublicationActionOutput
	if err := c.PostJSON(ctx, "/api/v1/publications/"+url.PathEscape(id)+"/publish-now", map[string]any{"expected_revision": expectedRevision}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) SchedulePublication(ctx context.Context, id string, expectedRevision int) (*PublicationActionOutput, error) {
	var out PublicationActionOutput
	if err := c.PostJSON(ctx, "/api/v1/publications/"+url.PathEscape(id)+"/schedule", map[string]any{"expected_revision": expectedRevision}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeletePublication(ctx context.Context, id string, expectedRevision int) (*PublicationActionOutput, error) {
	path := "/api/v1/publications/" + url.PathEscape(id)
	query := url.Values{}
	query.Set("confirm", "true")
	query.Set("expected_revision", strconv.Itoa(expectedRevision))
	var out PublicationActionOutput
	if err := c.DeleteJSON(ctx, path+"?"+query.Encode(), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeletePublicationRendition(ctx context.Context, id, accountID string, expectedRevision int) (*PublicationActionOutput, error) {
	path := "/api/v1/publications/" + url.PathEscape(id) + "/renditions/" + url.PathEscape(accountID)
	query := url.Values{}
	query.Set("confirm", "true")
	query.Set("expected_revision", strconv.Itoa(expectedRevision))
	var out PublicationActionOutput
	if err := c.DeleteJSON(ctx, path+"?"+query.Encode(), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) RetryPublicationRendition(ctx context.Context, id, accountID string) (*PublicationActionOutput, error) {
	var out PublicationActionOutput
	path := "/api/v1/publications/" + url.PathEscape(id) + "/renditions/" + url.PathEscape(accountID) + "/retry"
	if err := c.PostJSON(ctx, path, map[string]any{}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListPublicationEvents(ctx context.Context, id string, limit int) ([]PublicationLifecycleEvent, error) {
	path := "/api/v1/publications/" + url.PathEscape(id) + "/events"
	if limit > 0 {
		v := url.Values{}
		v.Set("limit", strconv.Itoa(limit))
		path += "?" + v.Encode()
	}
	var out []PublicationLifecycleEvent
	if err := c.GetJSON(ctx, path, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) ListRenditionComments(ctx context.Context, renditionID string) ([]Comment, error) {
	var out struct {
		Comments []Comment `json:"comments"`
	}
	if err := c.GetJSON(ctx, "/api/v1/renditions/"+url.PathEscape(renditionID)+"/comments", &out); err != nil {
		return nil, err
	}
	return out.Comments, nil
}

func (c *Client) ReplyToComment(ctx context.Context, commentID, body string) (*CommentActionOutput, error) {
	var out CommentActionOutput
	if err := c.PostJSON(ctx, "/api/v1/comments/"+url.PathEscape(commentID)+"/reply", map[string]string{"body": body}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) HideComment(ctx context.Context, commentID string) (*CommentActionOutput, error) {
	var out CommentActionOutput
	if err := c.PostJSON(ctx, "/api/v1/comments/"+url.PathEscape(commentID)+"/hide", map[string]any{}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteComment(ctx context.Context, commentID string) (*CommentActionOutput, error) {
	var out CommentActionOutput
	if err := c.DeleteJSON(ctx, "/api/v1/comments/"+url.PathEscape(commentID), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ----- Auth: CLI device flow + API token management -----

type CLIAuthStartInput struct {
	ClientName      string `json:"client_name"`
	ClientVersion   string `json:"client_version"`
	ClientOS        string `json:"client_os"`
	RequestedScopes string `json:"requested_scopes"`
}

type CLIAuthStartOutput struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURL string `json:"verification_url"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

// StartCLIAuth begins a CLI device-flow session.
func (c *Client) StartCLIAuth(ctx context.Context, in CLIAuthStartInput) (*CLIAuthStartOutput, error) {
	var out CLIAuthStartOutput
	if err := c.PostJSON(ctx, "/api/v1/cli/auth/start", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type CLIAuthPollInput struct {
	DeviceCode string `json:"device_code"`
}

type CLIAuthPollOutput struct {
	Status    string    `json:"status"` // authorization_pending, approved, access_denied, expired_token
	Token     string    `json:"token,omitempty"`
	TokenID   string    `json:"token_id,omitempty"`
	ExpiresAt time.Time `json:"expires_at,omitempty"`
}

// PollCLIAuth reports the current status of a pending CLI device-flow.
func (c *Client) PollCLIAuth(ctx context.Context, deviceCode string) (*CLIAuthPollOutput, error) {
	var out CLIAuthPollOutput
	if err := c.PostJSON(ctx, "/api/v1/cli/auth/poll", CLIAuthPollInput{DeviceCode: deviceCode}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type Token struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	TokenPrefix string     `json:"token_prefix"`
	Scope       string     `json:"scope"`
	WorkspaceID string     `json:"workspace_id"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	LastUsedAt  *time.Time `json:"last_used_at,omitempty"`
	RevokedAt   *time.Time `json:"revoked_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (c *Client) ListAPITokens(ctx context.Context) ([]Token, error) {
	var out []Token
	if err := c.GetJSON(ctx, "/api/v1/api-tokens", &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) RevokeAPIToken(ctx context.Context, id string) error {
	return c.DeleteJSON(ctx, "/api/v1/api-tokens/"+id, nil)
}

// ----- Jobs -----

type Job struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Payload     string `json:"payload"`
	Status      string `json:"status"`
	RunAt       string `json:"run_at"`
	Attempts    int    `json:"attempts"`
	MaxAttempts int    `json:"max_attempts"`
	LastError   string `json:"last_error,omitempty"`
}

type ListJobsInput struct {
	Status      string
	Limit       int
	Offset      int
	WorkspaceID string
}

func (c *Client) ListJobs(ctx context.Context, in ListJobsInput) ([]Job, error) {
	v := url.Values{}
	if in.Status != "" {
		v.Set("status", in.Status)
	}
	if in.Limit > 0 {
		v.Set("limit", strconv.Itoa(in.Limit))
	}
	if in.Offset > 0 {
		v.Set("offset", strconv.Itoa(in.Offset))
	}
	if in.WorkspaceID != "" {
		v.Set("workspace_id", in.WorkspaceID)
	}
	path := "/api/v1/jobs"
	if encoded := v.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out []Job
	if err := c.GetJSON(ctx, path, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ----- helpers -----

// ErrAuthRequired is returned when a call needs a token and none is set.
var ErrAuthRequired = errors.New("not logged in: run `openpost auth login <instance>` or set OPENPOST_TOKEN")

// CheckToken returns ErrAuthRequired if c.Token is empty. Subcommands
// that always need auth (post create, account list, ...) call this
// before doing any work.
func (c *Client) CheckToken() error {
	if c.Token == "" {
		return ErrAuthRequired
	}
	return nil
}
