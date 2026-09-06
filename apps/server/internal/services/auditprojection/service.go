// Package auditprojection merges permission-safe facts from domain-owned audit
// evidence. It is a read model only; business state never depends on it.
package auditprojection

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type Source string

const (
	SourceBilling                  Source = "billing"
	SourceIdentity                 Source = "identity"
	SourceImpersonation            Source = "impersonation"
	SourceMCP                      Source = "mcp"
	SourceOrganizationLifecycle    Source = "organization_lifecycle"
	SourceOrganizationOwnership    Source = "organization_ownership"
	SourcePublicationAuthorization Source = "publication_authorization"
	SourcePublicationLifecycle     Source = "publication_lifecycle"
	SourceProviderWrite            Source = "provider_write"
	SourceWorkspaceAccess          Source = "workspace_access"
	SourceWorkspaceLifecycle       Source = "workspace_lifecycle"
)

type Result string

const (
	ResultFailed    Result = "failed"
	ResultPending   Result = "pending"
	ResultSucceeded Result = "succeeded"
)

type ResourceType string

const (
	ResourceBilling                       ResourceType = "billing"
	ResourceDomain                        ResourceType = "domain"
	ResourceIdentity                      ResourceType = "identity"
	ResourceIdentityConfiguration         ResourceType = "identity_configuration"
	ResourceImpersonation                 ResourceType = "impersonation"
	ResourceMCPToolCall                   ResourceType = "mcp_tool_call"
	ResourceOrganization                  ResourceType = "organization"
	ResourceOrganizationOwnershipTransfer ResourceType = "organization_ownership_transfer"
	ResourcePolicy                        ResourceType = "policy"
	ResourceProvider                      ResourceType = "provider"
	ResourceProviderWrite                 ResourceType = "provider_write"
	ResourcePublication                   ResourceType = "publication"
	ResourcePublicationAuthorization      ResourceType = "publication_authorization"
	ResourceReauthentication              ResourceType = "reauthentication"
	ResourceSession                       ResourceType = "session"
	ResourceWorkspaceInvitation           ResourceType = "workspace_invitation"
	ResourceWorkspaceMember               ResourceType = "workspace_member"
	ResourceWorkspace                     ResourceType = "workspace"
)

var identityResourcePrefixes = map[ResourceType]string{
	ResourceProvider:         "provider",
	ResourcePolicy:           "policy",
	ResourceDomain:           "domain",
	ResourceSession:          "session",
	ResourceIdentity:         "identity",
	ResourceReauthentication: "reauth",
}

var sourceResourceTypes = map[Source]map[ResourceType]struct{}{
	SourceBilling:                  {ResourceBilling: {}},
	SourceIdentity:                 {ResourceProvider: {}, ResourcePolicy: {}, ResourceDomain: {}, ResourceSession: {}, ResourceIdentity: {}, ResourceReauthentication: {}, ResourceIdentityConfiguration: {}},
	SourceImpersonation:            {ResourceImpersonation: {}},
	SourceMCP:                      {ResourceMCPToolCall: {}},
	SourceOrganizationLifecycle:    {ResourceOrganization: {}},
	SourceOrganizationOwnership:    {ResourceOrganizationOwnershipTransfer: {}},
	SourcePublicationAuthorization: {ResourcePublicationAuthorization: {}},
	SourcePublicationLifecycle:     {ResourcePublication: {}},
	SourceProviderWrite:            {ResourceProviderWrite: {}},
	SourceWorkspaceAccess:          {ResourceWorkspaceMember: {}, ResourceWorkspaceInvitation: {}},
	SourceWorkspaceLifecycle:       {ResourceWorkspace: {}},
}

type AuditChangedField struct {
	Field    string `json:"field"`
	Previous string `json:"previous,omitempty"`
	Current  string `json:"current,omitempty"`
}

type AuditResource struct {
	Type           ResourceType `json:"type"`
	ID             string       `json:"id,omitempty"`
	OrganizationID string       `json:"organization_id,omitempty"`
	WorkspaceID    string       `json:"workspace_id,omitempty"`
}

type AuditEvent struct {
	ID                   string              `json:"id"`
	Source               Source              `json:"source"`
	ActorUserID          string              `json:"actor_user_id,omitempty"`
	EffectiveActorUserID string              `json:"effective_actor_user_id,omitempty"`
	Action               string              `json:"action"`
	Resource             AuditResource       `json:"resource"`
	Result               Result              `json:"result"`
	ChangedFields        []AuditChangedField `json:"changed_fields"`
	OccurredAt           time.Time           `json:"occurred_at"`
}

