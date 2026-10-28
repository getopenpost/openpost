package publicationsource

import (
	"encoding/json"

	"github.com/openpost/backend/internal/posttext"
)

const CaptionMentionsKey = "caption_mentions"

// CaptionMentions is independent whole-caption authorship, never a source edit.
type CaptionMentions struct {
	Field    string             `json:"field"`
	Body     string             `json:"body"`
	Mentions *posttext.Mentions `json:"mentions"`
}

func ReadCaptionMentions(settings map[string]any) (*CaptionMentions, error) {
	raw := settings[CaptionMentionsKey]
	if raw == nil {
		return nil, nil
	}
	data, err := json.Marshal(raw)
	if err != nil || len(data) > 128*1024 {
		return nil, posttext.ErrInvalid
	}
	var caption CaptionMentions
	if json.Unmarshal(data, &caption) != nil || (caption.Field != "description" && caption.Field != "video_description") || caption.Mentions == nil {
		return nil, posttext.ErrInvalid
	}
	if err := posttext.Validate(caption.Body, caption.Mentions); err != nil {
		return nil, err
	}
	return &caption, nil
}

// DeliveryCaption shares validation and network replacement for reads, readiness
// and fenced provider dispatch. The persisted caption remains authored text.
func DeliveryCaption(settings map[string]any, provider, authority string) (string, string, error) {
	caption, err := ReadCaptionMentions(settings)
	if err != nil || caption == nil {
		return "", "", err
	}
	if caption.Field == "description" && provider != "youtube" && provider != "peertube" || caption.Field == "video_description" && provider != "facebook" {
		return "", "", posttext.ErrInvalid
	}
	body, _, err := posttext.ForDestination(caption.Body, provider, authority, &posttext.Projection{Mentions: *caption.Mentions})
	return caption.Field, body, err
}
