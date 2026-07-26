package models

import (
	"testing"
	"time"
)

func TestWorkspaceModel(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name      string
		workspace Workspace
	}{
		{
			name: "basic workspace",
			workspace: Workspace{
				ID:        "ws-123",
				Name:      "My Workspace",
				CreatedAt: now,
			},
		},
		{
			name: "workspace with special chars",
			workspace: Workspace{
				ID:        "ws-@#$%",
				Name:      "Test Workspace #1",
				CreatedAt: now,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.workspace.ID == "" {
				t.Error("ID should not be empty")
			}
			if tt.workspace.Name == "" {
				t.Error("Name should not be empty")
			}
			if tt.workspace.CreatedAt.IsZero() {
				t.Error("CreatedAt should not be zero")
			}
		})
	}
}

func TestUserModel(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name string
		user User
	}{
		{
			name: "basic user",
			user: User{
				ID:           "user-123",
				Email:        "user@example.com",
				PasswordHash: "$2a$10$hashedpassword",
				CreatedAt:    now,
			},
		},
		{
			name: "user with long password hash",
			user: User{
				ID:           "user-456",
				Email:        "test@test.org",
				PasswordHash: "$2a$12$verylonghashedpasswordstring",
				CreatedAt:    now,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.user.ID == "" {
				t.Error("ID should not be empty")
			}
			if tt.user.Email == "" {
				t.Error("Email should not be empty")
			}
			if tt.user.PasswordHash == "" {
				t.Error("PasswordHash should not be empty")
			}
		})
	}
}

func TestWorkspaceMemberModel(t *testing.T) {
	tests := []struct {
		name   string
		member WorkspaceMember
	}{
		{
			name: "admin member",
			member: WorkspaceMember{
				WorkspaceID: "ws-123",
				UserID:      "user-123",
				Role:        "admin",
			},
		},
		{
			name: "editor member",
			member: WorkspaceMember{
				WorkspaceID: "ws-456",
				UserID:      "user-456",
				Role:        "editor",
			},
		},
		{
			name: "viewer member",
			member: WorkspaceMember{
				WorkspaceID: "ws-789",
				UserID:      "user-789",
				Role:        "viewer",
			},
		},
	}

	validRoles := map[string]bool{
		"admin":  true,
		"editor": true,
		"viewer": true,
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.member.WorkspaceID == "" {
				t.Error("WorkspaceID should not be empty")
			}
			if tt.member.UserID == "" {
				t.Error("UserID should not be empty")
			}
			if !validRoles[tt.member.Role] {
				t.Errorf("invalid role: %s", tt.member.Role)
			}
		})
	}
}

func TestSocialAccountModel(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name    string
		account SocialAccount
	}{
		{
			name: "twitter account",
			account: SocialAccount{
				ID:              "acc-123",
				WorkspaceID:     "ws-123",
				Platform:        "x",
				AccountID:       "twitter-user-id",
				AccountUsername: "twitter_user",
				AccessTokenEnc:  []byte("encrypted-token"),
				IsActive:        true,
				CreatedAt:       now,
			},
		},
		{
			name: "mastodon account",
			account: SocialAccount{
				ID:              "acc-456",
				WorkspaceID:     "ws-123",
				Platform:        "mastodon",
				AccountID:       "mastodon-user-id",
				AccountUsername: "mastodon_user",
				InstanceURL:     "https://mastodon.social",
				AccessTokenEnc:  []byte("encrypted-token"),
				RefreshTokenEnc: []byte("encrypted-refresh"),
				TokenExpiresAt:  now.Add(1 * time.Hour),
				IsActive:        true,
				CreatedAt:       now,
			},
		},
		{
			name: "bluesky account",
			account: SocialAccount{
				ID:              "acc-789",
				WorkspaceID:     "ws-123",
				Platform:        "bluesky",
				AccountID:       "did:plc:abc123",
				AccountUsername: "bluesky_user.bsky.social",
				InstanceURL:     "https://bsky.social",
				AccessTokenEnc:  []byte("encrypted-did"),
				RefreshTokenEnc: []byte("encrypted-refresh-jwt"),
				IsActive:        true,
				CreatedAt:       now,
			},
		},
	}

	validPlatforms := map[string]bool{
		"x":        true,
		"mastodon": true,
		"bluesky":  true,
		"linkedin": true,
		"threads":  true,
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.account.ID == "" {
				t.Error("ID should not be empty")
			}
			if tt.account.WorkspaceID == "" {
				t.Error("WorkspaceID should not be empty")
			}
			if !validPlatforms[tt.account.Platform] {
				t.Errorf("invalid platform: %s", tt.account.Platform)
			}
			if len(tt.account.AccessTokenEnc) == 0 {
				t.Error("AccessTokenEnc should not be empty")
			}
		})
	}
}

