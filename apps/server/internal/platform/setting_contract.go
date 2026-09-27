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
		providerPixelfed: {
			AdapterKeys: []string{"url", "visibility", "spoiler_text", "sensitive", "language", "poll_options", "poll_expires_in_seconds", "poll_multiple", "poll_hide_totals", "alt_text"},
		},
		providerPeerTube: {
			AdapterKeys: []string{"channel", "title", "description", "privacy", "language", "category", "licence", "tags", "nsfw", "nsfw_summary", "comments_policy", "download_enabled", "support", "caption_language"},
		},
		providerLemmy: {
			AdapterKeys: []string{"community", "title", "body", "url", "nsfw", "language_id", "alt_text"},
		},
		providerPieFed: {
			AdapterKeys: []string{"community", "title", "body", "url", "nsfw", "language_id"},
		},
		providerBluesky: {
			AdapterKeys: []string{"link_url", "link_title", "link_description", "quote_url", "languages", "self_labels", "reply_gate", "thread_gate", "alt_text"},
		},
		providerLinkedIn: {
			AdapterKeys:  []string{"url", "visibility", "reshare_disabled", "poll_options", "poll_question", "poll_duration", "article_title", "article_description", "document_title", "alt_text"},
			PipelineKeys: []string{"first_comment"},
		},
		providerFacebook: {
			AdapterKeys:  []string{"url", "video_title", "video_description", "share_to_feed"},
			PipelineKeys: []string{"first_comment"},
		},
		providerGoogleBusiness: {
			AdapterKeys: []string{"location_id", "topic_type", "language_code", "call_to_action", "action_url", "event_title", "event_start_date", "event_start_time", "event_end_date", "event_end_time", "offer_coupon_code", "offer_redeem_url", "offer_terms"},
		},
		providerInstagram: {
			AdapterKeys:  []string{"is_trial_reel", "graduation_strategy", "collaborators", "location_id", "user_tags", "product_tags", "cover_media_id", "thumbnail_timestamp_ms", "share_to_feed", "alt_text"},
			PipelineKeys: []string{"first_comment"},
		},
		providerThreads: {
			AdapterKeys: []string{"url", "poll_options", "text_attachment_plaintext", "text_attachment_link_url", "gif_id", "reply_control", "topic_tag", "location_id", "spoiler", "ghost_post", "reply_approvals", "alt_text"},
		},
		providerYouTube: {
			AdapterKeys:  []string{"privacy", "title", "description", "tags", "category_id", "playlist_id", "thumbnail_media_id", "caption_media_id", "caption_language", "license", "embeddable", "self_declared_made_for_kids", "contains_synthetic_media", "paid_placement", "notify_subscribers"},
			PipelineKeys: []string{"first_comment"},
		},
		providerTikTok: {
			AdapterKeys:  []string{"content_posting_method", "privacy_level", "duet", "stitch", "comment", "photo_title", "cover_index", "auto_add_music", "brand_content_toggle", "brand_organic_toggle", "is_aigc", "cover_timestamp_ms"},
			PipelineKeys: []string{"music_usage_confirmed"},
		},
		providerPinterest: {
			AdapterKeys: []string{"board_id", "section_id", "pin_title", "destination_link", "cover_media_id", "alt_text", "is_ai_generated"},
		},
		providerTelegram: {
			AdapterKeys: []string{"chat_id", "disable_notification", "protect_content"},
		},
		providerDiscord: {
			AdapterKeys: []string{"channel_id", "embed", "mention_policy", "mention_user_ids", "mention_role_ids"},
		},
	}
	return contracts[provider]
}
