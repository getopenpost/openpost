package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
)

func TestRetryPublicationRenditionPreservesAcceptedWriteIdentityUntilExactTargetIsPublished(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name             string
		acceptedSubject  string
		firstStatus      string
		secondStatus     string
		expectedHTTPCode int
	}{
		{
			name:             "whole rendition acceptance without local persistence",
			acceptedSubject:  "rendition-1",
			firstStatus:      models.RenditionStatusFailed,
			secondStatus:     models.RenditionStatusFailed,
			expectedHTTPCode: http.StatusConflict,
		},
		{
			name:             "published earlier segment does not block later segment retry",
			acceptedSubject:  "segment-1",
			firstStatus:      models.RenditionStatusPublished,
			secondStatus:     models.RenditionStatusFailed,
			expectedHTTPCode: http.StatusOK,
		},
		{
			name:             "accepted failed segment without local persistence",
			acceptedSubject:  "segment-2",
			firstStatus:      models.RenditionStatusPublished,
			secondStatus:     models.RenditionStatusFailed,
			expectedHTTPCode: http.StatusConflict,
		},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			db := createHandlerTestDB(t,
				(*models.WorkspaceMember)(nil),
				(*models.Publication)(nil),
				(*models.Rendition)(nil),
				(*models.RenditionSegment)(nil),
				(*models.Job)(nil),
				(*models.ProviderWriteAttempt)(nil),
			)
			seedHandlerWorkspace(t, db)
			ctx := t.Context()
			now := time.Now().UTC()
			_, err := db.NewInsert().Model(&models.WorkspaceMember{
				WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleEditor,
			}).Exec(ctx)
			require.NoError(t, err)
			seedHandlerAccount(t, db, "account-1")
			publication := &models.Publication{
				ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
				Title: "Retry", ContentProfile: models.ContentProfileShortText,
				SourceText: "Retry", SourceContent: "Retry", Status: models.PublicationStatusFailed,
				MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: now, UpdatedAt: now,
			}
			_, err = db.NewInsert().Model(publication).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.Rendition{
				ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: "account-1",
				Platform: "x", Profile: models.ContentProfileThread, Body: "Retry",
				Status: models.RenditionStatusFailed, ErrorKind: "network", ErrorRetryable: true,
				SettingsJSON: "{}", CreatedAt: now, UpdatedAt: now,
			}).Exec(ctx)
			require.NoError(t, err)
			if testCase.acceptedSubject != "rendition-1" {
				_, err = db.NewInsert().Model(&[]models.RenditionSegment{
					{
						ID: "segment-1", RenditionID: "rendition-1", PublicationSegmentID: "source-1",
						Position: 0, Body: "First", Status: testCase.firstStatus,
						SettingsJSON: "{}", ExternalID: "external-1", CreatedAt: now, UpdatedAt: now,
					},
					{
						ID: "segment-2", RenditionID: "rendition-1", PublicationSegmentID: "source-2",
						Position: 1, Body: "Second", Status: testCase.secondStatus,
						SettingsJSON: "{}", CreatedAt: now, UpdatedAt: now,
					},
				}).Exec(ctx)
				require.NoError(t, err)
			}
			_, err = db.NewInsert().Model(&models.ProviderWriteAttempt{
				ID: "attempt-accepted", OperationID: "authorization:receipt-old:" + testCase.acceptedSubject + ":publish",
				AttemptNumber: 1, JobID: "job-old", AuthorizationID: "receipt-old",
				WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID, RenditionID: "rendition-1",
				SocialAccountID: "account-1", TargetKey: "x", Provider: "x", Operation: "publish",
				PayloadFingerprint: "sha256:accepted", Status: providerwrite.StatusAccepted,
				SubmissionState: "accepted", RetrySafety: "never", ExternalID: "external-old",
				CreatedAt: now, UpdatedAt: now,
			}).Exec(ctx)
			require.NoError(t, err)

			e := echo.New()
			api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)
			req := httptest.NewRequestWithContext(
				ctx,
				http.MethodPost,
				"/api/v1/publications/publication-1/renditions/account-1/retry",
				nil,
			)
			req.Header.Set("Authorization", "Bearer web-token")
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.Equal(t, testCase.expectedHTTPCode, rec.Code, rec.Body.String())

			var current models.Rendition
			require.NoError(t, db.NewSelect().Model(&current).Where("id = ?", "rendition-1").Scan(ctx))
			jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
			require.NoError(t, err)
			if testCase.expectedHTTPCode == http.StatusOK {
				require.Equal(t, models.RenditionStatusScheduled, current.Status)
				require.EqualValues(t, 1, jobCount)
			} else {
				require.Equal(t, models.RenditionStatusFailed, current.Status)
				require.Zero(t, jobCount)
			}
		})
	}
}
