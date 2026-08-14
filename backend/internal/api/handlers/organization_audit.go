package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auditprojection"
)

type AuditFilterInput struct {
	WorkspaceID  string `query:"workspace_id" doc:"Restrict evidence to one Workspace"`
	ActorUserID  string `query:"actor_user_id" doc:"Restrict evidence to one opaque actor user ID"`
	Action       string `query:"action" maxLength:"100" doc:"Restrict evidence to one exact domain action"`
	ResourceType string `query:"resource_type" enum:"provider,policy,domain,session,identity,reauthentication,identity_configuration,workspace,workspace_member,workspace_invitation,impersonation,billing,mcp_tool_call,publication,publication_authorization,provider_write" doc:"Restrict evidence to one resource type"`
	Result       string `query:"result" enum:"succeeded,failed,pending" doc:"Restrict evidence to one result"`
	From         string `query:"from" doc:"Inclusive RFC 3339 start time"`
	Before       string `query:"before" doc:"Exclusive RFC 3339 end time"`
	Cursor       string `query:"cursor" doc:"Opaque cursor for stable older-page pagination"`
	Limit        int    `query:"limit" minimum:"1" maximum:"200" default:"50" doc:"Maximum events to return"`
}

type OrganizationAuditInput struct {
	PathID string `path:"id" doc:"Organization ID"`
	AuditFilterInput
}

type InstanceAuditInput struct {
	OrganizationID string `query:"organization_id" doc:"Restrict evidence to one Organization"`
	AuditFilterInput
}

type AuditPage struct {
	Items      []auditprojection.AuditEvent `json:"items"`
	NextCursor string                       `json:"next_cursor,omitempty"`
}

type AuditOutput struct {
	Body AuditPage
}

// OrganizationAuditResource and OrganizationAuditEvent preserve the public
// Organization audit schema names introduced with the scoped audit endpoint.
// The instance endpoint uses the neutral auditprojection schemas above.
type OrganizationAuditResource struct {
	Type           auditprojection.ResourceType `json:"type"`
	ID             string                       `json:"id,omitempty"`
	OrganizationID string                       `json:"organization_id,omitempty"`
	WorkspaceID    string                       `json:"workspace_id,omitempty"`
}

type OrganizationAuditEvent struct {
	ID                   string                              `json:"id"`
	Source               auditprojection.Source              `json:"source"`
	ActorUserID          string                              `json:"actor_user_id,omitempty"`
	EffectiveActorUserID string                              `json:"effective_actor_user_id,omitempty"`
	Action               string                              `json:"action"`
	Resource             OrganizationAuditResource           `json:"resource"`
	Result               auditprojection.Result              `json:"result"`
	ChangedFields        []auditprojection.AuditChangedField `json:"changed_fields"`
	OccurredAt           time.Time                           `json:"occurred_at"`
}

type OrganizationAuditPage struct {
	Items      []OrganizationAuditEvent `json:"items"`
	NextCursor string                   `json:"next_cursor,omitempty"`
}

type OrganizationAuditOutput struct {
	Body OrganizationAuditPage
}

type OrganizationAuditJSONExport struct {
	FormatVersion  string                   `json:"format_version"`
	OrganizationID string                   `json:"organization_id"`
	GeneratedAt    time.Time                `json:"generated_at"`
	Items          []OrganizationAuditEvent `json:"items"`
}

type InstanceAuditJSONExport struct {
	FormatVersion string                       `json:"format_version"`
	GeneratedAt   time.Time                    `json:"generated_at"`
	Items         []auditprojection.AuditEvent `json:"items"`
}

type InstanceAuditJSONExportOutput struct {
	ContentDisposition string                  `header:"Content-Disposition"`
	Body               InstanceAuditJSONExport `json:"body"`
}

type OrganizationAuditJSONExportOutput struct {
	ContentDisposition string                      `header:"Content-Disposition"`
	Body               OrganizationAuditJSONExport `json:"body"`
}

type OrganizationAuditCSVExportOutput struct {
	ContentType        string `header:"Content-Type"`
	ContentDisposition string `header:"Content-Disposition"`
	Body               []byte
}

type auditCursorPayload struct {
	OccurredAt time.Time              `json:"occurred_at"`
	Source     auditprojection.Source `json:"source"`
	ID         string                 `json:"id"`
}