type Cursor struct {
	OccurredAt time.Time
	Source     Source
	ID         string
}

type Query struct {
	OrganizationID string
	WorkspaceID    string
	ActorUserID    string
	Action         string
	ResourceType   ResourceType
	Result         Result
	From           time.Time
	Before         time.Time
	Limit          int
	Cursor         *Cursor
}

type Page struct {
	Items      []AuditEvent
	NextCursor *Cursor
}

type Service struct{ db *bun.DB }

func NewService(db *bun.DB) *Service { return &Service{db: db} }

func (s *Service) List(ctx context.Context, input Query) (Page, error) {
	if strings.TrimSpace(input.OrganizationID) == "" {
		return Page{}, errors.New("organization audit scope is required")
	}
	return s.list(ctx, input)
}

// ListInstance projects the same safe audit vocabulary across the whole
// instance. Authorization belongs at the HTTP boundary; this read model never
// grants access by itself.
func (s *Service) ListInstance(ctx context.Context, input Query) (Page, error) {
	return s.list(ctx, input)
}

func (s *Service) list(ctx context.Context, input Query) (Page, error) {
	limit := input.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if input.Result != "" && input.Result != ResultSucceeded && input.Result != ResultFailed && input.Result != ResultPending {
		return Page{Items: []AuditEvent{}}, nil
	}

	items := make([]AuditEvent, 0, limit*len(sourceResourceTypes))
	loaders := []struct {
		source Source
		load   func(context.Context, Query, int) ([]AuditEvent, error)
	}{
		{SourceIdentity, s.listIdentity},
		{SourceOrganizationLifecycle, s.listOrganizationLifecycle},
		{SourceOrganizationOwnership, s.listOrganizationOwnership},
		{SourceWorkspaceAccess, s.listWorkspaceAccess},
		{SourceWorkspaceLifecycle, s.listWorkspaceLifecycle},
		{SourceImpersonation, s.listImpersonation},
		{SourceBilling, s.listBilling},
		{SourceMCP, s.listMCP},
		{SourcePublicationLifecycle, s.listPublicationLifecycle},
		{SourcePublicationAuthorization, s.listPublicationAuthorization},
		{SourceProviderWrite, s.listProviderWrite},
	}
	for _, loader := range loaders {
		if !sourceSupportsResource(loader.source, input.ResourceType) || (input.WorkspaceID != "" && loader.source == SourceImpersonation) {
			continue
		}
		projected, err := loader.load(ctx, input, limit+1)
		if err != nil {
			return Page{}, err
		}
		items = append(items, projected...)
	}
	if err := s.annotateOrganizations(ctx, items, input.OrganizationID); err != nil {
		return Page{}, err
	}

	sort.Slice(items, func(i, j int) bool { return eventNewer(items[i], items[j]) })
	page := Page{Items: items}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = &Cursor{OccurredAt: last.OccurredAt, Source: last.Source, ID: last.ID}
	}
	return page, nil
}

func (s *Service) listOrganizationOwnership(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	if input.WorkspaceID != "" {
		return []AuditEvent{}, nil
	}
	var rows []models.OrganizationOwnershipAuditEvent
	query := s.db.NewSelect().Model(&rows).OrderExpr("created_at DESC, id DESC").Limit(limit)
	if input.OrganizationID != "" {
		query = query.Where("organization_id = ?", input.OrganizationID)
	}
	query = applyCommonSQLFilters(query, "created_at", "actor_user_id", "action", SourceOrganizationOwnership, input)
	if input.Result != "" {
		query = query.Where("result = ?", input.Result)
	}
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	return projectAndFilter(rows, input, projectOrganizationOwnership), nil
}

func (s *Service) listOrganizationLifecycle(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	if input.WorkspaceID != "" {
		return []AuditEvent{}, nil
	}
	var rows []models.OrganizationLifecycleAuditEvent
	query := s.db.NewSelect().Model(&rows).OrderExpr("created_at DESC, id DESC").Limit(limit)
	if input.OrganizationID != "" {
		query = query.Where("organization_id = ?", input.OrganizationID)
	}
	query = applyCommonSQLFilters(query, "created_at", "actor_user_id", "action", SourceOrganizationLifecycle, input)
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	return projectAndFilter(rows, input, projectOrganizationLifecycle), nil
}

