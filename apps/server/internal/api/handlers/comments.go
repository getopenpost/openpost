package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	engagementservice "github.com/openpost/backend/internal/services/engagement"
	"github.com/uptrace/bun"
)

const (
	renditionCommentsPath = "/renditions/{id}/comments"
	commentReplyPath      = "/comments/{id}/reply"
	commentHidePath       = "/comments/{id}/hide"
	commentPathByID       = "/comments/{id}"
)

type CommentFeatureGate interface {
	IsEffectiveEnabled(ctx context.Context, accountID, feature string) (bool, error)
}

type CommentHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	providers   map[string]platform.Adapter
	encryptor   *servicecrypto.TokenEncryptor
	tokenSource AccessTokenSource
	featureGate CommentFeatureGate
}

func NewCommentHandler(db *bun.DB, authenticator middleware.Authenticator, providers map[string]platform.Adapter, encryptor *servicecrypto.TokenEncryptor) *CommentHandler {
	return &CommentHandler{db: db, auth: authenticator, providers: providers, encryptor: encryptor}
}

func (h *CommentHandler) SetFeatureGate(g CommentFeatureGate) {
	h.featureGate = g
}

func (h *CommentHandler) SetTokenSource(source AccessTokenSource) {
	h.tokenSource = source
}

type ListRenditionCommentsInput struct {
	PathID string `path:"id" doc:"Rendition ID"`
}

type CommentActionInput struct {
	PathID string `path:"id" doc:"Opaque OpenPost comment ID"`
}

type CommentReplyInput struct {
	PathID string `path:"id" doc:"Opaque OpenPost comment ID"`
	Body   struct {
		Body string `json:"body" doc:"Reply body"`
	}
}

type CommentResponse struct {
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

type CommentListResponse struct {
	Comments []CommentResponse `json:"comments"`
}

type CommentListOutput struct {
	Body CommentListResponse
}

type CommentActionOutput struct {
	Body struct {
		Message string `json:"message"`
		ID      string `json:"id,omitempty"`
	}
}

type commentReference struct {
	RenditionID       string `json:"rendition_id"`
	ProviderCommentID string `json:"provider_comment_id"`
}

func (h *CommentHandler) RegisterRoutes(api huma.API) {
	h.listRenditionComments(api)
	h.replyToComment(api)
	h.hideComment(api)
	h.deleteComment(api)
}

func (h *CommentHandler) listRenditionComments(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-rendition-comments",
		Method:      http.MethodGet,
		Path:        renditionCommentsPath,
		Summary:     "List comments for a published rendition",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 501},
	}, func(ctx context.Context, input *ListRenditionCommentsInput) (*CommentListOutput, error) {
		rendition, _, account, err := h.loadCommentContext(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if h.featureGate != nil {
			enabled, gateErr := h.featureGate.IsEffectiveEnabled(ctx, account.ID, "engagement")
			if gateErr != nil || !enabled {
				return nil, huma.Error403Forbidden("engagement is disabled for this account")
			}
		}
		commenter, accessToken, err := h.commentAdapter(ctx, account)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(rendition.ExternalID) == "" {
			return nil, huma.Error400BadRequest("rendition has no provider post ID")
		}
		comments, err := commenter.ListComments(ctx, accessToken, account.AccountID, rendition.ExternalID)
		if err != nil {
			return nil, commentProviderError("list provider comments", err)
		}
		out := CommentListResponse{Comments: make([]CommentResponse, 0, len(comments))}
		for _, comment := range comments {
			ref, err := encodeCommentReference(commentReference{RenditionID: rendition.ID, ProviderCommentID: comment.ID})
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to encode comment ID")
			}
			out.Comments = append(out.Comments, commentResponse(rendition.ID, ref, comment))
		}
		return &CommentListOutput{Body: out}, nil
	})
}

