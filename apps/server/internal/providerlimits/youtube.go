package providerlimits

import (
	"fmt"
	"strings"
)

const YouTubeDescriptionMaxBytes = 5000

// ValidateYouTubeDescription checks the exact UTF-8 text sent in snippet.description.
// https://developers.google.com/youtube/v3/docs/videos#snippet.description
func ValidateYouTubeDescription(description string) error {
	description = strings.TrimSpace(description)
	if len(description) > YouTubeDescriptionMaxBytes {
		return fmt.Errorf("YouTube descriptions are limited to %d bytes", YouTubeDescriptionMaxBytes)
	}
	if strings.ContainsAny(description, "<>") {
		return fmt.Errorf("YouTube descriptions cannot contain < or >")
	}
	return nil
}