func (s *Service) listWorkspaceLifecycle(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	var rows []models.WorkspaceLifecycleAuditEvent
	query := s.db.NewSelect().Model(&rows).OrderExpr("created_at DESC, id DESC").Limit(limit)
	if input.OrganizationID != "" {
		query = query.Where("organization_id = ?", input.OrganizationID)
	}
	query = applyWorkspaceFilter(query, "workspace_id", input)
	query = applyCommonSQLFilters(query, "created_at", "actor_user_id", "action", SourceWorkspaceLifecycle, input)
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	return projectAndFilter(rows, input, projectWorkspaceLifecycle), nil
}

func (s *Service) listIdentity(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	if input.WorkspaceID != "" {
		return []AuditEvent{}, nil
	}
	var rows []models.IdentityAuditEvent
	query := s.db.NewSelect().Model(&rows).OrderExpr("created_at DESC, id DESC").Limit(limit)
	if input.OrganizationID != "" {
		query = query.Where("(organization_id = ? OR (COALESCE(organization_id, '') = '' AND provider_id IN (SELECT id FROM identity_providers WHERE organization_id = ?)))", input.OrganizationID, input.OrganizationID)
	}
	query = applyCommonSQLFilters(query, "created_at", "actor_user_id", "action", SourceIdentity, input)
	query = applyIdentityResourceFilter(query, input.ResourceType)
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	items := projectAndFilter(rows, input, projectIdentity)
	if err := s.annotateIdentityOrganizations(ctx, rows, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) annotateIdentityOrganizations(ctx context.Context, rows []models.IdentityAuditEvent, items []AuditEvent) error {
	providerIDs := make([]string, 0)
	for _, row := range rows {
		if row.OrganizationID == "" && row.ProviderID != "" {
			providerIDs = append(providerIDs, row.ProviderID)
		}
	}
	if len(providerIDs) == 0 {
		return nil
	}
	var providers []models.IdentityProvider
	if err := s.db.NewSelect().Model(&providers).Column("id", "organization_id").Where("id IN (?)", bun.List(providerIDs)).Scan(ctx); err != nil {
		return err
	}
	organizationByProvider := make(map[string]string, len(providers))
	for _, provider := range providers {
		organizationByProvider[provider.ID] = provider.OrganizationID
	}
	organizationByEvent := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.OrganizationID == "" {
			organizationByEvent[row.ID] = organizationByProvider[row.ProviderID]
		}
	}
	for index := range items {
		if items[index].Resource.OrganizationID == "" {
			items[index].Resource.OrganizationID = organizationByEvent[items[index].ID]
		}
	}
	return nil
}

func (s *Service) listWorkspaceAccess(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	var rows []models.WorkspaceAccessAuditEvent
	query := s.db.NewSelect().Model(&rows).
		Join("JOIN workspaces AS workspace ON workspace.id = workspace_access_audit_event.workspace_id").
		OrderExpr("workspace_access_audit_event.created_at DESC, workspace_access_audit_event.id DESC").Limit(limit)
	if input.OrganizationID != "" {
		query = query.Where("workspace.organization_id = ?", input.OrganizationID)
	}
	query = applyWorkspaceFilter(query, "workspace_access_audit_event.workspace_id", input)
	query = applyCommonSQLFilters(query, "workspace_access_audit_event.created_at", "workspace_access_audit_event.actor_user_id", "workspace_access_audit_event.action", SourceWorkspaceAccess, input)
	switch input.ResourceType {
	case ResourceWorkspaceInvitation:
		query = query.Where("workspace_access_audit_event.action LIKE ?", "invitation.%")
	case ResourceWorkspaceMember:
		query = query.Where("workspace_access_audit_event.action LIKE ?", "member.%")
	}
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	return projectAndFilter(rows, input, projectWorkspaceAccess), nil
}

func (s *Service) listImpersonation(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	if input.Result != "" && input.Result != ResultSucceeded ||
		input.Action != "" && input.Action != "impersonation.grant_created" && input.Action != "impersonation.session_created" {
		return []AuditEvent{}, nil
	}
	created, err := s.listImpersonationKind(ctx, input, limit, false)
	if err != nil {
		return nil, err
	}
	consumed, err := s.listImpersonationKind(ctx, input, limit, true)
	if err != nil {
		return nil, err
	}
	return filterProjected(append(created, consumed...), input), nil
}

