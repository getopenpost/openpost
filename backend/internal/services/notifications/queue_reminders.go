package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const (
	DefaultQueueRunwayDays           = 7
	MinQueueRunwayDays               = 1
	MaxQueueRunwayDays               = 30
	EmailClassificationQueueReminder = "queue_reminder"
	queueReminderCoalescingDelay     = time.Minute
)

type QueueReminderKind string

const (
	QueueReminderLowRunway QueueReminderKind = "low_runway"
	QueueReminderEmptied   QueueReminderKind = "queue_emptied"
)

var (
	ErrInvalidQueueReminderSettings = errors.New("invalid queue reminder settings")
	ErrQueueReminderAccess          = errors.New("queue reminder access denied")
)

type QueueReminderSettings struct {
	WorkspaceID         string `json:"workspace_id"`
	WorkspaceName       string `json:"workspace_name"`
	WorkspaceTimezone   string `json:"workspace_timezone"`
	LowRunwayEnabled    bool   `json:"low_runway_enabled"`
	QueueEmptiedEnabled bool   `json:"queue_emptied_enabled"`
	RunwayDays          int    `json:"runway_days" minimum:"1" maximum:"30"`
	EmailAvailable      bool   `json:"email_available"`
	Activated           bool   `json:"activated"`
}

type QueueReminderUpdate struct {
	LowRunwayEnabled    bool `json:"low_runway_enabled"`
	QueueEmptiedEnabled bool `json:"queue_emptied_enabled"`
	RunwayDays          int  `json:"runway_days" minimum:"1" maximum:"30"`
}

type queueSnapshot struct {
	PendingCount int
	LatestRunAt  time.Time
}

func (s *Service) GetQueueReminderSettings(ctx context.Context, actor MuteActor, workspaceID string) (QueueReminderSettings, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	allowed, err := authorizeQueueReminderActor(ctx, s.db, actor, workspaceID)
	if err != nil {
		return QueueReminderSettings{}, err
	}
	if !allowed {
		return QueueReminderSettings{}, ErrQueueReminderAccess
	}
	return s.getQueueReminderSettings(ctx, s.db, strings.TrimSpace(actor.UserID), workspaceID)
}

func (s *Service) UpdateQueueReminderSettings(
	ctx context.Context,
	actor MuteActor,
	workspaceID string,
	update QueueReminderUpdate,
) (QueueReminderSettings, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	userID := strings.TrimSpace(actor.UserID)
	allowed, err := authorizeQueueReminderActor(ctx, s.db, actor, workspaceID)
	if err != nil {
		return QueueReminderSettings{}, err
	}
	if !allowed {
		return QueueReminderSettings{}, ErrQueueReminderAccess
	}
	if update.RunwayDays < MinQueueRunwayDays || update.RunwayDays > MaxQueueRunwayDays {
		return QueueReminderSettings{}, ErrInvalidQueueReminderSettings
	}
	now := s.now()
	current := models.UserWorkspaceQueueReminder{RunwayDays: DefaultQueueRunwayDays}
	err = s.db.NewSelect().Model(&current).
		Where("user_id = ? AND workspace_id = ?", userID, workspaceID).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return QueueReminderSettings{}, err
	}
	lowRunwayActive := current.LowRunwayActive
	if !update.LowRunwayEnabled || !current.LowRunwayEnabled || current.RunwayDays != update.RunwayDays {
		lowRunwayActive = false
	}
	queueEmptiedActive := current.QueueEmptiedActive
	if !update.QueueEmptiedEnabled || !current.QueueEmptiedEnabled {
		queueEmptiedActive = false
	}
	row := &models.UserWorkspaceQueueReminder{
		UserID: userID, WorkspaceID: workspaceID,
		LowRunwayEnabled: update.LowRunwayEnabled, QueueEmptiedEnabled: update.QueueEmptiedEnabled,
		RunwayDays: update.RunwayDays, LowRunwayActive: lowRunwayActive,
		QueueEmptiedActive: queueEmptiedActive, UpdatedAt: now,
	}
	_, err = s.db.NewInsert().Model(row).
		On("CONFLICT (user_id, workspace_id) DO UPDATE").
		Set("low_runway_enabled = EXCLUDED.low_runway_enabled").
		Set("queue_emptied_enabled = EXCLUDED.queue_emptied_enabled").
		Set("runway_days = EXCLUDED.runway_days").
		Set("low_runway_active = EXCLUDED.low_runway_active").
		Set("queue_emptied_active = EXCLUDED.queue_emptied_active").
		Set("updated_at = EXCLUDED.updated_at").Exec(ctx)
	if err != nil {
		return QueueReminderSettings{}, err
	}
	return s.getQueueReminderSettings(ctx, s.db, userID, workspaceID)
}

