package platform

import (
	"context"

	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFacebookAndLinkedInFirstCommentReuseCommentPath(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Host, "linkedin") {
			return jsonResponse(req, `{"id":"1","commentUrn":"urn:li:comment:(urn:li:activity:1,2)"}`), nil
		}
		return jsonResponse(req, `{"id":"fb-comment-1"}`), nil
	})}

	fbID, err := (&FacebookAdapter{graphVersion: "v25.0"}).PostFirstComment(context.Background(), "token", "page-1", "post-1", "First!")
	require.NoError(t, err)
	require.Equal(t, "fb-comment-1", fbID)

	liID, err := (&LinkedInAdapter{}).PostFirstComment(context.Background(), "token", "urn:li:person:1", "urn:li:share:1", "First!")
	require.NoError(t, err)
	require.Equal(t, "urn:li:comment:(urn:li:activity:1,2)", liID)
}