func (s *Service) listImpersonationKind(ctx context.Context, input Query, limit int, consumed bool) ([]AuditEvent, error) {
	suffix, action, occurredColumn := ":created", "impersonation.grant_created", "user_impersonation_grant.created_at"
	var rows []models.UserImpersonationGrant
	query := s.db.NewSelect().Model(&rows)
	if input.OrganizationID != "" {
		query = query.Join("JOIN user_impersonation_grant_organizations AS scope ON scope.grant_id = user_impersonation_grant.id").
			Where("scope.organization_id = ?", input.OrganizationID)
	}
	if consumed {
		suffix, action, occurredColumn = ":consumed", "impersonation.session_created", "user_impersonation_grant.used_at"
		query = query.Where("user_impersonation_grant.used_at IS NOT NULL")
	}
	if input.Action != "" && input.Action != action {
		return []AuditEvent{}, nil
	}
	query = query.OrderExpr(occurredColumn + " DESC, user_impersonation_grant.id DESC").Limit(limit)
	if input.ActorUserID != "" {
		query = query.Where("user_impersonation_grant.admin_user_id = ?", input.ActorUserID)
	}
	query = applyTimeRange(query, occurredColumn, input)
	query = applySourceCursor(query, occurredColumn, "user_impersonation_grant.id || '"+suffix+"'", SourceImpersonation, input.Cursor)
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	items := make([]AuditEvent, 0, len(rows))
	for _, row := range rows {
		occurred := row.CreatedAt
		if consumed {
			occurred = row.UsedAt
		}
		items = append(items, projectImpersonation(row, suffix, action, occurred))
	}
	return items, nil
}

func (s *Service) listBilling(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	var rows []models.BillingCheckoutAttempt
	query := s.db.NewSelect().Model(&rows).OrderExpr("updated_at DESC, checkout_attempt_id DESC").Limit(limit)
	if input.OrganizationID != "" {
		query = query.Where("organization_id = ?", input.OrganizationID)
	}
	query = applyWorkspaceFilter(query, "workspace_id", input)
	query = applyTimeRange(query, "updated_at", input)
	query = applySourceCursor(query, "updated_at", "checkout_attempt_id", SourceBilling, input.Cursor)
	if input.Action != "" {
		if !strings.HasPrefix(input.Action, "billing.checkout.") {
			return []AuditEvent{}, nil
		}
		query = query.Where("status = ?", strings.TrimPrefix(input.Action, "billing.checkout."))
	}
	query = applyStatusResultFilter(query, "status", input.Result)
	if input.ActorUserID != "" {
		query = query.Where("user_id = ?", input.ActorUserID)
	}
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	return projectAndFilter(rows, input, projectBilling), nil
}

func (s *Service) listMCP(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	var rows []models.MCPToolCall
	query := s.db.NewSelect().Model(&rows).
		Join("JOIN workspaces AS workspace ON workspace.id = mcp_tool_call.workspace_id").
		OrderExpr("mcp_tool_call.created_at DESC, mcp_tool_call.id DESC").Limit(limit)
	if input.OrganizationID != "" {
		query = query.Where("workspace.organization_id = ?", input.OrganizationID)
	}
	query = applyWorkspaceFilter(query, "mcp_tool_call.workspace_id", input)
	query = applyTimeRange(query, "mcp_tool_call.created_at", input)
	query = applySourceCursor(query, "mcp_tool_call.created_at", "mcp_tool_call.id", SourceMCP, input.Cursor)
	if input.Action != "" {
		if !strings.HasPrefix(input.Action, "mcp.") {
			return []AuditEvent{}, nil
		}
		query = query.Where("mcp_tool_call.tool_name = ?", strings.TrimPrefix(input.Action, "mcp."))
	}
	query = applyStatusResultFilter(query, "mcp_tool_call.status", input.Result)
	if input.ActorUserID != "" {
		query = query.Where("mcp_tool_call.user_id = ?", input.ActorUserID)
	}
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	return projectAndFilter(rows, input, projectMCP), nil
}

func (s *Service) listPublicationLifecycle(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	if input.ActorUserID != "" {
		return []AuditEvent{}, nil
	}
	var rows []models.PublicationLifecycleEvent
	query := s.workspaceEvidenceQuery(&rows, "publication_lifecycle_event", SourcePublicationLifecycle, input, limit)
	if input.Action != "" {
		query = query.Where("publication_lifecycle_event.type = ?", input.Action)
	}
	query = applyStatusResultFilter(query, "publication_lifecycle_event.status", input.Result)
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	return projectAndFilter(rows, input, projectPublicationLifecycle), nil
}