func (s *Service) getQueueReminderSettings(ctx context.Context, db bun.IDB, userID, workspaceID string) (QueueReminderSettings, error) {
	var workspace models.Workspace
	if err := db.NewSelect().Model(&workspace).Column("id", "name", "timezone").Where("id = ?", workspaceID).Scan(ctx); err != nil {
		return QueueReminderSettings{}, err
	}
	settings := QueueReminderSettings{
		WorkspaceID: workspace.ID, WorkspaceName: workspace.Name,
		WorkspaceTimezone: normalizedQueueReminderTimezone(workspace.Timezone),
		RunwayDays:        DefaultQueueRunwayDays, EmailAvailable: s.email != nil,
	}
	var err error
	settings.Activated, err = db.NewSelect().Model((*models.WorkspaceActivation)(nil)).
		Where("workspace_id = ?", workspaceID).Exists(ctx)
	if err != nil {
		return QueueReminderSettings{}, err
	}
	var row models.UserWorkspaceQueueReminder
	err = db.NewSelect().Model(&row).Where("user_id = ? AND workspace_id = ?", userID, workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return settings, nil
	}
	if err != nil {
		return QueueReminderSettings{}, err
	}
	settings.LowRunwayEnabled = row.LowRunwayEnabled
	settings.QueueEmptiedEnabled = row.QueueEmptiedEnabled
	settings.RunwayDays = row.RunwayDays
	return settings, nil
}

func normalizedQueueReminderTimezone(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "UTC"
	}
	return value
}

func authorizeQueueReminderActor(ctx context.Context, db bun.IDB, actor MuteActor, workspaceID string) (bool, error) {
	decision, err := workspaceaccess.NewAuthorizer(db).Authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit)
	return decision.Allowed, err
}

func authorizeQueueReminderSubscription(ctx context.Context, db bun.IDB, userID, workspaceID string) (bool, error) {
	decision, err := workspaceaccess.NewAuthorizer(db).AuthorizeStored(ctx, workspaceaccess.StoredAuthority{
		UserID: userID, WorkspaceID: workspaceID,
	}, workspaceaccess.LevelEdit)
	return decision.Allowed, err
}

func (s *Service) RunQueueReminderSweep(ctx context.Context) error {
	if s.email == nil {
		return nil
	}
	var subscriptions []models.UserWorkspaceQueueReminder
	err := s.db.NewSelect().Model(&subscriptions).
		Where("low_runway_enabled = ? OR queue_emptied_enabled = ? OR low_runway_active = ? OR queue_emptied_active = ?", true, true, true, true).
		Order("workspace_id ASC", "user_id ASC").Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	for _, subscription := range subscriptions {
		if err := s.evaluateQueueReminderSubscription(ctx, subscription); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) evaluateQueueReminderSubscription(ctx context.Context, subscription models.UserWorkspaceQueueReminder) error {
	return s.db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		var current models.UserWorkspaceQueueReminder
		if err := tx.NewSelect().Model(&current).
			Where("user_id = ? AND workspace_id = ?", subscription.UserID, subscription.WorkspaceID).Scan(txCtx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		return s.evaluateQueueReminderSubscriptionWithDB(txCtx, tx, current)
	})
}

