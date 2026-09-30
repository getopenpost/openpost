package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"

	"github.com/openpost/backend/internal/models"
)

const (
	mcpToolUploadBase64    = "upload_media_base64"
	maxMCPBase64MediaBytes = 8 * 1024 * 1024
)

// MCP recommends a JSON text block for clients that cannot read structuredContent.
// Serialize only the public payload; upload credentials remain private in _meta.
func mcpStructuredJSONText(result any) (any, *mcpError) {
	response, ok := result.(map[string]any)
	if !ok || response["structuredContent"] == nil {
		return result, nil
	}
	payload, err := json.Marshal(response["structuredContent"])
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to serialize tool result"}
	}
	content, ok := response["content"].([]mcpContent)
	if !ok {
		return nil, &mcpError{Code: -32603, Message: "invalid tool result content"}
	}
	response["content"] = append(content, mcpContent{Type: "text", Text: string(payload)})
	return response, nil
}

func mcpUploadMediaBase64Tool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolUploadBase64, "title": "Upload media from base64",
		"description": "Upload a local file when the client cannot show a file picker and no public URL is available. Accepts standard base64 or a base64 data URL, up to 8 MiB decoded. Uses the normal media validation, quota, storage, and processing pipeline.",
		"inputSchema": map[string]any{
			"type": "object", "properties": map[string]any{
				"workspace_id":   map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"filename":       map[string]any{"type": "string", "description": "Original filename, such as launch.png."},
				"mime_type":      map[string]any{"type": "string", "description": "Optional declared MIME type. Validated against the decoded content."},
				"content_base64": map[string]any{"type": "string", "description": "Standard base64 of the file bytes, optionally prefixed with data:<mime-type>;base64,."},
				"alt_text":       map[string]any{"type": "string", "description": "Optional accessible alt text."},
			}, "required": []string{"workspace_id", "filename", "content_base64"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, false)
}

func (h *MCPHandler) uploadMediaBase64(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID   string `json:"workspace_id"`
		Filename      string `json:"filename"`
		MimeType      string `json:"mime_type"`
		ContentBase64 string `json:"content_base64"`
		AltText       string `json:"alt_text"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid upload_media_base64 arguments"}
	}
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	content, dataMIME, rpcErr := decodeMCPBase64Media(input.ContentBase64)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if input.MimeType == "" {
		input.MimeType = dataMIME
	}
	media, rpcErr := h.storeMCPMediaBytes(ctx, mediaUploadBytesInput{WorkspaceID: input.WorkspaceID, Filename: input.Filename, DeclaredMimeType: input.MimeType, Size: int64(len(content)), Content: content, AltText: input.AltText})
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpUploadedMediaResponse(media), nil
}

func decodeMCPBase64Media(raw string) ([]byte, string, *mcpError) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, "", &mcpError{Code: -32602, Message: "content_base64 is required"}
	}
	dataMIME := ""
	if strings.HasPrefix(raw, "data:") {
		header, payload, ok := strings.Cut(raw, ",")
		if !ok || !strings.HasSuffix(header, ";base64") {
			return nil, "", &mcpError{Code: -32602, Message: "data URL must use base64 encoding"}
		}
		dataMIME = strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
		raw = payload
	}
	raw = strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\r' || r == '\n' {
			return -1
		}
		return r
	}, raw)
	encoding := base64.StdEncoding
	if len(raw)%4 != 0 {
		encoding = base64.RawStdEncoding
	}
	content, err := io.ReadAll(io.LimitReader(base64.NewDecoder(encoding, strings.NewReader(raw)), maxMCPBase64MediaBytes+1))
	if err != nil {
		return nil, "", &mcpError{Code: -32602, Message: "content_base64 is not valid base64"}
	}
	if len(content) == 0 {
		return nil, "", &mcpError{Code: -32602, Message: "decoded media is empty"}
	}
	if len(content) > maxMCPBase64MediaBytes {
		return nil, "", &mcpError{Code: -32602, Message: "decoded media exceeds the 8 MiB limit; use the file picker or upload_media_from_url for larger files"}
	}
	return content, dataMIME, nil
}

func (h *MCPHandler) storeMCPMediaBytes(ctx context.Context, input mediaUploadBytesInput) (mcpMedia, *mcpError) {
	if h.mediaHandler == nil {
		return mcpMedia{}, &mcpError{Code: -32603, Message: "media storage is not configured"}
	}
	result, err := h.mediaHandler.processUploadBytes(ctx, input)
	if err != nil {
		return mcpMedia{}, &mcpError{Code: -32602, Message: err.Error()}
	}
	var stored models.MediaAttachment
	if err := h.db.NewSelect().Model(&stored).Where("id = ?", stringFromMap(result, "id")).Scan(ctx); err != nil {
		return mcpMedia{}, &mcpError{Code: -32603, Message: "failed to load uploaded media"}
	}
	usage, err := h.mediaHandler.mediaUsageSummary(ctx, stored.WorkspaceID, stored.ID)
	if err != nil {
		return mcpMedia{}, &mcpError{Code: -32603, Message: "failed to check media usage"}
	}
	media := mcpMediaFromAttachment(stored, usage.Total, usage.Blocking == 0)
	media.Filename = stored.OriginalFilename
	media.Deduped = boolFromMap(result, "deduped")
	return media, nil
}

func mcpUploadedMediaResponse(media mcpMedia) map[string]any {
	return map[string]any{"content": []mcpContent{{Type: "text", Text: "Media uploaded: " + media.ID}}, "structuredContent": map[string]any{"media": media}}
}
