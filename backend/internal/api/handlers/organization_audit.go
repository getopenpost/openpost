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

type OrganizationAuditInput struct {
	PathID       string `path:"id" doc:"Organization ID"`
	WorkspaceID  string `query:"workspace_id" doc:"Restrict evidence to one Workspace in the Organization"`
	ActorUserID  string `query:"actor_user_id" doc:"Restrict evidence to one opaque actor user ID"`
	Action       string `query:"action" maxLength:"100" doc:"Restrict evidence to one exact domain action"`
	ResourceType string `query:"resource_type" enum:"provider,policy,domain,session,identity,reauthentication,identity_configuration,workspace_member,workspace_invitation,impersonation,billing,mcp_tool_call,publication,publication_authorization,provider_write" doc:"Restrict evidence to one resource type"`
	Result       string `query:"result" enum:"succeeded,failed,pending" doc:"Restrict evidence to one result"`
	From         string `query:"from" doc:"Inclusive RFC 3339 start time"`
	Before       string `query:"before" doc:"Exclusive RFC 3339 end time"`
	Cursor       string `query:"cursor" doc:"Opaque cursor for stable older-page pagination"`
	Limit        int    `query:"limit" minimum:"1" maximum:"200" default:"50" doc:"Maximum events to return"`
}

type OrganizationAuditPage struct {
	Items      []auditprojection.OrganizationAuditEvent `json:"items"`
	NextCursor string                                   `json:"next_cursor,omitempty"`
}

type OrganizationAuditOutput struct {
	Body OrganizationAuditPage
}

type OrganizationAuditJSONExport struct {
	FormatVersion  string                                   `json:"format_version"`
	OrganizationID string                                   `json:"organization_id"`
	GeneratedAt    time.Time                                `json:"generated_at"`
	Items          []auditprojection.OrganizationAuditEvent `json:"items"`
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

type organizationAuditCursorPayload struct {
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
			Items: page.Items, NextCursor: encodeOrganizationAuditCursor(page.NextCursor),
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
		items, err := h.collectOrganizationAuditExport(ctx, query)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to export organization audit evidence")
		}
		return &OrganizationAuditJSONExportOutput{
			ContentDisposition: fmt.Sprintf("attachment; filename=%q", "openpost-organization-audit-"+time.Now().UTC().Format("2006-01-02")+".json"),
			Body:               OrganizationAuditJSONExport{FormatVersion: "1", OrganizationID: input.PathID, GeneratedAt: time.Now().UTC(), Items: items},
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
		items, err := h.collectOrganizationAuditExport(ctx, query)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to export organization audit evidence")
		}
		body, err := organizationAuditCSV(items)
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
	cursor, err := decodeOrganizationAuditCursor(input.Cursor)
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

func (h *WorkspaceHandler) collectOrganizationAuditExport(ctx context.Context, query auditprojection.Query) ([]auditprojection.OrganizationAuditEvent, error) {
	query.Limit = 200
	query.Cursor = nil
	items := []auditprojection.OrganizationAuditEvent{}
	for {
		page, err := h.audit.List(ctx, query)
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

func encodeOrganizationAuditCursor(cursor *auditprojection.Cursor) string {
	if cursor == nil {
		return ""
	}
	payload, err := json.Marshal(organizationAuditCursorPayload{OccurredAt: cursor.OccurredAt.UTC(), Source: cursor.Source, ID: cursor.ID})
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeOrganizationAuditCursor(value string) (*auditprojection.Cursor, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	var cursor organizationAuditCursorPayload
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

func organizationAuditCSV(items []auditprojection.OrganizationAuditEvent) ([]byte, error) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	if err := writer.Write([]string{"occurred_at", "actor_user_id", "effective_actor_user_id", "action", "resource_type", "resource_id", "workspace_id", "result", "changed_fields"}); err != nil {
		return nil, err
	}
	for _, item := range items {
		changed, err := json.Marshal(item.ChangedFields)
		if err != nil {
			return nil, err
		}
		if err := writer.Write([]string{
			item.OccurredAt.UTC().Format(time.RFC3339Nano), item.ActorUserID, item.EffectiveActorUserID,
			item.Action, string(item.OrganizationAuditResource.Type), item.OrganizationAuditResource.ID, item.OrganizationAuditResource.WorkspaceID,
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
