package platform

import (
	"errors"
	"log"
)

// Log a fixed endpoint template and bounded provider metadata, never the
// request URL, token, caption, response body, or arbitrary error text.
func (i *InstagramAdapter) logRequestFailure(operation, objectID string, err error) {
	endpoint := ""
	switch operation {
	case "media_create":
		endpoint = "/{ig_user_id}/media"
	case "container_status":
		endpoint = "/{container_id}"
	case "media_publish":
		endpoint = "/{ig_user_id}/media_publish"
	default:
		return
	}
	if len(objectID) > 64 || !instagramLoginUserID.MatchString(objectID) {
		objectID = ""
	}
	host := "graph.facebook.com"
	if i.instagramLogin {
		host = "graph.instagram.com"
	}
	var providerErr *HTTPError
	if errors.As(err, &providerErr) {
		log.Printf("[Instagram Request] host=%q operation=%q endpoint=%q object_id=%q status=%d code=%q subcode=%q trace=%q",
			host, operation, endpoint, objectID, providerErr.StatusCode,
			firstSafeProviderCode([]any{providerErr.Code}), firstSafeProviderCode([]any{providerErr.Subcode}), firstSafeProviderCode([]any{providerErr.TraceID}))
		return
	}
	log.Printf("[Instagram Request] host=%q operation=%q endpoint=%q object_id=%q", host, operation, endpoint, objectID)
}