func (s *Service) listPublicationAuthorization(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	if input.Result != "" && input.Result != ResultSucceeded {
		return []AuditEvent{}, nil
	}
	var rows []models.PublicationAuthorization
	query := s.db.NewSelect().Model(&rows).
		Join("JOIN workspaces AS workspace ON workspace.id = publication_authorization.workspace_id").
		OrderExpr("publication_authorization.confirmed_at DESC, publication_authorization.id DESC").Limit(limit)
	if input.OrganizationID != "" {
		query = query.Where("workspace.organization_id = ?", input.OrganizationID)
	}
	query = applyWorkspaceFilter(query, "publication_authorization.workspace_id", input)
	query = applyTimeRange(query, "publication_authorization.confirmed_at", input)
	query = applySourceCursor(query, "publication_authorization.confirmed_at", "publication_authorization.id", SourcePublicationAuthorization, input.Cursor)
	if input.Action != "" {
		if !strings.HasPrefix(input.Action, "publication.authorization.") {
			return []AuditEvent{}, nil
		}
		query = query.Where("publication_authorization.action = ?", strings.TrimPrefix(input.Action, "publication.authorization."))
	}
	if input.ActorUserID != "" {
		query = query.Where("publication_authorization.actor_user_id = ?", input.ActorUserID)
	}
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	return projectAndFilter(rows, input, projectPublicationAuthorization), nil
}

func (s *Service) listProviderWrite(ctx context.Context, input Query, limit int) ([]AuditEvent, error) {
	if input.ActorUserID != "" {
		return []AuditEvent{}, nil
	}
	var rows []models.ProviderWriteAttempt
	query := s.workspaceEvidenceQuery(&rows, "provider_write_attempt", SourceProviderWrite, input, limit)
	if input.Action != "" {
		if !strings.HasPrefix(input.Action, "provider_write.") {
			return []AuditEvent{}, nil
		}
		query = query.Where("provider_write_attempt.operation = ?", strings.TrimPrefix(input.Action, "provider_write."))
	}
	query = applyStatusResultFilter(query, "provider_write_attempt.status", input.Result)
	if err := scan(ctx, query); err != nil {
		return nil, err
	}
	return projectAndFilter(rows, input, projectProviderWrite), nil
}

func (s *Service) workspaceEvidenceQuery(model any, alias string, source Source, input Query, limit int) *bun.SelectQuery {
	query := s.db.NewSelect().Model(model).
		Join("JOIN workspaces AS workspace ON workspace.id = " + alias + ".workspace_id").
		OrderExpr(alias + ".created_at DESC, " + alias + ".id DESC").Limit(limit)
	if input.OrganizationID != "" {
		query = query.Where("workspace.organization_id = ?", input.OrganizationID)
	}
	query = applyWorkspaceFilter(query, alias+".workspace_id", input)
	query = applyTimeRange(query, alias+".created_at", input)
	return applySourceCursor(query, alias+".created_at", alias+".id", source, input.Cursor)
}

func scan(ctx context.Context, query *bun.SelectQuery) error {
	if err := query.Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return nil
}

func applyCommonSQLFilters(query *bun.SelectQuery, createdColumn, actorColumn, actionColumn string, source Source, input Query) *bun.SelectQuery {
	if input.Action != "" {
		query = query.Where(actionColumn+" = ?", input.Action)
	}
	if input.ActorUserID != "" {
		query = query.Where(actorColumn+" = ?", input.ActorUserID)
	}
	query = applyTimeRange(query, createdColumn, input)
	return applySourceCursor(query, createdColumn, "id", source, input.Cursor)
}

func applyWorkspaceFilter(query *bun.SelectQuery, column string, input Query) *bun.SelectQuery {
	if input.WorkspaceID != "" {
		return query.Where(column+" = ?", input.WorkspaceID)
	}
	return query
}

func applyTimeRange(query *bun.SelectQuery, createdColumn string, input Query) *bun.SelectQuery {
	if !input.From.IsZero() {
		query = query.Where(createdColumn+" >= ?", input.From.UTC())
	}
	if !input.Before.IsZero() {
		query = query.Where(createdColumn+" < ?", input.Before.UTC())
	}
	return query
}