func (h *WorkspaceHandler) ListOrganizationAudit(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-organization-audit-events", Method: http.MethodGet,
		Path: "/organizations/{id}/audit-events", Summary: "List permission-safe Organization audit evidence",
		Description: "Projects consequential Organization and Workspace evidence without exposing Workspace content, secrets, credentials, invitation links, or provider payloads. Requires the Organization Owner.",
		Tags:        []string{tagWorkspaces}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors: []int{400, 403, 500},
	}, func(ctx context.Context, input *OrganizationAuditInput) (*OrganizationAuditOutput, error) {
		query, err := h.authorizedOrganizationAuditQuery(ctx, input)
		if err != nil {
			return nil, err
		}
		page, err := h.audit.List(ctx, query)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to project organization audit evidence")
		}
		return &OrganizationAuditOutput{Body: OrganizationAuditPage{
			Items: organizationAuditEvents(page.Items), NextCursor: encodeAuditCursor(page.NextCursor),
		}}, nil
	})
}

func (h *WorkspaceHandler) ExportOrganizationAudit(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "export-organization-audit-events-json", Method: http.MethodGet,
		Path: "/organizations/{id}/audit-events/export.json", Summary: "Export permission-safe Organization audit evidence as JSON",
		Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors: []int{400, 403, 500},
	}, func(ctx context.Context, input *OrganizationAuditInput) (*OrganizationAuditJSONExportOutput, error) {
		query, err := h.authorizedOrganizationAuditQuery(ctx, input)
		if err != nil {
			return nil, err
		}
		items, err := collectAuditExport(ctx, query, h.audit.List)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to export organization audit evidence")
		}
		return &OrganizationAuditJSONExportOutput{
			ContentDisposition: fmt.Sprintf("attachment; filename=%q", "openpost-organization-audit-"+time.Now().UTC().Format("2006-01-02")+".json"),
			Body:               OrganizationAuditJSONExport{FormatVersion: "1", OrganizationID: input.PathID, GeneratedAt: time.Now().UTC(), Items: organizationAuditEvents(items)},
		}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "export-organization-audit-events-csv", Method: http.MethodGet,
		Path: "/organizations/{id}/audit-events/export.csv", Summary: "Export permission-safe Organization audit evidence as CSV",
		Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors: []int{400, 403, 500},
		Responses: map[string]*huma.Response{
			"200": {Description: "CSV audit export", Content: map[string]*huma.MediaType{
				"text/csv": {Schema: &huma.Schema{Type: "string", Format: "binary"}},
			}},
		},
	}, func(ctx context.Context, input *OrganizationAuditInput) (*OrganizationAuditCSVExportOutput, error) {
		query, err := h.authorizedOrganizationAuditQuery(ctx, input)
		if err != nil {
			return nil, err
		}
		items, err := collectAuditExport(ctx, query, h.audit.List)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to export organization audit evidence")
		}
		body, err := auditCSV(items)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to encode organization audit evidence")
		}
		return &OrganizationAuditCSVExportOutput{
			ContentType:        "text/csv; charset=utf-8",
			ContentDisposition: fmt.Sprintf("attachment; filename=%q", "openpost-organization-audit-"+time.Now().UTC().Format("2006-01-02")+".csv"),
			Body:               body,
		}, nil
	})
}

func (h *WorkspaceHandler) ListInstanceAudit(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-instance-audit-events", Method: http.MethodGet,
		Path: "/admin/audit-events", Summary: "List permission-safe instance audit evidence",
		Description: "Projects consequential evidence across the instance without exposing Workspace content, emails, secrets, credentials, invitation links, or provider payloads. Requires an unscoped instance-administrator browser session.",
		Tags:        []string{tagWorkspaces}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors: []int{400, 403, 500},
	}, func(ctx context.Context, input *InstanceAuditInput) (*AuditOutput, error) {
		query, err := h.authorizedInstanceAuditQuery(ctx, input)
		if err != nil {
			return nil, err
		}
		page, err := h.audit.ListInstance(ctx, query)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to project instance audit evidence")
		}
		return &AuditOutput{Body: AuditPage{Items: page.Items, NextCursor: encodeAuditCursor(page.NextCursor)}}, nil
	})
}

