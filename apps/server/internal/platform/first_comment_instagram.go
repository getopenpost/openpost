package platform

import (
	"context"
	"net/http"
	"strings"
)

// publishTopLevelComment posts a first comment on Instagram media. Replies to
// comments use the /replies edge; a comment on media uses /comments.
func (i *InstagramAdapter) publishTopLevelComment(ctx context.Context, accessToken, mediaID, message string) (string, error) {
	values := map[string]string{
		"message":             strings.TrimSpace(message),
		oauthParamAccessToken: accessToken,
	}
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, i.graphURL(mediaID+"/comments"), values, nil)
	if err != nil {
		return "", normalizeMetaPublishError(err)
	}
	return instagramIDFromResponse("instagram comment publish", respBody)
}