func applyStatusResultFilter(query *bun.SelectQuery, column string, result Result) *bun.SelectQuery {
	failed := []string{"failed", "error", "rejected", "canceled", "cancelled"}
	pending := []string{"pending", "created", "processing", "running", "queued", "in_progress"}
	switch result {
	case ResultFailed:
		return query.Where(column+" IN (?)", bun.List(failed))
	case ResultPending:
		return query.Where(column+" IN (?)", bun.List(pending))
	case ResultSucceeded:
		return query.Where(column+" NOT IN (?)", bun.List(append(failed, pending...)))
	default:
		return query
	}
}

func applyIdentityResourceFilter(query *bun.SelectQuery, resourceType ResourceType) *bun.SelectQuery {
	if prefix, ok := identityResourcePrefixes[resourceType]; ok {
		return query.Where("action LIKE ?", prefix+".%")
	}
	if resourceType == ResourceIdentityConfiguration {
		for _, prefix := range identityResourcePrefixes {
			query = query.Where("action NOT LIKE ?", prefix+".%")
		}
	}
	return query
}

func applySourceCursor(query *bun.SelectQuery, createdColumn, idColumn string, source Source, cursor *Cursor) *bun.SelectQuery {
	if cursor == nil {
		return query
	}
	if source < cursor.Source {
		return query.Where(createdColumn+" <= ?", cursor.OccurredAt.UTC())
	}
	if source > cursor.Source {
		return query.Where(createdColumn+" < ?", cursor.OccurredAt.UTC())
	}
	return query.Where("("+createdColumn+" < ? OR ("+createdColumn+" = ? AND "+idColumn+" < ?))", cursor.OccurredAt.UTC(), cursor.OccurredAt.UTC(), cursor.ID)
}

func projectIdentity(row models.IdentityAuditEvent) AuditEvent {
	resourceType := identityResourceType(row.Action)
	resourceID := row.ProviderID
	if resourceID == "" && (resourceType == ResourceIdentity || resourceType == ResourceSession || resourceType == ResourceReauthentication) {
		resourceID = row.SubjectUserID
	}
	changed := []AuditChangedField{}
	switch row.Action {
	case "policy.updated":
		if mode := safeEnum(row.Detail, "disabled", "optional", "required"); mode != "" {
			changed = append(changed, AuditChangedField{Field: "mode", Current: mode})
		}
	case "domain.verified":
		if domain := safeDomain(row.Detail); domain != "" {
			changed = append(changed, AuditChangedField{Field: "domain", Current: domain})
		}
	}
	event := newEvent(row.ID, SourceIdentity, row.ActorUserID, "", row.Action, resourceType, resourceID, "", ResultSucceeded, changed, row.CreatedAt)
	event.Resource.OrganizationID = row.OrganizationID
	return event
}

func projectWorkspaceAccess(row models.WorkspaceAccessAuditEvent) AuditEvent {
	resourceType, resourceID := ResourceWorkspaceMember, row.SubjectUserID
	if strings.HasPrefix(row.Action, "invitation.") {
		resourceType, resourceID = ResourceWorkspaceInvitation, row.InvitationID
	}
	changed := compactChangedFields([]AuditChangedField{
		{Field: "role", Previous: safeRole(row.PreviousRole), Current: safeRole(row.Role)},
		{Field: "status", Previous: safeStatus(row.PreviousStatus), Current: safeStatus(row.Status)},
	})
	return newEvent(row.ID, SourceWorkspaceAccess, row.ActorUserID, "", row.Action, resourceType, resourceID, row.WorkspaceID, ResultSucceeded, changed, row.CreatedAt)
}

func projectOrganizationOwnership(row models.OrganizationOwnershipAuditEvent) AuditEvent {
	result := ResultSucceeded
	if row.Result == string(ResultFailed) {
		result = ResultFailed
	}
	event := newEvent(
		row.ID,
		SourceOrganizationOwnership,
		row.ActorUserID,
		"",
		safeAction(row.Action, "ownership_transfer.unknown"),
		ResourceOrganizationOwnershipTransfer,
		row.TransferID,
		"",
		result,
		[]AuditChangedField{{Field: "nominee_user_id", Current: row.NomineeUserID}},
		row.CreatedAt,
	)
	event.Resource.OrganizationID = row.OrganizationID
	return event
}

func projectOrganizationLifecycle(row models.OrganizationLifecycleAuditEvent) AuditEvent {
	event := newEvent(row.ID, SourceOrganizationLifecycle, row.ActorUserID, "", row.Action, ResourceOrganization, row.OrganizationID, "", ResultSucceeded, []AuditChangedField{{Field: "name", Previous: row.OrganizationName}, {Field: "workspace_count", Previous: fmt.Sprintf("%d", row.WorkspaceCount)}, {Field: "billing_state", Previous: safeEnum(row.BillingState, "none", "active", "trialing", "past_due", "paused", "canceled", "cancelled")}}, row.CreatedAt)
	event.Resource.OrganizationID = row.OrganizationID
	return event
}

