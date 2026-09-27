package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/openpost/backend/internal/services/lifecycle"

	"github.com/PuerkitoBio/goquery"
	"github.com/mmcdole/gofeed"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const maxSourceBytes = 2 * 1024 * 1024
const maxSourceItems = 500

// Release asset metadata can dwarf the notes, so keep each page within the
// shared response budget while the persisted cursor covers older releases.
const githubReleasesPerPage = 10

var sourceURLPolicy = netguard.URLPolicy{Label: "workflow source", AllowedSchemes: []string{"https", "http"}}

type WorkflowSourceItem struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Body          string `json:"body"`
	URL           string `json:"url"`
	PublishedAt   string `json:"published_at"`
	PublicationID string `json:"publication_id,omitempty"`
	RenditionID   string `json:"rendition_id,omitempty"`
	AccountID     string `json:"account_id,omitempty"`
}

func (s *Service) Sample(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string, source Source) ([]SourceItem, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	if err := Validate(Definition{Schema: SchemaVersion, Source: source, Steps: []Step{{ID: "sample", Kind: KindWait, Inputs: map[string]Value{"minutes": {Literal: 1}}}}}, true); err != nil {
		return nil, err
	}
	items, err := s.readSource(ctx, workspaceID, source, time.Time{})
	if err != nil {
		return nil, invalid(err.Error())
	}
	if len(items) > 5 {
		items = items[:5]
	}
	return items, nil
}

func (s *Service) readSource(ctx context.Context, workspaceID string, source Source, since time.Time) ([]SourceItem, error) {
	switch source.Kind {
	case "manual":
		return []SourceItem{{ID: "sample", Title: "A new product update", Body: "We shipped a useful improvement. Here is what changed.", URL: "https://example.com/update", PublishedAt: time.Now().UTC().Format(time.RFC3339)}}, nil
	case "github_release":
		return s.githubReleases(ctx, workspaceID, source)
	case "rss":
		return s.feedItems(ctx, source.URL)
	case "rendition_published":
		return s.publishedItems(ctx, workspaceID, source.AccountIDs, since, nil)
	default:
		return nil, invalid("unsupported source")
	}
}

func (s *Service) readURL(ctx context.Context, address, token string) ([]byte, error) {
	remote, err := url.Parse(address)
	if err != nil || remote.User != nil {
		return nil, invalid("source URL is invalid")
	}
	if err := netguard.ValidateURL(ctx, remote, sourceURLPolicy); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remote.String(), nil)
	if err != nil {
		return nil, invalid("source URL is invalid")
	}
	req.Header.Set("User-Agent", "OpenPost-Workflows")
	req.Header.Set("Accept", "application/json, application/atom+xml, application/rss+xml, application/xml, text/xml")
	if remote.Host == "api.github.com" {
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	// A token is sent only to api.github.com. Never forward it to a redirect.
	client := *s.client
	client.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("source redirected too many times")
		}
		if token != "" && (next.URL.Host != remote.Host || next.URL.Scheme != "https") {
			return errors.New("authenticated source redirected to another host")
		}
		return netguard.ValidateURL(next.Context(), next.URL, sourceURLPolicy)
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, errors.New("source could not be reached; check its address and try again")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("source returned HTTP %d; check access and provider limits", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxSourceBytes+1))
	if err != nil {
		return nil, errors.New("source response could not be read")
	}
	if len(data) > maxSourceBytes {
		return nil, errors.New("source exceeds the 2 MB response limit")
	}
	return data, nil
}
func (s *Service) githubReleases(ctx context.Context, workspaceID string, source Source) ([]SourceItem, error) {
	items, _, err := s.githubReleasePage(ctx, workspaceID, source, 1)
	return items, err
}