func (s *Service) evaluateQueueReminderSubscriptionWithDB(ctx context.Context, db bun.IDB, subscription models.UserWorkspaceQueueReminder) error {
	active, err := queueReminderSubscriptionIsActive(ctx, db, subscription)
	if err != nil {
		return err
	}
	if !active {
		return nil
	}
	snapshot, err := s.queueSnapshot(ctx, db, subscription.WorkspaceID)
	if err != nil {
		return err
	}
	horizon := s.now().Add(time.Duration(subscription.RunwayDays) * 24 * time.Hour)
	lowRunway := snapshot.PendingCount == 0 || !snapshot.LatestRunAt.After(horizon)
	if !lowRunway {
		_, err = db.NewUpdate().Model((*models.UserWorkspaceQueueReminder)(nil)).
			Set("low_runway_active = ?", false).
			Set("queue_emptied_active = ?", false).
			Where("user_id = ? AND workspace_id = ?", subscription.UserID, subscription.WorkspaceID).Exec(ctx)
		return err
	}
	if snapshot.PendingCount > 0 && subscription.QueueEmptiedActive {
		if _, err = db.NewUpdate().Model((*models.UserWorkspaceQueueReminder)(nil)).
			Set("queue_emptied_active = ?", false).
			Where("user_id = ? AND workspace_id = ?", subscription.UserID, subscription.WorkspaceID).Exec(ctx); err != nil {
			return err
		}
	}
	if !subscription.LowRunwayEnabled || subscription.LowRunwayActive {
		return nil
	}
	return s.markAndEnqueueLowRunwayReminder(ctx, db, subscription, snapshot)
}

func queueReminderSubscriptionIsActive(ctx context.Context, db bun.IDB, subscription models.UserWorkspaceQueueReminder) (bool, error) {
	allowed, err := authorizeQueueReminderSubscription(ctx, db, subscription.UserID, subscription.WorkspaceID)
	if err != nil || !allowed {
		return false, err
	}
	return db.NewSelect().Model((*models.WorkspaceActivation)(nil)).
		Where("workspace_id = ?", subscription.WorkspaceID).Exists(ctx)
}

func (s *Service) RecordQueueEmptiedAfterPublication(ctx context.Context, db bun.IDB, workspaceID, publicationID string) error {
	if s.email == nil || strings.TrimSpace(workspaceID) == "" || strings.TrimSpace(publicationID) == "" {
		return nil
	}
	snapshot, err := s.queueSnapshot(ctx, db, workspaceID)
	if err != nil || snapshot.PendingCount > 0 {
		return err
	}
	activated, err := db.NewSelect().Model((*models.WorkspaceActivation)(nil)).Where("workspace_id = ?", workspaceID).Exists(ctx)
	if err != nil || !activated {
		return err
	}
	var subscriptions []models.UserWorkspaceQueueReminder
	err = db.NewSelect().Model(&subscriptions).
		Where("workspace_id = ? AND queue_emptied_enabled = ?", workspaceID, true).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	for _, subscription := range subscriptions {
		allowed, authorizationErr := authorizeQueueReminderSubscription(ctx, db, subscription.UserID, workspaceID)
		if authorizationErr != nil {
			return authorizationErr
		}
		if !allowed {
			continue
		}
		if err := s.markAndEnqueueQueueEmptiedReminder(ctx, db, subscription, publicationID, snapshot); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) markAndEnqueueLowRunwayReminder(
	ctx context.Context,
	db bun.IDB,
	subscription models.UserWorkspaceQueueReminder,
	snapshot queueSnapshot,
) error {
	result, err := db.NewUpdate().Model((*models.UserWorkspaceQueueReminder)(nil)).
		Set("low_runway_active = ?", true).
		Set("updated_at = ?", s.now()).
		Where("user_id = ? AND workspace_id = ?", subscription.UserID, subscription.WorkspaceID).
		Where("low_runway_active = ?", false).Exec(ctx)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil || changed == 0 {
		return err
	}
	return s.enqueueQueueReminderEmail(ctx, db, subscription, QueueReminderLowRunway, snapshot, "")
}

func (s *Service) markAndEnqueueQueueEmptiedReminder(
	ctx context.Context,
	db bun.IDB,
	subscription models.UserWorkspaceQueueReminder,
	publicationID string,
	snapshot queueSnapshot,
) error {
	query := db.NewUpdate().Model((*models.UserWorkspaceQueueReminder)(nil)).
		Set("queue_emptied_active = ?", true).
		Set("updated_at = ?", s.now()).
		Where("user_id = ? AND workspace_id = ?", subscription.UserID, subscription.WorkspaceID)
	if subscription.LowRunwayEnabled {
		query = query.Set("low_runway_active = ?", true)
	}
	if _, err := query.Exec(ctx); err != nil {
		return err
	}
	deliveryID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(strings.Join([]string{
		EmailClassificationQueueReminder,
		string(QueueReminderEmptied),
		subscription.UserID,
		subscription.WorkspaceID,
		publicationID,
	}, ":"))).String()
	return s.enqueueQueueReminderEmail(ctx, db, subscription, QueueReminderEmptied, snapshot, deliveryID)
}