func projectWorkspaceLifecycle(row models.WorkspaceLifecycleAuditEvent) AuditEvent {
	event := newEvent(row.ID, SourceWorkspaceLifecycle, row.ActorUserID, "", row.Action, ResourceWorkspace, row.WorkspaceID, row.WorkspaceID, ResultSucceeded, []AuditChangedField{{Field: "name", Previous: row.WorkspaceName}}, row.CreatedAt)
	event.Resource.OrganizationID = row.OrganizationID
	return event
}

func projectImpersonation(row models.UserImpersonationGrant, suffix, action string, occurred time.Time) AuditEvent {
	return newEvent(row.ID+suffix, SourceImpersonation, row.AdminUserID, row.TargetUserID, action, ResourceImpersonation, row.ID, "", ResultSucceeded, nil, occurred)
}

func projectBilling(row models.BillingCheckoutAttempt) AuditEvent {
	event := newEvent(row.CheckoutAttemptID, SourceBilling, row.UserID, "", "billing.checkout."+safeActionPart(row.Status), ResourceBilling, row.CheckoutAttemptID, row.WorkspaceID, resultFromStatus(row.Status), nil, row.UpdatedAt)
	event.Resource.OrganizationID = row.OrganizationID
	return event
}

func (s *Service) annotateOrganizations(ctx context.Context, items []AuditEvent, scopedOrganizationID string) error {
	workspaceIDs := make([]string, 0)
	for index := range items {
		if items[index].Resource.OrganizationID == "" && scopedOrganizationID != "" {
			items[index].Resource.OrganizationID = scopedOrganizationID
		}
		if items[index].Resource.OrganizationID == "" && items[index].Resource.WorkspaceID != "" {
			workspaceIDs = append(workspaceIDs, items[index].Resource.WorkspaceID)
		}
	}
	if len(workspaceIDs) == 0 {
		return nil
	}
	var workspaces []models.Workspace
	if err := s.db.NewSelect().Model(&workspaces).Column("id", "organization_id").Where("id IN (?)", bun.List(workspaceIDs)).Scan(ctx); err != nil {
		return err
	}
	organizationByWorkspace := make(map[string]string, len(workspaces))
	for _, workspace := range workspaces {
		organizationByWorkspace[workspace.ID] = workspace.OrganizationID
	}
	for index := range items {
		if items[index].Resource.OrganizationID == "" {
			items[index].Resource.OrganizationID = organizationByWorkspace[items[index].Resource.WorkspaceID]
		}
	}
	return nil
}

func projectMCP(row models.MCPToolCall) AuditEvent {
	return newEvent(row.ID, SourceMCP, row.UserID, "", "mcp."+safeActionPart(row.ToolName), ResourceMCPToolCall, row.ID, row.WorkspaceID, resultFromStatus(row.Status), nil, row.CreatedAt)
}

func projectPublicationLifecycle(row models.PublicationLifecycleEvent) AuditEvent {
	return newEvent(row.ID, SourcePublicationLifecycle, "", "", safeAction(row.Type, "publication.lifecycle"), ResourcePublication, row.PublicationID, row.WorkspaceID, resultFromStatus(row.Status), nil, row.CreatedAt)
}

func projectPublicationAuthorization(row models.PublicationAuthorization) AuditEvent {
	return newEvent(row.ID, SourcePublicationAuthorization, row.ActorUserID, "", "publication.authorization."+safeActionPart(row.Action), ResourcePublicationAuthorization, row.ID, row.WorkspaceID, ResultSucceeded, nil, row.ConfirmedAt)
}

func projectProviderWrite(row models.ProviderWriteAttempt) AuditEvent {
	return newEvent(row.ID, SourceProviderWrite, "", "", "provider_write."+safeActionPart(row.Operation), ResourceProviderWrite, row.ID, row.WorkspaceID, resultFromStatus(row.Status), nil, row.CreatedAt)
}