func (h *WorkspaceHandler) ExportInstanceAudit(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "export-instance-audit-events-json", Method: http.MethodGet,
		Path: "/admin/audit-events/export.json", Summary: "Export permission-safe instance audit evidence as JSON",
		Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{400, 403, 500},
	}, func(ctx context.Context, input *InstanceAuditInput) (*InstanceAuditJSONExportOutput, error) {
		query, err := h.authorizedInstanceAuditQuery(ctx, input)
		if err != nil {
			return nil, err
		}
		items, err := collectAuditExport(ctx, query, h.audit.ListInstance)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to export instance audit evidence")
		}
		return &InstanceAuditJSONExportOutput{
			ContentDisposition: fmt.Sprintf("attachment; filename=%q", "openpost-instance-audit-"+time.Now().UTC().Format("2006-01-02")+".json"),
			Body:               InstanceAuditJSONExport{FormatVersion: "1", GeneratedAt: time.Now().UTC(), Items: items},
		}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "export-instance-audit-events-csv", Method: http.MethodGet,
		Path: "/admin/audit-events/export.csv", Summary: "Export permission-safe instance audit evidence as CSV",
		Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{400, 403, 500},
		Responses: map[string]*huma.Response{"200": {Description: "CSV audit export", Content: map[string]*huma.MediaType{"text/csv": {Schema: &huma.Schema{Type: "string", Format: "binary"}}}}},
	}, func(ctx context.Context, input *InstanceAuditInput) (*OrganizationAuditCSVExportOutput, error) {
		query, err := h.authorizedInstanceAuditQuery(ctx, input)
		if err != nil {
			return nil, err
		}
		items, err := collectAuditExport(ctx, query, h.audit.ListInstance)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to export instance audit evidence")
		}
		body, err := auditCSV(items)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to encode instance audit evidence")
		}
		return &OrganizationAuditCSVExportOutput{ContentType: "text/csv; charset=utf-8", ContentDisposition: fmt.Sprintf("attachment; filename=%q", "openpost-instance-audit-"+time.Now().UTC().Format("2006-01-02")+".csv"), Body: body}, nil
	})
}

func (h *WorkspaceHandler) authorizedInstanceAuditQuery(ctx context.Context, input *InstanceAuditInput) (auditprojection.Query, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return auditprojection.Query{}, err
	}
	from, err := parseOrganizationAuditTime(input.From)
	if err != nil {
		return auditprojection.Query{}, huma.Error400BadRequest("from must be an RFC 3339 timestamp")
	}
	before, err := parseOrganizationAuditTime(input.Before)
	if err != nil {
		return auditprojection.Query{}, huma.Error400BadRequest("before must be an RFC 3339 timestamp")
	}
	if !from.IsZero() && !before.IsZero() && !from.Before(before) {
		return auditprojection.Query{}, huma.Error400BadRequest("from must be earlier than before")
	}
	cursor, err := decodeAuditCursor(input.Cursor)
	if err != nil {
		return auditprojection.Query{}, huma.Error400BadRequest("invalid instance audit cursor")
	}
	organizationID := strings.TrimSpace(input.OrganizationID)
	workspaceID := strings.TrimSpace(input.WorkspaceID)
	if organizationID != "" {
		exists, err := h.db.NewSelect().Model((*models.Organization)(nil)).Where("id = ?", organizationID).Exists(ctx)
		if err != nil {
			return auditprojection.Query{}, huma.Error500InternalServerError("failed to validate audit organization filter")
		}
		if !exists {
			return auditprojection.Query{}, huma.Error400BadRequest("unknown organization filter")
		}
	}
	if workspaceID != "" {
		workspace := new(models.Workspace)
		err := h.db.NewSelect().Model(workspace).Column("id", "organization_id").Where("id = ?", workspaceID).Scan(ctx)
		if err != nil {
			return auditprojection.Query{}, huma.Error400BadRequest("unknown workspace filter")
		}
		if organizationID != "" && workspace.OrganizationID != organizationID {
			return auditprojection.Query{}, huma.Error400BadRequest("workspace filter is outside the organization")
		}
	}
	return auditprojection.Query{OrganizationID: organizationID, WorkspaceID: workspaceID, ActorUserID: strings.TrimSpace(input.ActorUserID), Action: strings.TrimSpace(input.Action), ResourceType: auditprojection.ResourceType(strings.TrimSpace(input.ResourceType)), Result: auditprojection.Result(strings.TrimSpace(input.Result)), From: from, Before: before, Limit: input.Limit, Cursor: cursor}, nil
}

func collectAuditExport(ctx context.Context, query auditprojection.Query, list func(context.Context, auditprojection.Query) (auditprojection.Page, error)) ([]auditprojection.AuditEvent, error) {
	query.Limit, query.Cursor = 200, nil
	items := []auditprojection.AuditEvent{}
	for {
		page, err := list(ctx, query)
		if err != nil {
			return nil, err
		}
		items = append(items, page.Items...)
		if page.NextCursor == nil {
			return items, nil
		}
		query.Cursor = page.NextCursor
	}
}

