package publications

import (
	"reflect"
	"sort"

	"github.com/openpost/backend/internal/services/publicationlink"
	"github.com/openpost/backend/internal/services/publicationpoll"
)

type revisionContent struct {
	Title, Intent, CreationPreset, ContentProfile, SourceText, SourceURL, Goal, Audience string
	Segments                                                                             []revisionSegmentContent
}

type revisionSegmentContent struct{ Body, Title, Description, URL string }
type revisionTarget struct{ AccountID, TargetKey string }
type revisionMedia struct {
	ID, Role, AltText    string
	ThumbnailTimestampMS int
	Settings             map[string]any
}
type revisionSourceOverride struct {
	Source         int
	Body           *string
	MediaInherited bool
}
type revisionSegmentOverride struct {
	Source                        int
	Body, Title, Description, URL *string
	MediaInherited                bool
	Sources                       []revisionSourceOverride
	Settings                      map[string]any
}
type revisionDestinationOverride struct {
	Target                   revisionTarget
	Profile, OutputProfile   string
	FormatLocked             bool
	Body, Title, Description string
	Settings                 map[string]any
	Segments                 []revisionSegmentOverride
}
type revisionMediaKey struct {
	Target          revisionTarget
	Segment, Source int
}

type revisionSchedule struct {
	ScheduledAt, ActualRunAt string
	RandomDelayMinutes       int
	RandomDelayInherited     bool
	Destinations             map[revisionTarget]string
}

type revisionProjection struct {
	content      revisionContent
	segmentCount int
	destinations []revisionTarget
	socialSetID  string
	overrides    map[revisionTarget]revisionDestinationOverride
	media        map[revisionMediaKey][]revisionMedia
	settings     map[int]map[string]any
	schedule     revisionSchedule
}

// ChangedAuthoredDomains compares stored authorship, not the fields included in
// a save request or the regenerated delivery IDs and effective inherited output.
func ChangedAuthoredDomains(before, after PublicationResponse) []string {
	left, right := projectRevision(before), projectRevision(after)
	domains := make([]string, 0)
	add := func(domain string, changed bool) {
		if changed {
			domains = append(domains, domain)
		}
	}
	add("content", !reflect.DeepEqual(left.content, right.content))
	add("segments", left.segmentCount != right.segmentCount)
	add("destinations", left.socialSetID != right.socialSetID || !reflect.DeepEqual(left.destinations, right.destinations))
	add("destination overrides", !reflect.DeepEqual(left.overrides, right.overrides))
	add("media", !reflect.DeepEqual(left.media, right.media))
	add("settings", !reflect.DeepEqual(left.settings, right.settings))
	add("schedule", !reflect.DeepEqual(left.schedule, right.schedule))
	add("repost automation", !reflect.DeepEqual(before.RepostOverride, after.RepostOverride))
	sort.Strings(domains)
	return domains
}

func projectRevision(publication PublicationResponse) revisionProjection {
	projection := revisionProjection{
		content:      revisionContent{Title: publication.Title, Intent: publication.Intent, CreationPreset: publication.CreationPreset, ContentProfile: publication.ContentProfile, SourceText: publication.SourceText, SourceURL: publication.SourceURL, Goal: publication.Goal, Audience: publication.Audience, Segments: make([]revisionSegmentContent, 0, len(publication.Segments))},
		segmentCount: len(publication.Segments), socialSetID: publication.SocialSetID,
		destinations: make([]revisionTarget, 0, len(publication.Renditions)), overrides: map[revisionTarget]revisionDestinationOverride{},
		media: map[revisionMediaKey][]revisionMedia{}, settings: map[int]map[string]any{},
		schedule: revisionSchedule{ScheduledAt: publication.ScheduledAt, ActualRunAt: publication.ActualRunAt, RandomDelayMinutes: publication.RandomDelayMinutes, RandomDelayInherited: publication.RandomDelayInherited, Destinations: map[revisionTarget]string{}},
	}
	if len(publication.Metadata) > 0 {
		projection.settings[-1] = publication.Metadata
	}
	sources := make(map[string]int, len(publication.Segments))
	for index, segment := range publication.Segments {
		sources[segment.ID] = index
		projection.content.Segments = append(projection.content.Segments, revisionSegmentContent{segment.Body, segment.Title, segment.Description, segment.URL})
		key := revisionMediaKey{Segment: index, Source: -1}
		if len(segment.Settings) > 0 {
			projection.settings[index] = segment.Settings
		}
		if len(segment.Media) > 0 {
			projection.media[key] = projectRevisionMedia(segment.Media)
		}
	}
	for _, rendition := range publication.Renditions {
		projectRevisionDestination(&projection, publication, rendition, sources)
	}
	return projection
}