func newEvent(id string, source Source, actor, effectiveActor, action string, resourceType ResourceType, resourceID, workspaceID string, result Result, changed []AuditChangedField, occurred time.Time) AuditEvent {
	if changed == nil {
		changed = []AuditChangedField{}
	}
	return AuditEvent{ID: id, Source: source, ActorUserID: actor, EffectiveActorUserID: effectiveActor, Action: action, Resource: AuditResource{Type: resourceType, ID: resourceID, WorkspaceID: workspaceID}, Result: result, ChangedFields: changed, OccurredAt: occurred.UTC()}
}

func projectAndFilter[T any](rows []T, input Query, project func(T) AuditEvent) []AuditEvent {
	items := make([]AuditEvent, 0, len(rows))
	for _, row := range rows {
		items = append(items, project(row))
	}
	return filterProjected(items, input)
}

func filterProjected(items []AuditEvent, input Query) []AuditEvent {
	result := make([]AuditEvent, 0, len(items))
	for _, item := range items {
		if !matchesProjectedEvent(item, input) {
			continue
		}
		result = append(result, item)
	}
	return result
}

func matchesProjectedEvent(item AuditEvent, input Query) bool {
	return optionalStringMatches(input.WorkspaceID, item.Resource.WorkspaceID) &&
		optionalStringMatches(input.ActorUserID, item.ActorUserID) &&
		optionalStringMatches(input.Action, item.Action) &&
		(input.ResourceType == "" || item.Resource.Type == input.ResourceType) &&
		(input.Result == "" || item.Result == input.Result) &&
		(input.From.IsZero() || !item.OccurredAt.Before(input.From)) &&
		(input.Before.IsZero() || item.OccurredAt.Before(input.Before)) &&
		(input.Cursor == nil || eventOlderThanCursor(item, *input.Cursor))
}

func optionalStringMatches(filter, value string) bool { return filter == "" || value == filter }

func sourceSupportsResource(source Source, resourceType ResourceType) bool {
	if resourceType == "" {
		return true
	}
	_, ok := sourceResourceTypes[source][resourceType]
	return ok
}

func IsValidSource(source Source) bool {
	_, ok := sourceResourceTypes[source]
	return ok
}

func identityResourceType(action string) ResourceType {
	prefix := strings.SplitN(action, ".", 2)[0]
	for resourceType, candidate := range identityResourcePrefixes {
		if prefix == candidate {
			return resourceType
		}
	}
	return ResourceIdentityConfiguration
}

func resultFromStatus(status string) Result {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "failed", "error", "rejected", "canceled", "cancelled":
		return ResultFailed
	case "pending", "created", "processing", "running", "queued", "in_progress":
		return ResultPending
	default:
		return ResultSucceeded
	}
}

func safeAction(value, fallback string) string {
	parts := strings.Split(value, ".")
	for i, part := range parts {
		parts[i] = safeActionPart(part)
		if parts[i] == "unknown" {
			return fallback
		}
	}
	if len(parts) == 0 {
		return fallback
	}
	return strings.Join(parts, ".")
}

func safeActionPart(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || len(value) > 100 {
		return "unknown"
	}
	for _, r := range value {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return "unknown"
		}
	}
	return value
}

func safeEnum(value string, allowed ...string) string {
	value = strings.TrimSpace(value)
	for _, candidate := range allowed {
		if value == candidate {
			return value
		}
	}
	return ""
}

func safeRole(value string) string {
	return safeEnum(value, "owner", "admin", "member", "editor", "viewer")
}
func safeStatus(value string) string {
	return safeEnum(value, "active", "inactive", "removed", "pending", "accepted", "revoked", "expired")
}

func safeDomain(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || len(value) > 253 || strings.ContainsAny(value, "/:@ ") || !strings.Contains(value, ".") {
		return ""
	}
	return value
}

func compactChangedFields(fields []AuditChangedField) []AuditChangedField {
	result := make([]AuditChangedField, 0, len(fields))
	for _, field := range fields {
		if field.Previous != "" || field.Current != "" {
			result = append(result, field)
		}
	}
	return result
}

func eventOlderThanCursor(item AuditEvent, cursor Cursor) bool {
	if !item.OccurredAt.Equal(cursor.OccurredAt) {
		return item.OccurredAt.Before(cursor.OccurredAt)
	}
	if item.Source != cursor.Source {
		return item.Source < cursor.Source
	}
	return item.ID < cursor.ID
}

func eventNewer(left, right AuditEvent) bool {
	if !left.OccurredAt.Equal(right.OccurredAt) {
		return left.OccurredAt.After(right.OccurredAt)
	}
	if left.Source != right.Source {
		return left.Source > right.Source
	}
	return left.ID > right.ID
}
