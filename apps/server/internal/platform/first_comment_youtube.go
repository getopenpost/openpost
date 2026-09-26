package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

var errMissingYouTubeCommentID = errors.New("youtube comment publish: missing comment id")

// PostFirstComment inserts a top-level comment thread on a YouTube video.
// Replies to comments use /comments; a first comment uses /commentThreads.
func (y *YouTubeAdapter) PostFirstComment(ctx context.Context, accessToken, _, externalID, message string) (string, error) {
	message, videoID, err := requireFirstComment(message, externalID)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(map[string]any{
		"snippet": map[string]any{
			"videoId": videoID,
			"topLevelComment": map[string]any{
				"snippet": map[string]string{"textOriginal": message},
			},
		},
	})
	if err != nil {
		return "", err
	}
	query := url.Values{"part": {"snippet"}}
	response, err := doYouTubeRequest(ctx, http.MethodPost, youtubeAPIBaseURL+"/commentThreads?"+query.Encode(), bytes.NewReader(payload), map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		headerContentType:   contentTypeJSON,
	})
	if err != nil {
		return "", err
	}
	if err := youtubeAPIError(response); err != nil {
		return "", err
	}
	var result struct {
		ID      string `json:"id"`
		Snippet struct {
			TopLevelComment struct {
				ID string `json:"id"`
			} `json:"topLevelComment"`
		} `json:"snippet"`
	}
	if err := json.Unmarshal(response.body, &result); err != nil {
		return "", err
	}
	commentID := strings.TrimSpace(firstNonEmptyString(result.Snippet.TopLevelComment.ID, result.ID))
	if commentID == "" {
		return "", errMissingYouTubeCommentID
	}
	return commentID, nil
}