func (h *CommentHandler) replyToComment(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "reply-to-comment",
		Method:      http.MethodPost,
		Path:        commentReplyPath,
		Summary:     "Reply to a provider comment",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 501},
	}, func(ctx context.Context, input *CommentReplyInput) (*CommentActionOutput, error) {
		ref, err := decodeCommentReference(input.PathID)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid comment ID")
		}
		if strings.TrimSpace(input.Body.Body) == "" {
			return nil, huma.Error400BadRequest("reply body is required")
		}
		rendition, publication, account, err := h.loadCommentContext(ctx, ref.RenditionID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if h.featureGate != nil {
			enabled, gateErr := h.featureGate.IsEffectiveEnabled(ctx, account.ID, "engagement")
			if gateErr != nil || !enabled {
				return nil, huma.Error403Forbidden("engagement is disabled for this account")
			}
		}
		if err := h.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		if _, err := h.commentProvider(account); err != nil {
			return nil, err
		}
		jobID, err := engagementservice.QueueProviderCommentAction(ctx, h.db, h.featureGate, engagementservice.ProviderCommentActionInput{
			Actor:       workspaceActor(ctx, middleware.GetUserID(ctx)),
			WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID,
			RenditionID: rendition.ID, SocialAccountID: account.ID,
			ProviderCommentID: ref.ProviderCommentID, Action: "reply",
			Message: input.Body.Body,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to queue comment reply")
		}
		return commentActionMessage("comment reply queued", jobID), nil
	})
}

func (h *CommentHandler) hideComment(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "hide-comment",
		Method:      http.MethodPost,
		Path:        commentHidePath,
		Summary:     "Hide a provider comment",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 501},
	}, func(ctx context.Context, input *CommentActionInput) (*CommentActionOutput, error) {
		ref, err := decodeCommentReference(input.PathID)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid comment ID")
		}
		rendition, publication, account, err := h.loadCommentContext(ctx, ref.RenditionID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if h.featureGate != nil {
			enabled, gateErr := h.featureGate.IsEffectiveEnabled(ctx, account.ID, "engagement")
			if gateErr != nil || !enabled {
				return nil, huma.Error403Forbidden("engagement is disabled for this account")
			}
		}
		if err := h.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		if _, err := h.commentProvider(account); err != nil {
			return nil, err
		}
		jobID, err := engagementservice.QueueProviderCommentAction(ctx, h.db, h.featureGate, engagementservice.ProviderCommentActionInput{
			Actor:       workspaceActor(ctx, middleware.GetUserID(ctx)),
			WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID,
			RenditionID: rendition.ID, SocialAccountID: account.ID,
			ProviderCommentID: ref.ProviderCommentID, Action: "hide",
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to queue comment hide")
		}
		return commentActionMessage("comment hide queued", jobID), nil
	})
}

func (h *CommentHandler) deleteComment(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-comment",
		Method:      http.MethodDelete,
		Path:        commentPathByID,
		Summary:     "Delete a provider comment",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 501},
	}, func(ctx context.Context, input *CommentActionInput) (*CommentActionOutput, error) {
		ref, err := decodeCommentReference(input.PathID)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid comment ID")
		}
		rendition, publication, account, err := h.loadCommentContext(ctx, ref.RenditionID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if h.featureGate != nil {
			enabled, gateErr := h.featureGate.IsEffectiveEnabled(ctx, account.ID, "engagement")
			if gateErr != nil || !enabled {
				return nil, huma.Error403Forbidden("engagement is disabled for this account")
			}
		}
		if err := h.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		if _, err := h.commentProvider(account); err != nil {
			return nil, err
		}
		jobID, err := engagementservice.QueueProviderCommentAction(ctx, h.db, h.featureGate, engagementservice.ProviderCommentActionInput{
			Actor:       workspaceActor(ctx, middleware.GetUserID(ctx)),
			WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID,
			RenditionID: rendition.ID, SocialAccountID: account.ID,
			ProviderCommentID: ref.ProviderCommentID, Action: "delete",
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to queue comment delete")
		}
		return commentActionMessage("comment delete queued", jobID), nil
	})
}

func (h *CommentHandler) checkWorkspaceEditAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