// Check recent releases on every poll while a persisted cursor reconciles older
// pages. Offset movement may repeat a release; the admission ledger removes it.
func (s *Service) pollGitHub(ctx context.Context, record workflowRecord, source Source, since time.Time) ([]SourceItem, int, error) {
	items, more, err := s.githubReleasePage(ctx, record.WorkspaceID, source, 1)
	if err != nil {
		return nil, record.SourcePage, err
	}
	next := 1
	if more {
		page := max(2, record.SourcePage)
		older, moreOlder, err := s.githubReleasePage(ctx, record.WorkspaceID, source, page)
		if err != nil {
			return nil, record.SourcePage, err
		}
		items = append(items, older...)
		next = 2
		if moreOlder {
			next = page + 1
		}
	}
	result := make([]SourceItem, 0, len(items))
	for _, item := range items {
		published, err := time.Parse(time.RFC3339, item.PublishedAt)
		if err != nil {
			return nil, record.SourcePage, errors.New("GitHub returned an invalid release date")
		}
		// GitHub dates have second precision. Baseline IDs disambiguate the activation second.
		if !published.Before(since.Truncate(time.Second)) {
			result = append(result, item)
		}
	}
	return result, next, nil
}
func (s *Service) githubReleasePage(ctx context.Context, workspaceID string, source Source, page int) ([]SourceItem, bool, error) {
	if !repositoryPattern.MatchString(source.Repository) {
		return nil, false, invalid("GitHub repository must be owner/repository")
	}
	token, err := s.connectionToken(ctx, workspaceID, source.ConnectionID)
	if err != nil {
		return nil, false, err
	}
	data, err := s.readURL(ctx, "https://api.github.com/repos/"+source.Repository+"/releases?per_page="+strconv.Itoa(githubReleasesPerPage)+"&page="+strconv.Itoa(page), token)
	if err != nil {
		return nil, false, err
	}
	var releases []struct {
		ID          int64  `json:"id"`
		Name        string `json:"name"`
		Tag         string `json:"tag_name"`
		Body        string `json:"body"`
		URL         string `json:"html_url"`
		PublishedAt string `json:"published_at"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
	}
	if err := json.Unmarshal(data, &releases); err != nil {
		return nil, false, errors.New("GitHub returned an invalid release list")
	}
	result := make([]SourceItem, 0, len(releases))
	for _, release := range releases {
		if release.Draft || (!source.IncludePrereleases && release.Prerelease) {
			continue
		}
		title := release.Name
		if title == "" {
			title = release.Tag
		}
		result = append(result, SourceItem{ID: strconv.FormatInt(release.ID, 10), Title: boundedText(title), Body: boundedText(release.Body), URL: release.URL, PublishedAt: release.PublishedAt})
	}
	return result, len(releases) == githubReleasesPerPage, nil
}
func (s *Service) feedItems(ctx context.Context, address string) ([]SourceItem, error) {
	data, err := s.readURL(ctx, address, "")
	if err != nil {
		return nil, err
	}
	feed, err := gofeed.NewParser().ParseString(string(data))
	if err != nil {
		return nil, errors.New("this address did not return a readable RSS or Atom feed")
	}
	if len(feed.Items) > maxSourceItems {
		return nil, errors.New("feed exceeds the 500 item limit")
	}
	result := make([]SourceItem, 0, len(feed.Items))
	for _, item := range feed.Items {
		key := item.GUID
		if key == "" {
			key = item.Link
		}
		if key == "" {
			key, err = idempotency.Hash([]string{item.Title, item.Published, item.Content})
			if err != nil {
				return nil, err
			}
		}
		body := item.Content
		if body == "" {
			body = item.Description
		}
		document, err := goquery.NewDocumentFromReader(strings.NewReader(body))
		if err == nil {
			document.Find("script, style").Remove()
			body = document.Text()
		}
		published := ""
		if item.PublishedParsed != nil {
			published = item.PublishedParsed.UTC().Format(time.RFC3339)
		}
		result = append(result, SourceItem{ID: key, Title: boundedText(item.Title), Body: boundedText(body), URL: item.Link, PublishedAt: published})
	}
	return result, nil
}
func boundedText(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= MaxTextBytes {
		return value
	}
	end := MaxTextBytes
	for !utf8.RuneStart(value[end]) {
		end--
	}
	return value[:end]
}
func (s *Service) publishedItems(ctx context.Context, workspaceID string, accounts []string, since time.Time, workflow *workflowRecord) ([]SourceItem, error) {
	type row struct {
		ID              string
		PublicationID   string
		SocialAccountID string
		Title           string
		SourceText      string
		PlatformURL     string
		PublishedAt     time.Time
	}
	rows := []row{}
	query := s.db.NewSelect().TableExpr("renditions AS r").
		ColumnExpr("r.id, r.publication_id, r.social_account_id, p.title, p.source_text, r.external_url AS platform_url, (SELECT MAX(e.created_at) FROM publication_lifecycle_events e WHERE e.rendition_id = r.id AND e.type = 'published') AS published_at").
		Join("JOIN publications AS p ON p.id = r.publication_id").Where("p.workspace_id = ? AND r.status = ?", workspaceID, models.RenditionStatusPublished).
		Limit(maxSourceItems)
	if !since.IsZero() {
		query = query.Where("EXISTS (SELECT 1 FROM publication_lifecycle_events e WHERE e.rendition_id = r.id AND e.type = ? AND e.created_at >= ?)", lifecycle.EventPublished, since)
	}
	if workflow == nil {
		query = query.OrderExpr("published_at DESC, r.id DESC")
	} else {
		query = query.OrderExpr("published_at ASC, r.id ASC")
	}
	if workflow != nil {
		query = query.Where("NOT EXISTS (SELECT 1 FROM workflow_events admitted WHERE admitted.workflow_id = ? AND admitted.source_fingerprint = ? AND admitted.event_key = r.id)", workflow.ID, workflow.SourceFingerprint)
	}
	if len(accounts) > 0 {
		query = query.Where("r.social_account_id IN (?)", bun.List(accounts))
	}
	if err := query.Scan(ctx, &rows); err != nil {
		return nil, err
	}
	slices.SortFunc(rows, func(a, b row) int { return b.PublishedAt.Compare(a.PublishedAt) })
	result := make([]SourceItem, 0, len(rows))
	for _, row := range rows {
		result = append(result, SourceItem{ID: row.ID, Title: row.Title, Body: row.SourceText, URL: row.PlatformURL, PublishedAt: row.PublishedAt.UTC().Format(time.RFC3339), PublicationID: row.PublicationID, RenditionID: row.ID, AccountID: row.SocialAccountID})
	}
	return result, nil
}

type SourceItem = WorkflowSourceItem