func organizationAuditEvents(items []auditprojection.AuditEvent) []OrganizationAuditEvent {
	projected := make([]OrganizationAuditEvent, len(items))
	for index, item := range items {
		projected[index] = OrganizationAuditEvent{
			ID: item.ID, Source: item.Source, ActorUserID: item.ActorUserID,
			EffectiveActorUserID: item.EffectiveActorUserID, Action: item.Action,
			Resource: OrganizationAuditResource{
				Type: item.Resource.Type, ID: item.Resource.ID,
				OrganizationID: item.Resource.OrganizationID, WorkspaceID: item.Resource.WorkspaceID,
			},
			Result: item.Result, ChangedFields: item.ChangedFields, OccurredAt: item.OccurredAt,
		}
	}
	return projected
}

func (h *WorkspaceHandler) authorizedOrganizationAuditQuery(ctx context.Context, input *OrganizationAuditInput) (auditprojection.Query, error) {
	if err := requireUnscopedOrganizationCredential(ctx); err != nil {
		return auditprojection.Query{}, err
	}
	member, err := h.requireOrganizationMember(ctx, input.PathID, middleware.GetUserID(ctx))
	if err != nil {
		return auditprojection.Query{}, err
	}
	if member.Role != models.OrganizationRoleOwner {
		return auditprojection.Query{}, huma.Error403Forbidden("organization owner role required")
	}
	from, err := parseOrganizationAuditTime(input.From)
	if err != nil {
		return auditprojection.Query{}, huma.Error400BadRequest("from must be an RFC 3339 timestamp")
	}
	before, err := parseOrganizationAuditTime(input.Before)
	if err != nil {
		return auditprojection.Query{}, huma.Error400BadRequest("before must be an RFC 3339 timestamp")
	}
	if !from.IsZero() && !before.IsZero() && !from.Before(before) {
		return auditprojection.Query{}, huma.Error400BadRequest("from must be earlier than before")
	}
	cursor, err := decodeAuditCursor(input.Cursor)
	if err != nil {
		return auditprojection.Query{}, huma.Error400BadRequest("invalid organization audit cursor")
	}
	if input.WorkspaceID != "" {
		exists, err := h.db.NewSelect().Model((*models.Workspace)(nil)).
			Where("id = ? AND organization_id = ?", input.WorkspaceID, input.PathID).Exists(ctx)
		if err != nil {
			return auditprojection.Query{}, huma.Error500InternalServerError("failed to validate audit workspace filter")
		}
		if !exists {
			return auditprojection.Query{}, huma.Error400BadRequest("workspace filter is outside the organization")
		}
	}
	return auditprojection.Query{
		OrganizationID: input.PathID, WorkspaceID: strings.TrimSpace(input.WorkspaceID),
		ActorUserID: strings.TrimSpace(input.ActorUserID), Action: strings.TrimSpace(input.Action),
		ResourceType: auditprojection.ResourceType(strings.TrimSpace(input.ResourceType)),
		Result:       auditprojection.Result(strings.TrimSpace(input.Result)),
		From:         from, Before: before, Limit: input.Limit, Cursor: cursor,
	}, nil
}

func encodeAuditCursor(cursor *auditprojection.Cursor) string {
	if cursor == nil {
		return ""
	}
	payload, err := json.Marshal(auditCursorPayload{OccurredAt: cursor.OccurredAt.UTC(), Source: cursor.Source, ID: cursor.ID})
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeAuditCursor(value string) (*auditprojection.Cursor, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	var cursor auditCursorPayload
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return nil, err
	}
	if cursor.OccurredAt.IsZero() || cursor.ID == "" || !auditprojection.IsValidSource(cursor.Source) {
		return nil, errors.New("incomplete cursor")
	}
	return &auditprojection.Cursor{OccurredAt: cursor.OccurredAt.UTC(), Source: cursor.Source, ID: cursor.ID}, nil
}

func parseOrganizationAuditTime(value string) (time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return time.Time{}, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, err
	}
	return parsed.UTC(), nil
}

func auditCSV(items []auditprojection.AuditEvent) ([]byte, error) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	if err := writer.Write([]string{"occurred_at", "actor_user_id", "effective_actor_user_id", "action", "resource_type", "resource_id", "organization_id", "workspace_id", "result", "changed_fields"}); err != nil {
		return nil, err
	}
	for _, item := range items {
		changed, err := json.Marshal(item.ChangedFields)
		if err != nil {
			return nil, err
		}
		if err := writer.Write([]string{
			item.OccurredAt.UTC().Format(time.RFC3339Nano), item.ActorUserID, item.EffectiveActorUserID,
			item.Action, string(item.Resource.Type), item.Resource.ID, item.Resource.OrganizationID, item.Resource.WorkspaceID,
			string(item.Result), string(changed),
		}); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
