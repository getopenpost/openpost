package platform

// PublishingSettingContract documents where every composer setting is
// consumed. AdapterKeys are translated into provider requests. PipelineKeys
// are handled by publication orchestration before the adapter call.
type PublishingSettingContract struct {
	AdapterKeys  []string
	PipelineKeys []string
}

func PublishingSettingsContract(provider string) PublishingSettingContract {
	contracts := map[string]PublishingSettingContract{
		providerX: {
			AdapterKeys: []string{"url", "quote_url", "poll_options", "poll_duration_minutes", "reply_settings", "community_id", "location_id", "paid_partnership", "made_with_ai", "tagged_users", "alt_text"},
		},
		providerMastodon: {
			AdapterKeys: []string{"url", "visibility", "spoiler_text", "sensitive", "language", "poll_options", "poll_expires_in_seconds", "poll_multiple", "poll_hide_totals", "focal_point", "alt_text"},
		},
		providerBluesky: {
			AdapterKeys: []string{"link_url", "link_title", "link_description", "quote_url", "languages", "self_labels", "reply_gate", "thread_gate", "alt_text"},
		},
		providerLinkedIn: {
			AdapterKeys:  []string{"url", "visibility", "reshare_disabled", "poll_options", "poll_duration", "article_title", "article_description", "document_title", "alt_text"},
			PipelineKeys: []string{"first_comment"},
		},
		providerFacebook: {
			AdapterKeys:  []string{"url", "video_title", "video_description", "share_to_feed"},
			PipelineKeys: []string{"first_comment"},
		},
		providerInstagram: {
			AdapterKeys: []string{"is_trial_reel", "graduation_strategy", "collaborators", "location_id", "user_tags", "product_tags", "cover_media_id", "thumbnail_timestamp_ms", "share_to_feed", "alt_text"},
		},
		providerThreads: {
			AdapterKeys: []string{"url", "poll_options", "text_attachment_plaintext", "text_attachment_link_url", "gif_id", "reply_control", "topic_tag", "location_id", "spoiler", "ghost_post", "reply_approvals", "alt_text"},
		},
		providerYouTube: {
			AdapterKeys: []string{"privacy", "title", "description", "tags", "category_id", "playlist_id", "thumbnail_media_id", "caption_media_id", "caption_language", "license", "embeddable", "self_declared_made_for_kids", "contains_synthetic_media", "paid_placement", "notify_subscribers"},
		},
		providerTikTok: {
			AdapterKeys:  []string{"content_posting_method", "privacy_level", "duet", "stitch", "comment", "photo_title", "cover_index", "auto_add_music", "brand_content_toggle", "brand_organic_toggle", "is_aigc", "cover_timestamp_ms"},
			PipelineKeys: []string{"music_usage_confirmed"},
		},
	}
	return contracts[provider]
}