func projectRevisionDestination(projection *revisionProjection, publication PublicationResponse, rendition RenditionResponse, sources map[string]int) {
	target := revisionTarget{rendition.SocialAccountID, rendition.TargetKey}
	projection.destinations = append(projection.destinations, target)
	if rendition.ScheduleOverride != "" {
		projection.schedule.Destinations[target] = rendition.ScheduleOverride
	}
	variant := revisionDestinationOverride{Target: target, FormatLocked: rendition.FormatLocked, Settings: revisionSettings(rendition.Settings), Segments: make([]revisionSegmentOverride, 0, len(rendition.Segments))}
	if variant.FormatLocked {
		variant.Profile, variant.OutputProfile = rendition.Profile, rendition.OutputProfile
	}
	if len(rendition.Segments) == 0 {
		variant.Body, variant.Title, variant.Description = rendition.Body, rendition.Title, rendition.Description
	}
	for index, segment := range rendition.Segments {
		source := sources[segment.PublicationSegmentID]
		settings := segment.Settings
		if source < len(publication.Segments) {
			settings = publicationpoll.AuthoredDestinationSettings(publication.Segments[source].Settings, rendition.SocialAccountID, settings)
			settings = publicationlink.AuthoredDestinationSettings(publication.Segments[source].Settings, rendition.SocialAccountID, settings)
		}
		item := revisionSegmentOverride{Source: source, Body: segment.BodyOverride, Title: segment.TitleOverride, Description: segment.DescriptionOverride, URL: segment.URLOverride, MediaInherited: segment.MediaInherited, Settings: revisionSettings(settings), Sources: make([]revisionSourceOverride, 0, len(segment.SourceOverrides))}
		if len(segment.SourceOverrides) > 0 {
			// Joined body/media are projections of the per-source authorship.
			item.Body, item.MediaInherited = nil, true
		}
		key := revisionMediaKey{Target: target, Segment: index, Source: -1}
		if len(segment.SourceOverrides) == 0 && !segment.MediaInherited {
			projection.media[key] = projectRevisionMedia(segment.Media)
		}
		for _, override := range segment.SourceOverrides {
			item.Sources = append(item.Sources, revisionSourceOverride{sources[override.PublicationSegmentID], override.BodyOverride, override.MediaInherited})
			if !override.MediaInherited {
				projection.media[revisionMediaKey{Target: target, Segment: index, Source: sources[override.PublicationSegmentID]}] = projectRevisionMediaInputs(override.Media)
			}
		}
		variant.Segments = append(variant.Segments, item)
	}
	if renditionHasAuthoredOverrides(variant, len(publication.Segments)) {
		projection.overrides[target] = variant
	}
}

func projectRevisionMedia(media []MediaSummary) []revisionMedia {
	items := make([]revisionMedia, 0, len(media))
	for _, item := range media {
		items = append(items, revisionMedia{item.ID, item.Role, item.AltText, item.ThumbnailTimestampMS, revisionSettings(item.Settings)})
	}
	return items
}
func projectRevisionMediaInputs(media []PublicationMediaInput) []revisionMedia {
	items := make([]revisionMedia, 0, len(media))
	for _, item := range media {
		items = append(items, revisionMedia{item.MediaID, item.Role, item.AltText, item.ThumbnailTimestampMS, revisionSettings(item.Settings)})
	}
	return items
}

func renditionHasAuthoredOverrides(variant revisionDestinationOverride, sourceCount int) bool {
	if variant.FormatLocked || len(variant.Settings) > 0 || variant.Body != "" || variant.Title != "" || variant.Description != "" {
		return true
	}
	for index, segment := range variant.Segments {
		if segmentHasAuthoredOverrides(segment, index, len(variant.Segments), sourceCount) {
			return true
		}
	}
	return false
}

func segmentHasAuthoredOverrides(segment revisionSegmentOverride, index, outputCount, sourceCount int) bool {
	if segment.Body != nil || segment.Title != nil || segment.Description != nil || segment.URL != nil || !segment.MediaInherited || len(segment.Settings) > 0 {
		return true
	}
	if outputCount > 1 && segment.Source != index {
		return true
	}
	if len(segment.Sources) > 0 && len(segment.Sources) != sourceCount {
		return true
	}
	for sourceIndex, source := range segment.Sources {
		if source.Source != sourceIndex || source.Body != nil || !source.MediaInherited {
			return true
		}
	}
	return false
}

func revisionSettings(settings map[string]any) map[string]any {
	if len(settings) == 0 {
		return nil
	}
	return settings
}
