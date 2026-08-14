package database

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCreateSchemaBuildsInvitationDeliveryEvidenceCascadeOnFreshSQLite(t *testing.T) {
	db, err := InitDBWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, CreateSchema(db))

	rows, err := db.QueryContext(t.Context(), `PRAGMA foreign_key_list(workspace_invitation_delivery_events)`)
	require.NoError(t, err)
	defer rows.Close()
	foundCascade := false
	for rows.Next() {
		var id, sequence int
		var table, from, to, onUpdate, onDelete, match string
		require.NoError(t, rows.Scan(&id, &sequence, &table, &from, &to, &onUpdate, &onDelete, &match))
		if table == "workspace_invitations" && from == "invitation_id" && to == "id" && strings.EqualFold(onDelete, "CASCADE") {
			foundCascade = true
		}
	}
	require.NoError(t, rows.Err())
	require.True(t, foundCascade)

	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	_, err = db.NewInsert().Model(&models.User{ID: "admin-1", Email: "admin@example.com", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	invitation := &models.WorkspaceInvitation{
		ID: "delivery-cascade-invitation", WorkspaceID: "workspace-1", Email: "person@example.com",
		Role: "viewer", InvitedByUserID: "admin-1", TokenHash: "delivery-cascade-token",
		ExpiresAt: now.Add(time.Hour), EmailDeliveryStatus: "sent", EmailDeliveryJobID: "delivery-1", CreatedAt: now,
	}
	_, err = db.NewInsert().Model(invitation).Exec(t.Context())
	require.NoError(t, err)
	evidence := &models.WorkspaceInvitationDeliveryEvent{
		EventID: "delivery-cascade-event", InvitationID: invitation.ID, DeliveryID: "delivery-1",
		Outcome: "delivered", OccurredAt: now, CreatedAt: now,
	}
	_, err = db.NewInsert().Model(evidence).Exec(t.Context())
	require.NoError(t, err)
	resend := &models.WorkspaceInvitationResend{
		ID: "delivery-cascade-resend", InvitationID: invitation.ID, ActorUserID: "admin-1", ResentAt: now,
	}
	_, err = db.NewInsert().Model(resend).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewDelete().Model(invitation).WherePK().Exec(t.Context())
	require.NoError(t, err)
	count, err := db.NewSelect().Model((*models.WorkspaceInvitationDeliveryEvent)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	count, err = db.NewSelect().Model((*models.WorkspaceInvitationResend)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}