func (s *Service) enqueueQueueReminderEmail(
	ctx context.Context,
	db bun.IDB,
	subscription models.UserWorkspaceQueueReminder,
	kind QueueReminderKind,
	snapshot queueSnapshot,
	deliveryID string,
) error {
	var workspace models.Workspace
	if err := db.NewSelect().Model(&workspace).Column("name", "timezone").Where("id = ?", subscription.WorkspaceID).Scan(ctx); err != nil {
		return err
	}
	title := "Your OpenPost queue is empty"
	body := fmt.Sprintf("%s has no posts left in its publishing queue. Schedule the next post to keep publishing.", workspace.Name)
	if kind == QueueReminderLowRunway {
		daysLeft := 0
		if snapshot.PendingCount > 0 {
			daysLeft = max(0, int(math.Ceil(snapshot.LatestRunAt.Sub(s.now()).Hours()/24)))
		}
		dayLabel := "days"
		if daysLeft == 1 {
			dayLabel = "day"
		}
		title = fmt.Sprintf("Your OpenPost queue has %d %s left", daysLeft, dayLabel)
		body = fmt.Sprintf("%s has %d days or less of scheduled posts left.", workspace.Name, subscription.RunwayDays)
	}
	if deliveryID == "" {
		deliveryID = uuid.NewString()
	}
	payload, err := json.Marshal(emailDeliveryJob{
		DeliveryID: deliveryID, Classification: EmailClassificationQueueReminder,
		UserID: subscription.UserID, WorkspaceID: subscription.WorkspaceID, WorkspaceScopeKnown: true,
		Type: string(kind), Title: title, Body: body, Href: "/calendar",
		QueueRunwayDays: subscription.RunwayDays,
	})
	if err != nil {
		return fmt.Errorf("encode queue reminder email job: %w", err)
	}
	runAt := s.now()
	if kind == QueueReminderLowRunway {
		// Give an in-flight final publication time to replace this warning with
		// the more specific empty-queue email before delivery revalidates it.
		runAt = runAt.Add(queueReminderCoalescingDelay)
	}
	job, err := jobregistry.NewJob(JobTypeEmailDelivery, string(payload), runAt)
	if err != nil {
		return err
	}
	job.ID = deliveryID
	_, err = db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func (s *Service) queueSnapshot(ctx context.Context, db bun.IDB, workspaceID string) (queueSnapshot, error) {
	queueQuery := func() *bun.SelectQuery {
		return db.NewSelect().TableExpr("renditions AS rendition").
			Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
			Where("publication.workspace_id = ?", workspaceID).
			Where("rendition.status IN (?)", bun.List([]string{models.RenditionStatusScheduled, models.RenditionStatusPublishing}))
	}
	pendingCount, err := queueQuery().Count(ctx)
	if err != nil || pendingCount == 0 {
		return queueSnapshot{PendingCount: pendingCount}, err
	}
	var renditionID string
	err = queueQuery().ColumnExpr("rendition.id").
		OrderExpr("COALESCE(rendition.schedule_override, publication.actual_run_at, publication.scheduled_at) DESC").
		Limit(1).Scan(ctx, &renditionID)
	if err != nil {
		return queueSnapshot{}, err
	}
	var rendition models.Rendition
	if err = db.NewSelect().Model(&rendition).Column("publication_id", "schedule_override").Where("id = ?", renditionID).Scan(ctx); err != nil {
		return queueSnapshot{}, err
	}
	var publication models.Publication
	if err = db.NewSelect().Model(&publication).Column("actual_run_at", "scheduled_at").Where("id = ?", rendition.PublicationID).Scan(ctx); err != nil {
		return queueSnapshot{}, err
	}
	latestRunAt := rendition.ScheduleOverride
	if latestRunAt.IsZero() {
		latestRunAt = publication.ActualRunAt
	}
	if latestRunAt.IsZero() {
		latestRunAt = publication.ScheduledAt
	}
	return queueSnapshot{PendingCount: pendingCount, LatestRunAt: latestRunAt.UTC()}, nil
}

func (s *Service) handleQueueReminderEmail(ctx context.Context, job emailDeliveryJob) error {
	subscription, deliver, err := s.queueReminderDeliverySubscription(ctx, job)
	if err != nil || !deliver {
		return err
	}
	muted, err := s.isMutedWithDB(ctx, s.db, job.UserID, job.WorkspaceID, true)
	if err != nil || muted {
		return err
	}
	var email string
	err = s.db.NewSelect().Model((*models.User)(nil)).Column("email").Where("id = ?", subscription.UserID).Scan(ctx, &email)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load queue reminder recipient: %w", err)
	}
	actionURL := ""
	if s.publicURL != "" {
		actionURL = s.publicURL + job.Href
	}
	preferencesURL := ""
	if s.publicURL != "" {
		preferencesURL = s.publicURL + "/settings?tab=notifications"
	}
	return s.email.DeliverNotificationEmail(ctx, EmailMessage{
		Recipient: strings.TrimSpace(email), Title: job.Title, Body: job.Body,
		ActionURL: actionURL, PreferencesURL: preferencesURL,
		IdempotencyKey: "queue-reminder-" + job.DeliveryID,
	})
}

