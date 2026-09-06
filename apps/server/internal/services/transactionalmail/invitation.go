package transactionalmail

import (
	"context"
	"time"
)

// WorkspaceInvitationMessage contains the reviewed facts for one access email.
type WorkspaceInvitationMessage struct {
	Recipient      string
	WorkspaceName  string
	InviterName    string
	Role           string
	AcceptURL      string
	ExpiresAt      time.Time
	IdempotencyKey string
}

// WorkspaceInvitationSender is the transactional delivery capability required
// by Workspace invitation jobs.
type WorkspaceInvitationSender interface {
	SendWorkspaceInvitation(context.Context, WorkspaceInvitationMessage) error
}
