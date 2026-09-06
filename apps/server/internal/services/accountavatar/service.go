package accountavatar

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/services/mediastore"
)

const (
	accountAvatarKeyPrefix = "avatar_account_"
	accountAvatarURLPrefix = "/avatars/"
	maxAccountAvatarBytes  = 4 * 1024 * 1024
)

var unsafeObjectKeyCharacter = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

type Service struct {
	storage     mediastore.BlobStorage
	httpClient  *http.Client
	validateURL func(context.Context, *url.URL) error
}

func New(storage mediastore.BlobStorage) *Service {
	policy := netguard.URLPolicy{Label: "profile photo URL", AllowedSchemes: []string{"https"}}
	service := &Service{
		storage:    storage,
		httpClient: netguard.NewHTTPClient(15*time.Second, policy),
		validateURL: func(ctx context.Context, remote *url.URL) error {
			if !isLinkedInMediaHost(remote.Hostname()) {
				return fmt.Errorf("profile photo URL is not hosted by LinkedIn")
			}
			return netguard.ValidateURL(ctx, remote, policy)
		},
	}
	service.httpClient.CheckRedirect = func(req *http.Request, _ []*http.Request) error {
		return service.validateURL(req.Context(), req.URL)
	}
	return service
}

func (s *Service) CacheLinkedIn(ctx context.Context, accountID, rawURL string) (string, error) {
	remote, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || remote == nil {
		return "", fmt.Errorf("invalid LinkedIn profile photo URL")
	}
	if err := s.validateURL(ctx, remote); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remote.String(), nil)
	if err != nil {
		return "", fmt.Errorf("create LinkedIn profile photo request: %w", err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", errors.New("fetch LinkedIn profile photo request failed")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("LinkedIn profile photo returned HTTP %d", resp.StatusCode)
	}

	content, err := io.ReadAll(io.LimitReader(resp.Body, maxAccountAvatarBytes+1))
	if err != nil {
		return "", fmt.Errorf("read LinkedIn profile photo: %w", err)
	}
	if len(content) == 0 || len(content) > maxAccountAvatarBytes {
		return "", fmt.Errorf("LinkedIn profile photo must be between 1 byte and 4MB")
	}
	contentType := http.DetectContentType(content)
	extension := imageExtension(contentType)
	if extension == "" {
		return "", fmt.Errorf("LinkedIn profile photo has unsupported content type %q", contentType)
	}

	key := fmt.Sprintf(
		accountAvatarKeyPrefix+"%s_%s%s",
		unsafeObjectKeyCharacter.ReplaceAllString(accountID, "_"),
		uuid.NewString(),
		extension,
	)
	if _, err := mediastore.SaveWithContentType(ctx, s.storage, key, bytes.NewReader(content), contentType); err != nil {
		_ = mediastore.DeleteForCleanup(ctx, s.storage, key)
		return "", fmt.Errorf("save LinkedIn profile photo: %w", err)
	}
	return accountAvatarURLPrefix + key, nil
}

func (s *Service) Delete(ctx context.Context, avatarURL string) error {
	remote, err := url.Parse(strings.TrimSpace(avatarURL))
	if err != nil {
		return nil
	}
	key := filepath.Base(remote.Path)
	if !strings.HasPrefix(key, accountAvatarKeyPrefix) {
		return nil
	}
	return mediastore.DeleteForCleanup(ctx, s.storage, key)
}

func isLinkedInMediaHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "media.licdn.com" || strings.HasSuffix(host, ".licdn.com")
}

func imageExtension(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}