func (s *Service) queueReminderDeliverySubscription(
	ctx context.Context,
	job emailDeliveryJob,
) (models.UserWorkspaceQueueReminder, bool, error) {
	if strings.TrimSpace(job.UserID) == "" || strings.TrimSpace(job.WorkspaceID) == "" {
		return models.UserWorkspaceQueueReminder{}, false, errors.New("queue reminder user and workspace are required")
	}
	var subscription models.UserWorkspaceQueueReminder
	err := s.db.NewSelect().Model(&subscription).
		Where("user_id = ? AND workspace_id = ?", job.UserID, job.WorkspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return subscription, false, nil
	}
	if err != nil {
		return subscription, false, err
	}
	allowed, err := authorizeQueueReminderSubscription(ctx, s.db, job.UserID, job.WorkspaceID)
	if err != nil {
		return subscription, false, err
	}
	if !allowed {
		return subscription, false, nil
	}
	activated, err := s.db.NewSelect().Model((*models.WorkspaceActivation)(nil)).
		Where("workspace_id = ?", job.WorkspaceID).Exists(ctx)
	if err != nil || !activated {
		return subscription, false, err
	}
	snapshot, err := s.queueSnapshot(ctx, s.db, job.WorkspaceID)
	if err != nil {
		return subscription, false, err
	}
	deliver, err := s.queueReminderStillRelevant(job, subscription, snapshot)
	return subscription, deliver, err
}

func (s *Service) queueReminderStillRelevant(
	job emailDeliveryJob,
	subscription models.UserWorkspaceQueueReminder,
	snapshot queueSnapshot,
) (bool, error) {
	switch QueueReminderKind(job.Type) {
	case QueueReminderLowRunway:
		horizon := s.now().Add(time.Duration(subscription.RunwayDays) * 24 * time.Hour)
		if job.QueueRunwayDays != subscription.RunwayDays || !subscription.LowRunwayEnabled || !subscription.LowRunwayActive ||
			(snapshot.PendingCount > 0 && snapshot.LatestRunAt.After(horizon)) ||
			(snapshot.PendingCount == 0 && subscription.QueueEmptiedEnabled && subscription.QueueEmptiedActive) {
			return false, nil
		}
	case QueueReminderEmptied:
		if !subscription.QueueEmptiedEnabled || !subscription.QueueEmptiedActive || snapshot.PendingCount > 0 {
			return false, nil
		}
	default:
		return false, errors.New("queue reminder kind is invalid")
	}
	return true, nil
}
