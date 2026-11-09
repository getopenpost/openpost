package publicationauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

var ErrReviewRequired = errors.New("this post requires approval of its current version before publishing")

// ErrWorkspaceReviewRequired reports an unsubmitted post in a workspace that requires client review.
var ErrWorkspaceReviewRequired = fmt.Errorf("%w; this workspace requires client review for every post, so send it to a client first", ErrReviewRequired)

func workspaceRequiresReview(ctx context.Context, db bun.IDB, workspaceID string) (bool, error) {
	return db.NewSelect().Model((*models.Workspace)(nil)).Where("id = ? AND require_client_review = ?", workspaceID, true).Exists(ctx)
}

// RequireReview runs at admission and again before a provider write. Posts that
// were never submitted retain their ordinary publishing behavior unless their
// workspace requires client review for every post.
func RequireReview(ctx context.Context, db bun.IDB, publicationID string) error {
	var post models.Publication
	if err := db.NewSelect().Model(&post).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return err
	}
	if post.ReviewID == "" {
		required, err := workspaceRequiresReview(ctx, db, post.WorkspaceID)
		if err != nil {
			return err
		}
		if required {
			return ErrWorkspaceReviewRequired
		}
		return nil
	}
	if post.ReviewState != "approved" {
		return ErrReviewRequired
	}
	var review models.PublicationReview
	if err := db.NewSelect().Model(&review).Where("id = ? AND publication_id = ? AND epoch = ? AND decision = ?", post.ReviewID, post.ID, post.ReviewEpoch, "approved").Scan(ctx); err != nil {
		return errors.Join(ErrReviewRequired, err)
	}
	// Removing or demoting the assigned client invalidates their publishing grant.
	active, err := db.NewSelect().Model((*models.WorkspaceMember)(nil)).Where("workspace_id = ? AND user_id = ? AND status = ? AND role = ?", post.WorkspaceID, review.ReviewerID, models.WorkspaceMemberStatusActive, models.WorkspaceRoleClient).Exists(ctx)
	if err != nil {
		return err
	}
	if !active {
		return ErrReviewRequired
	}
	current, err := ReviewFingerprints(ctx, db, post.ID)
	if err != nil {
		return err
	}
	if review.FingerprintsJSON != current {
		return ErrReviewRequired
	}
	return nil
}

// Approval pins effective text, media defaults, destinations and provider
// settings, independently of scheduling and delivery-generated projections.
func ReviewFingerprints(ctx context.Context, db bun.IDB, publicationID string) (string, error) {
	var renditions []models.Rendition
	if err := db.NewSelect().Model(&renditions).Column("id").Where("publication_id = ?", publicationID).Order("position").Scan(ctx); err != nil {
		return "", err
	}
	// Replacement row IDs are not authorship. Preserve the authored destination
	// order, with stable account and target identities inside each snapshot.
	snapshots := make([]Snapshot, 0, len(renditions))
	for _, rendition := range renditions {
		snapshot, err := SnapshotForRendition(ctx, db, publicationID, rendition.ID)
		if err != nil {
			return "", err
		}
		snapshot.PublicationRevision = 0
		snapshots = append(snapshots, snapshot)
	}
	encoded, err := json.Marshal(snapshots)
	return string(encoded), err
}

// A native repost is a new placement, outside the submitted post's approval.
func RequireUnreviewedRepost(ctx context.Context, db bun.IDB, publicationID string) error {
	var post models.Publication
	if err := db.NewSelect().Model(&post).Column("review_id", "workspace_id").Where("id = ?", publicationID).Scan(ctx); err != nil {
		return err
	}
	if post.ReviewID != "" {
		return errors.New("automatic reposting is disabled for posts sent for client review; create and submit a separate post")
	}
	required, err := workspaceRequiresReview(ctx, db, post.WorkspaceID)
	if err != nil {
		return err
	}
	if required {
		return errors.New("automatic reposting is disabled while this workspace requires client review for every post; create and submit a separate post")
	}
	return nil
}

// Immediate delivery cannot replace the timing explicitly approved by a client.
// Scheduled delivery and recovery retain their existing authored-time checks.
func requireReviewAdmission(ctx context.Context, db bun.IDB, input BatchInput) error {
	if err := RequireReview(ctx, db, input.PublicationID); err != nil {
		return err
	}
	if input.Action != ActionPublish || input.PolicyMode != PolicyImmediate {
		return nil
	}
	var reviewID string
	if err := db.NewSelect().Model((*models.Publication)(nil)).Column("review_id").Where("id = ?", input.PublicationID).Scan(ctx, &reviewID); err != nil {
		return err
	}
	if reviewID == "" {
		return nil
	}
	timed, err := db.NewSelect().TableExpr("publication_reviews AS review").
		Join("JOIN publications AS publication ON publication.review_id = review.id").
		Where("publication.id = ? AND review.includes_schedule = ?", input.PublicationID, true).Exists(ctx)
	if err != nil {
		return err
	}
	if timed {
		return fmt.Errorf("%w; change the approved schedule and resubmit before publishing now", ErrReviewRequired)
	}
	return nil
}