func TestPostModel(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name string
		post Post
	}{
		{
			name: "draft post",
			post: Post{
				ID:          "post-123",
				WorkspaceID: "ws-123",
				CreatedByID: "user-123",
				Content:     "Hello world!",
				Status:      "draft",
				CreatedAt:   now,
			},
		},
		{
			name: "scheduled post",
			post: Post{
				ID:          "post-456",
				WorkspaceID: "ws-123",
				CreatedByID: "user-123",
				Content:     "Scheduled tweet",
				Status:      "scheduled",
				ScheduledAt: now.Add(1 * time.Hour),
				CreatedAt:   now,
			},
		},
		{
			name: "published post",
			post: Post{
				ID:          "post-789",
				WorkspaceID: "ws-123",
				CreatedByID: "user-123",
				Content:     "Already posted",
				Status:      PostStatusPublished,
				PublishedAt: now,
				CreatedAt:   now,
			},
		},
		{
			name: "thread post",
			post: Post{
				ID:             "post-thread-1",
				WorkspaceID:    "ws-123",
				CreatedByID:    "user-123",
				Content:        "Part 2 of thread",
				ParentPostID:   "post-thread-0",
				ThreadSequence: 1,
				Status:         "draft",
				CreatedAt:      now,
			},
		},
	}

	validStatuses := map[string]bool{
		"draft":      true,
		"scheduled":  true,
		"publishing": true,
		"published":  true,
		"failed":     true,
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.post.ID == "" {
				t.Error("ID should not be empty")
			}
			if tt.post.WorkspaceID == "" {
				t.Error("WorkspaceID should not be empty")
			}
			if tt.post.CreatedByID == "" {
				t.Error("CreatedByID should not be empty")
			}
			if tt.post.Content == "" {
				t.Error("Content should not be empty")
			}
			if !validStatuses[tt.post.Status] {
				t.Errorf("invalid status: %s", tt.post.Status)
			}
		})
	}
}

func TestPostDestinationModel(t *testing.T) {
	postDest := PostDestination{
		ID:              "pd-123",
		PostID:          "post-123",
		SocialAccountID: "acc-123",
		Status:          "pending",
	}

	if postDest.ID == "" {
		t.Error("ID should not be empty")
	}
	if postDest.PostID == "" {
		t.Error("PostID should not be empty")
	}
	if postDest.SocialAccountID == "" {
		t.Error("SocialAccountID should not be empty")
	}
}

func TestMediaAttachmentModel(t *testing.T) {
	media := MediaAttachment{
		ID:               "media-123",
		WorkspaceID:      "ws-123",
		FilePath:         "/uploads/image.png",
		StorageType:      "local",
		MimeType:         "image/png",
		ProcessingStatus: "ready",
	}

	if media.ID == "" {
		t.Error("ID should not be empty")
	}
	if media.StorageType != "local" && media.StorageType != "s3" {
		t.Errorf("invalid storage type: %s", media.StorageType)
	}
	if media.ProcessingStatus != "ready" {
		t.Errorf("expected ready status, got: %s", media.ProcessingStatus)
	}
}

func TestPostMediaModel(t *testing.T) {
	postMedia := PostMedia{
		PostID:       "post-123",
		MediaID:      "media-123",
		DisplayOrder: 0,
	}

	if postMedia.PostID == "" {
		t.Error("PostID should not be empty")
	}
	if postMedia.MediaID == "" {
		t.Error("MediaID should not be empty")
	}
}

func TestJobModel(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name string
		job  Job
	}{
		{
			name: "publish job",
			job: Job{
				ID:          "job-123",
				Type:        "publish_post",
				Payload:     `{"post_id":"post-123"}`,
				Status:      "pending",
				RunAt:       now.Add(1 * time.Hour),
				Attempts:    0,
				MaxAttempts: 3,
			},
		},
		{
			name: "processing job",
			job: Job{
				ID:          "job-456",
				Type:        "refresh_token",
				Payload:     `{"account_id":"acc-123"}`,
				Status:      "processing",
				RunAt:       now,
				Attempts:    1,
				MaxAttempts: 3,
				LockedAt:    now,
				LockedBy:    "worker-1",
			},
		},
		{
			name: "failed job",
			job: Job{
				ID:          "job-789",
				Type:        "publish_post",
				Payload:     `{"post_id":"post-456"}`,
				Status:      "failed",
				RunAt:       now.Add(-1 * time.Hour),
				Attempts:    3,
				MaxAttempts: 3,
				LastError:   "connection refused",
			},
		},
	}

	validTypes := map[string]bool{
		"publish_post":  true,
		"refresh_token": true,
	}

	validStatuses := map[string]bool{
		"pending":    true,
		"processing": true,
		"completed":  true,
		"failed":     true,
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.job.ID == "" {
				t.Error("ID should not be empty")
			}
			if !validTypes[tt.job.Type] {
				t.Errorf("invalid job type: %s", tt.job.Type)
			}
			if !validStatuses[tt.job.Status] {
				t.Errorf("invalid job status: %s", tt.job.Status)
			}
			if tt.job.MaxAttempts < 1 {
				t.Error("MaxAttempts should be at least 1")
			}
		})
	}
}