func (h *CommentHandler) loadCommentContext(ctx context.Context, renditionID, userID string) (*models.Rendition, *models.Publication, *models.SocialAccount, error) {
	var rendition models.Rendition
	if err := h.db.NewSelect().Model(&rendition).Where("id = ?", renditionID).Scan(ctx); err != nil {
		return nil, nil, nil, huma.Error404NotFound("rendition not found")
	}
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", rendition.PublicationID).Scan(ctx); err != nil {
		return nil, nil, nil, huma.Error404NotFound("publication not found")
	}
	if err := (&PublicationHandler{db: h.db}).checkWorkspaceAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return nil, nil, nil, err
	}
	var account models.SocialAccount
	if err := h.db.NewSelect().Model(&account).Where("id = ? AND workspace_id = ? AND is_active = ?", rendition.SocialAccountID, publication.WorkspaceID, true).Scan(ctx); err != nil {
		return nil, nil, nil, huma.Error404NotFound("social account not found")
	}
	return &rendition, &publication, &account, nil
}

func (h *CommentHandler) commentAdapter(ctx context.Context, account *models.SocialAccount) (platform.CommentAdapter, string, error) {
	commenter, err := h.commentProvider(account)
	if err != nil {
		return nil, "", err
	}
	if h.tokenSource != nil {
		token, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return nil, "", huma.Error500InternalServerError("failed to load account token")
		}
		return commenter, token, nil
	}
	if h.encryptor == nil {
		return nil, "", huma.Error500InternalServerError("comment provider tokens are unavailable")
	}
	token, err := h.encryptor.Decrypt(account.AccessTokenEnc)
	if err != nil {
		return nil, "", huma.Error500InternalServerError("failed to decrypt account token")
	}
	return commenter, token, nil
}

func (h *CommentHandler) commentProvider(account *models.SocialAccount) (platform.CommentAdapter, error) {
	provider := h.providers[account.Platform]
	commenter, ok := provider.(platform.CommentAdapter)
	if !ok || commenter == nil {
		return nil, huma.NewError(http.StatusNotImplemented, fmt.Sprintf("comments are not supported for %s", account.Platform))
	}
	return commenter, nil
}

func commentResponse(renditionID, encodedID string, comment platform.Comment) CommentResponse {
	return CommentResponse{
		ID:                encodedID,
		RenditionID:       renditionID,
		ProviderCommentID: comment.ID,
		AuthorID:          comment.AuthorID,
		AuthorName:        comment.AuthorName,
		AuthorAvatarURL:   comment.AuthorAvatarURL,
		Text:              comment.Text,
		CreatedAt:         comment.CreatedAt,
		Hidden:            comment.Hidden,
		CanReply:          comment.CanReply,
		CanHide:           comment.CanHide,
		CanDelete:         comment.CanDelete,
	}
}

func commentActionMessage(message, id string) *CommentActionOutput {
	out := &CommentActionOutput{}
	out.Body.Message = message
	out.Body.ID = id
	return out
}

func commentProviderError(action string, err error) error {
	if errors.Is(err, platform.ErrUnsupportedCommentAction) {
		return huma.NewError(http.StatusNotImplemented, fmt.Sprintf("provider does not support %s", action))
	}
	return huma.Error502BadGateway("failed to " + action)
}

func encodeCommentReference(ref commentReference) (string, error) {
	if strings.TrimSpace(ref.RenditionID) == "" || strings.TrimSpace(ref.ProviderCommentID) == "" {
		return "", fmt.Errorf("comment reference requires rendition and provider comment IDs")
	}
	data, err := json.Marshal(ref)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func decodeCommentReference(encoded string) (commentReference, error) {
	var ref commentReference
	data, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return ref, err
	}
	if err := json.Unmarshal(data, &ref); err != nil {
		return ref, err
	}
	if strings.TrimSpace(ref.RenditionID) == "" || strings.TrimSpace(ref.ProviderCommentID) == "" {
		return ref, fmt.Errorf("comment reference requires rendition and provider comment IDs")
	}
	return ref, nil
}
