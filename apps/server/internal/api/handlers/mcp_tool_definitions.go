package handlers

import (
	"strings"

	"github.com/openpost/backend/internal/platform"
	engagementservice "github.com/openpost/backend/internal/services/engagement"
)

func mcpListWorkspacesTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolWorkspaces,
		"title":       "List workspaces",
		"description": "List workspaces before any workspace-scoped task when no workspace ID is known. Returns each accessible workspace ID, name, role, and creation time.",
		"inputSchema": map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpListProviderCatalogTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolProviders,
		"title":       "List provider catalog",
		"description": "Inspect the provider catalog before choosing a social platform. Returns each provider's launch status, configuration state, capabilities, and availability notes. Then call list_accounts for workspace destinations and get_provider_readiness for account-scoped readiness checks.",
		"inputSchema": map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpListAccountsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolAccounts,
		"title":       "List social accounts",
		"description": "List connected destinations before drafting or scheduling for a workspace. Returns active social account IDs, platforms, slugs, usernames, and instance URLs. Pair with list_provider_catalog for platform availability and get_provider_readiness for account-scoped checks before scheduling.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpListMediaTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolListMedia,
		"title":       "List media",
		"description": "Find existing workspace assets before uploading or attaching media. Returns media IDs, file details, processing state, usage, and deletion eligibility in newest-first order, up to limit items per response. Follow next_cursor with the cursor input while has_more is true instead of widening the limit.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"limit": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"maximum":     100,
					"description": "Maximum media items to return. Defaults to 20.",
				},
				"cursor": map[string]any{
					"type":        "string",
					"description": "Opaque cursor from a previous response's next_cursor. Repeat all other filters unchanged while paging.",
				},
				"filter": map[string]any{
					"type":        "string",
					"enum":        []string{"all", "favorites", "used", "unused"},
					"description": "Optional media filter. Defaults to all.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpProviderReadinessTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolReadiness,
		"title":       "Get provider readiness",
		"description": "Check whether configured providers are ready before scheduling or publishing. Returns provider app, account scope, public-media, quota, and audit readiness details. Start from list_provider_catalog for platform availability, then list_accounts for the workspace destinations these checks evaluate.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpCreatePublicationTool() mcpOperationDefinition {
	mediaSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"media_id":               map[string]any{"type": "string", "description": "Media attachment ID returned by list_media, upload_media_from_url, or upload_media_base64."},
			"role":                   map[string]any{"type": "string", "description": "Media role such as attachment, cover, or thumbnail."},
			"alt_text":               map[string]any{"type": "string", "description": "Alt text override."},
			"thumbnail_timestamp_ms": map[string]any{"type": "integer", "description": "Video thumbnail timestamp in milliseconds."},
		},
		"required":             []string{"media_id"},
		"additionalProperties": false,
	}
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolCreatePub,
		"title":       "Create post",
		"description": "Create a format-first post draft when one source needs provider-specific outputs, such as a YouTube title and TikTok caption. Returns the post ID, profile, state, schedule, and variant count. The optional scheduled_at value only stores a desired time and never enqueues the post; call schedule_post after create_post to validate and enqueue, or publish_post_now to queue immediately.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id":    map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"content_profile": map[string]any{
					"type":        "string",
					"description": "OpenPost content profile: short_text, thread, link_share, image_post, carousel, story, short_video, or long_video.",
					"enum":        []string{"short_text", "thread", "link_share", "image_post", "carousel", "story", "short_video", "long_video"},
				},
				"title":       map[string]any{"type": "string", "description": "Internal post title."},
				"source_text": map[string]any{"type": "string", "description": "Canonical source text. Compute from description, caption, or title; do not expose this term to users."},
				"segments":    map[string]any{"type": "array", "items": mcpAuthoringSchema[PublicationSegmentInput](), "description": "Ordered authored thread segments, including settings.mentions with UTF-8 byte ranges."},
				"source_url":  map[string]any{"type": "string", "description": "Optional source URL for link shares."},
				"scheduled_at": map[string]any{
					"type":        "string",
					"format":      "date-time",
					"description": "Optional desired schedule time. Call schedule_post after create_post to validate and enqueue.",
				},
				"random_delay_minutes": map[string]any{
					"type": "integer", "minimum": 0, "maximum": 60,
					"description": "Optional random schedule delay in minutes (±N). Omit to inherit the Workspace setting when scheduled.",
				},
				"social_account_ids": map[string]any{
					"type":        "array",
					"description": "Destination account IDs returned by list_accounts. Used to create default variants when variants is omitted.",
					"items":       map[string]any{"type": "string"},
				},
				"media_ids": map[string]any{
					"type":        "array",
					"description": "Optional simple media attachment IDs. Prefer media when role, alt text, or thumbnail timestamp matters.",
					"items":       map[string]any{"type": "string"},
				},
				"media": map[string]any{
					"type":        "array",
					"description": "Default ordered media used by variants that do not provide their own media.",
					"items":       mediaSchema,
				},
				"variants": map[string]any{
					"type":        "array",
					"description": "Explicit account/provider outputs. Use fields by output role: body/caption as body, YouTube title as title, YouTube description as description, provider settings such as privacy.",
					"items":       mcpPublicationRenditionSchema(),
				},
			},
			"required":             []string{"workspace_id", "content_profile", "source_text"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, false)
}

func mcpListPublicationsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolListPubs,
		"title":       "List posts",
		"description": "Find format-first posts before reading, editing, validating, or scheduling one. Returns matching post summaries in newest-first order, up to limit items per response. Prefer narrow calendar windows and follow next_cursor with the cursor input while has_more is true instead of widening the window. Failed destinations are summarized per post as failed_variant_count with curated error fields; call get_post for full delivery detail and retry_failed_variants to retry safely retryable failures.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id":    map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"status":          map[string]any{"type": "string", "enum": []string{"draft", "ready", "scheduled", "publishing", "published", "failed"}, "description": "Optional post status filter."},
				"content_profile": map[string]any{"type": "string", "enum": []string{"short_text", "thread", "link_share", "image_post", "carousel", "story", "short_video", "long_video"}, "description": "Optional content profile filter."},
				"platform":        map[string]any{"type": "string", "description": "Optional destination platform filter, such as x, linkedin, or youtube."},
				"calendar_from":   map[string]any{"type": "string", "format": "date-time", "description": "Include calendar occurrences at or after this RFC3339 timestamp."},
				"calendar_before": map[string]any{"type": "string", "format": "date-time", "description": "Include calendar occurrences before this RFC3339 timestamp."},
				"activity_bucket": map[string]any{"type": "string", "enum": []string{"scheduled", "published", "failed", "draft"}, "description": "Optional calendar-compatible activity bucket."},
				"limit":           map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "description": "Maximum posts to return. Defaults to 20."},
				"cursor":          map[string]any{"type": "string", "description": "Opaque cursor from a previous response's next_cursor. Repeat all other filters unchanged while paging."},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpGetPublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolGetPub, "title": "Get post",
		"description": "Read one format-first post when its full source and destination state is needed. Returns the post, ordered media, variants, and delivery fields.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"detail":  mcpDetailSchema(),
			},
			"required": []string{"post_id"}, "additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpUpdatePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolUpdatePub, "title": "Update post",
		"description": "Edit a post's source fields or proposed schedule while preserving omitted values. Returns the updated post and does not enqueue it for publishing.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"segments":        map[string]any{"type": "array", "items": mcpAuthoringSchema[PublicationSegmentInput]()},
				"post_id":         map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post. Reload the post after a conflict before retrying.",
				},
				"title": map[string]any{"type": "string", "description": "Optional replacement internal title used to identify the post."},
				"content_profile": map[string]any{
					"type": "string", "description": "Optional replacement OpenPost content profile.",
					"enum": []string{"short_text", "thread", "link_share", "image_post", "carousel", "story", "short_video", "long_video"},
				},
				"source_text": map[string]any{"type": "string", "description": "Optional replacement canonical source copy used to derive destination outputs."},
				"source_url":  map[string]any{"type": "string", "format": "uri", "description": "Optional replacement absolute source URL, such as https://example.com/launch."},
				"goal":        map[string]any{"type": "string", "description": "Optional replacement publishing goal used as planning context."},
				"audience":    map[string]any{"type": "string", "description": "Optional replacement audience description used as planning context."},
				"scheduled_at": map[string]any{
					"type": "string", "format": "date-time", "description": "Optional replacement future schedule as an RFC3339 timestamp, such as 2026-08-01T09:30:00Z.",
				},
				"clear_schedule": map[string]any{
					"type":        "boolean",
					"description": "Clear the saved schedule and cancel its pending post job. Do not combine with scheduled_at.",
				},
				"random_delay_minutes": map[string]any{
					"type": "integer", "minimum": 0, "maximum": 60,
					"description": "Optional replacement random schedule delay in minutes (±N).",
				},
				"inherit_random_delay": map[string]any{
					"type": "boolean", "description": "Use the current Workspace random-delay setting when this Post is scheduled.",
				},
				"metadata": map[string]any{"type": "object", "description": "Optional replacement application metadata, e.g. {\"campaign\":\"spring-launch\"}.", "additionalProperties": true},
			},
			"required": []string{"post_id", "expected_revision"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, false)
}

func mcpSetPublicationRenditionsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolPubRenditions, "title": "Set post variants",
		"description": "Replace every destination output after post accounts, provider fields, media roles, or captions change. Returns the post with its complete replacement variant set.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":         map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post. Reload the post after a conflict before retrying.",
				},
				"variants": map[string]any{
					"type": "array", "minItems": 1,
					"description": "Complete replacement list of destination-specific post outputs.",
					"items":       mcpPublicationRenditionSchema(),
				},
			},
			"required": []string{"post_id", "expected_revision", "variants"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, false)
}

func mcpReplyToRenditionTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolReplyRendition, "title": "Reply to variant",
		"description": "Queue a reply to an already published provider variant, either now or at a future time. Returns the updated post status and durable reply job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"variant_id":      map[string]any{"type": "string", "description": "Published variant ID returned by get_post."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"body":            map[string]any{"type": "string", "description": "Reply text sent to the variant's provider thread."},
				"parent_id":       map[string]any{"type": "string", "description": "Optional provider-native parent reply ID when replying below a specific reply."},
				"run_at": map[string]any{
					"type": "string", "format": "date-time", "description": "Optional future RFC3339 execution time, such as 2026-08-01T09:30:00Z. Omit to queue immediately.",
				},
				"settings": map[string]any{"type": "object", "description": "Optional provider reply settings, e.g. {\"visibility\":\"public\"}.", "additionalProperties": true},
				"media": map[string]any{
					"type": "array", "description": "Optional ordered media attachments for the reply.", "items": mcpPublicationMediaSchema(),
				},
			},
			"required": []string{"variant_id", "body"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpPublicationMediaSchema() map[string]any {
	return map[string]any{
		"type": "object", "properties": map[string]any{
			"media_id": map[string]any{"type": "string", "description": "Media attachment ID returned by list_media, upload_media_from_url, or upload_media_base64."},
			"role": map[string]any{
				"type": "string", "enum": []string{"attachment", "cover", "thumbnail"},
				"description": "Media purpose within the provider output.",
			},
			"alt_text":               map[string]any{"type": "string", "description": "Optional accessible text override for this use of the media."},
			"thumbnail_timestamp_ms": map[string]any{"type": "integer", "minimum": 0, "description": "Optional video thumbnail position in milliseconds from the start."},
		}, "required": []string{"media_id"}, "additionalProperties": false,
	}
}

func mcpPublicationRenditionSchema() map[string]any { return mcpAuthoringSchema[RenditionInput]() }

func mcpValidatePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolValidatePub,
		"title":       "Validate post",
		"description": "Validate a post before scheduling or immediate publishing. Returns a valid flag plus actionable provider, media, account-scope, and processing issues. When valid is false, call get_post for the current delivery state; failed destinations retry through retry_failed_variants after the issues are fixed.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
			},
			"required":             []string{"post_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpSchedulePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolSchedulePub,
		"title":       "Schedule post",
		"description": "Validate and enqueue a post after its future scheduled_at value is set. Returns the scheduled post state and durable publishing job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":         map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"dry_run": map[string]any{
					"type":        "boolean",
					"description": "When true, validate the post and schedule readiness without enqueueing; returns the post state with an empty job ID.",
				},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post after the schedule time was saved.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this enqueue action. certification_test is restricted to an unscoped instance administrator.",
				},
			},
			"required":             []string{"post_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpCancelPublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolCancelPub,
		"title":       "Cancel post",
		"description": "Cancel a scheduled post and its pending durable delivery work.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":         map[string]any{"type": "string", "description": "Scheduled Post ID."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"expected_revision": map[string]any{
					"type": "integer", "minimum": 1,
					"description": "Revision returned by get_post immediately before cancellation.",
				},
			},
			"required": []string{"post_id", "expected_revision"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpPublishPublicationNowTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolPublishPubNow,
		"title":       "Publish post now",
		"description": "Validate and queue a post when it should publish as soon as a worker is available. Returns the queued post state and durable publishing job ID. This action is irreversible once a worker picks it up; repeat the call with confirm=true to proceed.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":         map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"dry_run": map[string]any{
					"type":        "boolean",
					"description": "When true, validate the post and publishing readiness without queueing; returns the post state with an empty job ID.",
				},
				"confirm": mcpConfirmSchema("Explicit confirmation that the post may publish immediately. Pass confirm=true on the second call."),
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post immediately before publishing.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this enqueue action. certification_test is restricted to an unscoped instance administrator.",
				},
			},
			"required":             []string{"post_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpDeletePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolDeletePub,
		"title":       "Delete post",
		"description": "Permanently delete an editable post, its destination variants, and any linked draft. This action is irreversible; repeat the call with confirm=true to proceed. Returns a confirmation message and the deleted post ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post immediately before deletion.",
				},
				"confirm":         mcpConfirmSchema("Explicit confirmation that the post may be permanently deleted. Pass confirm=true on the second call."),
				"idempotency_key": mcpIdempotencyKeySchema(),
			},
			"required":             []string{"post_id", "expected_revision", "confirm"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, false)
}

func mcpRetryFailedVariantsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolRetryFailed,
		"title":       "Retry failed variants",
		"description": "Queue one retry batch for the remaining safely retryable failed destination variants. Returns the post state and durable retry job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post immediately before retrying.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this retry action. certification_test is restricted to an unscoped instance administrator.",
				},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
			},
			"required":             []string{"post_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, true)
}

func mcpRetryVariantTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolRetryOne,
		"title":       "Retry variant",
		"description": "Queue a retry for one failed destination variant with a confirmed safe delivery outcome. Returns the post state and durable retry job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":    map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"variant_id": map[string]any{"type": "string", "description": "Failed variant ID returned by get_post."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post immediately before retrying.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this retry action. certification_test is restricted to an unscoped instance administrator.",
				},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
			},
			"required":             []string{"post_id", "variant_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, true)
}

func mcpListPublicationEventsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolPubEvents,
		"title":       "List post events",
		"description": "Inspect post history when diagnosing delivery, retry, or moderation state. Returns ordered lifecycle events with status, message, metadata, and timestamps, up to limit items per response. Follow next_cursor with the cursor input while has_more is true.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"limit":   map[string]any{"type": "integer", "minimum": 1, "maximum": 200, "description": "Maximum events to return. Defaults to 100."},
				"cursor":  map[string]any{"type": "string", "description": "Opaque cursor from a previous response's next_cursor. Repeat the post_id unchanged while paging."},
			},
			"required":             []string{"post_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpListRenditionCommentsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolComments,
		"title":       "List variant comments",
		"description": "Read live comments before replying to or moderating a published variant. Returns up to limit provider comments with opaque OpenPost comment IDs safe for follow-up actions. Results beyond limit are truncated in provider order; the response text notes when truncation occurred.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"variant_id": map[string]any{"type": "string", "description": "Variant ID from a post's destination-specific output."},
				"limit":      map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "description": "Maximum comments to return. Defaults to 50; extra provider results are truncated."},
			},
			"required":             []string{"variant_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, true)
}

func mcpReplyToCommentTool() mcpOperationDefinition {
	return mcpCommentActionTool(mcpToolReplyComment, "Reply to comment", "Queue a durable one-attempt provider reply after selecting an opaque ID from list_variant_comments. Returns a confirmation message and job ID.", true, false)
}

func mcpHideCommentTool() mcpOperationDefinition {
	return mcpCommentActionTool(mcpToolHideComment, "Hide comment", "Queue a durable one-attempt hide action when moderation is supported and removal is not required. Returns a confirmation message and job ID.", false, true)
}

func mcpDeleteCommentTool() mcpOperationDefinition {
	return mcpCommentActionTool(mcpToolDeleteComment, "Delete comment", "Queue a durable one-attempt deletion of a provider comment only when irreversible moderation is intended. Returns a confirmation message and job ID.", false, true)
}

func mcpCommentActionTool(name, title, description string, requiresBody, destructive bool) mcpOperationDefinition {
	properties := map[string]any{
		"comment_id":      map[string]any{"type": "string", "description": "Opaque comment ID returned by list_variant_comments."},
		"idempotency_key": mcpIdempotencyKeySchema(),
	}
	required := []string{"comment_id"}
	if requiresBody {
		properties["body"] = map[string]any{"type": "string", "description": "Reply text to send to the provider comment."}
		required = append(required, "body")
	}
	if name == mcpToolDeleteComment {
		properties["confirm"] = mcpConfirmSchema("Explicit confirmation that the provider comment may be permanently deleted. Pass confirm=true on the second call.")
		required = append(required, "confirm")
	}
	return mcpOperationDescriptor(map[string]any{
		"name": name, "title": title, "description": description,
		"inputSchema": map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false},
	}, mcpOperationExecute, destructive, true)
}

func mcpSuggestNextSlotTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolSuggestSlot,
		"title":       "Suggest next slot",
		"description": "Find a free configured time before scheduling when the user has not chosen an exact timestamp. Returns the proposed slot, timezone, and matched schedule rule.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"after": map[string]any{
					"type":        "string",
					"format":      "date-time",
					"description": "Optional RFC3339 lower bound. Defaults to the current time.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpUploadMediaFromURLTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolUploadURL,
		"title":       "Upload media from URL",
		"description": "Import an externally hosted asset when it is not already in the workspace media library. Returns the stored media ID, file metadata, processing state, and URLs.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"url": map[string]any{
					"type":        "string",
					"format":      "uri",
					"description": "Public http(s) URL to fetch.",
				},
				"filename": map[string]any{
					"type":        "string",
					"description": "Optional filename to store for display and extension detection.",
				},
				"alt_text": map[string]any{
					"type":        "string",
					"description": "Optional accessible alt text for the media.",
				},
			},
			"required":             []string{"workspace_id", "url"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpPostMetricsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolPostMetrics,
		"title":       "Get post metrics",
		"description": "Read stored analytics for a post when performance per destination is needed. Returns normalized views, reactions, engagements, impressions, and reach per variant plus post totals, from the stored analytics snapshots. Read-only; triggers no provider calls.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
			},
			"required":             []string{"post_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpDashboardLinkTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolDashboardLink,
		"title":       "Get dashboard link",
		"description": "Build a dashboard URL to hand to the user when they should see a visualization themselves. Pure URL builder from the configured app origin; reads no state beyond the workspace access check. Post links need an id; media, account, and calendar link to their views.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"kind": map[string]any{
					"type":        "string",
					"enum":        []string{"post", "media", "account", "calendar"},
					"description": "Dashboard view to link: a single post, the media library, connected accounts, or the calendar.",
				},
				"id": map[string]any{"type": "string", "description": "Post ID for kind post. Ignored for other kinds."},
			},
			"required":             []string{"workspace_id", "kind"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpSearchDocsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolSearchDocs,
		"title":       "Search docs",
		"description": "Search OpenPost documentation and assistant skills when setup, concept, or how-to guidance is needed. Returns matching guide titles, /docs paths, and snippets; resolve paths against the app origin. Backed by a curated offline registry, so it never calls external services.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string", "description": "Plain-language topic to find, such as 'connect TikTok' or 'schedule a post'."},
				"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 10, "description": "Maximum matching entries to return. Defaults to 5."},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpGetMediaTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolGetMedia,
		"title":       "Get media",
		"description": "Read one workspace media asset when its file details, processing state, usage, or deletion eligibility is needed. Returns the media item.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"media_id": map[string]any{"type": "string", "description": "Media ID returned by list_media or upload_media_from_url."},
			},
			"required":             []string{"media_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpUpdateMediaTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolUpdateMedia,
		"title":       "Update media",
		"description": "Update a workspace media asset's favorite flag or alt text. Returns the updated media item with its usage and deletion eligibility.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"media_id":        map[string]any{"type": "string", "description": "Media ID returned by list_media or upload_media_from_url."},
				"favorite":        map[string]any{"type": "boolean", "description": "Optional replacement favorite flag."},
				"alt_text":        map[string]any{"type": "string", "description": "Optional replacement accessible alt text."},
				"idempotency_key": mcpIdempotencyKeySchema(),
			},
			"required":             []string{"media_id"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, false)
}

func mcpDeleteMediaTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolDeleteMedia,
		"title":       "Delete media",
		"description": "Move a workspace media asset to Trash when list_media reports can_delete. This action is irreversible without a restore; repeat the call with confirm=true to proceed. Returns a confirmation message and the deleted media ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"media_id":        map[string]any{"type": "string", "description": "Media ID returned by list_media."},
				"confirm":         mcpConfirmSchema("Explicit confirmation that the media may be moved to Trash. Pass confirm=true on the second call."),
				"idempotency_key": mcpIdempotencyKeySchema(),
			},
			"required":             []string{"media_id", "confirm"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, false)
}

func mcpRenderSchedulerWidgetTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolRenderWidget,
		"title":       "Render scheduler widget",
		"description": "Render structured results as an interactive scheduler view when a visual summary helps. Returns the chosen view, title, workspace ID, and unchanged data for the Apps widget.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"view": map[string]any{
					"type":        "string",
					"description": "Widget view to render. Defaults to a view inferred from the data keys.",
					"enum":        mcpSchedulerWidgetViews(),
				},
				"title": map[string]any{
					"type":        "string",
					"description": "Optional title shown at the top of the widget.",
				},
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Optional workspace ID for the rendered data.",
				},
				"data": map[string]any{
					"type":                 "object",
					"description":          "Structured data returned by another OpenPost MCP tool.",
					"additionalProperties": true,
				},
			},
			"required":             []string{"data"},
			"additionalProperties": false,
		},
	}, mcpToolSafety{ReadOnly: true, Idempotent: true})
}

func mcpRenderLocalUploadTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolRenderUpload,
		"title":       "Upload local media",
		"description": "Open a secure file picker so the user can add an image or video from their device to an OpenPost workspace. Returns the selected workspace for the upload widget.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
			},
			"required": []string{"workspace_id"}, "additionalProperties": false,
		},
	}, mcpToolSafety{ReadOnly: true, Idempotent: true})
}

func mcpCreateLocalUploadTicketTool() map[string]any {
	tool := mcpToolDescriptor(map[string]any{
		"name":        mcpToolCreateTicket,
		"title":       "Prepare local media upload",
		"description": "Create a one-use upload ticket for the local-media widget. Returns only non-secret readiness data to model context.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id":    map[string]any{"type": "string"},
				"filename":        map[string]any{"type": "string", "minLength": 1, "maxLength": 1024},
				"mime_type":       map[string]any{"type": "string", "maxLength": 255},
				"size":            map[string]any{"type": "integer", "minimum": 1, "maximum": MaxMediaUploadBytes},
				"alt_text":        map[string]any{"type": "string", "maxLength": 2000},
				"idempotency_key": mcpIdempotencyKeySchema(),
			},
			"required": []string{"workspace_id", "filename", "size"}, "additionalProperties": false,
		},
	}, mcpToolSafety{Destructive: true})
	meta := tool["_meta"].(map[string]any)
	meta["ui"] = map[string]any{"visibility": []string{"app"}}
	meta["openai/widgetAccessible"] = true
	return tool
}

type mcpToolSafety struct {
	ReadOnly    bool
	Destructive bool
	OpenWorld   bool
	Idempotent  bool
}

func mcpOperationDescriptor(tool map[string]any, mode mcpOperationMode, destructive, openWorld bool) mcpOperationDefinition {
	switch mode {
	case mcpOperationQuery:
		if destructive {
			panic("read-only MCP operations cannot be destructive")
		}
	case mcpOperationExecute:
		// Every state-changing operation advertises destructiveHint=true so
		// clients gate mutations as a whole. openWorldHint stays split:
		// true only for operations that reach external provider systems.
		destructive = true
	default:
		panic("invalid MCP operation mode: " + mode)
	}
	return mcpOperationDefinition{
		Descriptor: mcpToolDescriptor(tool, mcpToolSafety{
			ReadOnly:    mode == mcpOperationQuery,
			Destructive: destructive,
			OpenWorld:   openWorld,
			Idempotent:  mode == mcpOperationQuery,
		}),
		Mode: mode,
	}
}

func mcpToolDescriptor(tool map[string]any, safety mcpToolSafety) map[string]any {
	securitySchemes := []map[string]any{mcpOAuthSecurityScheme(safety.ReadOnly)}
	toolName, _ := tool["name"].(string)
	if inputSchema, ok := tool["inputSchema"].(map[string]any); ok {
		mcpPrepareInputSchema(inputSchema)
	}
	tool["securitySchemes"] = securitySchemes
	outputSchema := mcpToolOutputSchema(toolName)
	tool["outputSchema"] = outputSchema
	ensureMCPDescriptionStatesOutput(tool, outputSchema)
	tool["annotations"] = map[string]any{
		"readOnlyHint":    safety.ReadOnly,
		"destructiveHint": safety.Destructive,
		"openWorldHint":   safety.OpenWorld,
		"idempotentHint":  safety.Idempotent,
	}
	status := mcpToolInvocationStatus(toolName)
	meta := map[string]any{
		"securitySchemes":                securitySchemes,
		"openai/toolInvocation/invoking": status.Invoking,
		"openai/toolInvocation/invoked":  status.Invoked,
	}
	if mcpToolUsesAppWidget(toolName) {
		resourceURI := mcpAppWidgetURI
		if toolName == mcpToolRenderUpload {
			resourceURI = mcpUploadWidgetURI
		}
		meta["ui"] = map[string]any{
			"resourceUri": resourceURI,
			"visibility":  []string{"model"},
		}
		meta["openai/outputTemplate"] = resourceURI
		meta["openai/widgetAccessible"] = toolName == mcpToolRenderUpload
	}
	tool["_meta"] = meta
	return tool
}

func ensureMCPDescriptionStatesOutput(tool, outputSchema map[string]any) {
	description, _ := tool["description"].(string)
	if strings.Contains(strings.ToLower(description), "return") {
		return
	}
	required, _ := outputSchema["required"].([]string)
	output := "structured operation data"
	if len(required) > 0 {
		output = strings.Join(required, ", ")
	}
	tool["description"] = strings.TrimSpace(description) + " Returns " + output + " in the structured result."
}

func mcpToolUsesAppWidget(toolName string) bool {
	return toolName == mcpToolRenderWidget || toolName == mcpToolRenderUpload
}

type mcpToolStatus struct {
	Invoking string
	Invoked  string
}

var mcpToolStatuses = map[string]mcpToolStatus{
	mcpToolSearch:         {Invoking: "Searching operations", Invoked: "Operations found"},
	mcpToolQuery:          {Invoking: "Querying OpenPost", Invoked: "OpenPost query complete"},
	mcpToolExecute:        {Invoking: "Running OpenPost mutation", Invoked: "OpenPost mutation complete"},
	mcpToolWorkspaces:     {Invoking: "Loading workspaces", Invoked: "Workspaces loaded"},
	mcpToolProviders:      {Invoking: "Loading providers", Invoked: "Providers loaded"},
	mcpToolAccounts:       {Invoking: "Loading accounts", Invoked: "Accounts loaded"},
	mcpToolListMedia:      {Invoking: "Loading media", Invoked: "Media loaded"},
	mcpToolReadiness:      {Invoking: "Checking provider readiness", Invoked: "Provider readiness loaded"},
	mcpToolCreatePub:      {Invoking: "Creating post", Invoked: "Post created"},
	mcpToolListPubs:       {Invoking: "Loading posts", Invoked: "Posts loaded"},
	mcpToolGetPub:         {Invoking: "Loading post", Invoked: "Post loaded"},
	mcpToolUpdatePub:      {Invoking: "Updating post", Invoked: "Post updated"},
	mcpToolPubRenditions:  {Invoking: "Updating post variants", Invoked: "Post variants updated"},
	mcpToolReplyRendition: {Invoking: "Queueing reply", Invoked: "Reply queued"},
	mcpToolValidatePub:    {Invoking: "Validating post", Invoked: "Post validated"},
	mcpToolSchedulePub:    {Invoking: "Scheduling post", Invoked: "Post scheduled"},
	mcpToolCancelPub:      {Invoking: "Cancelling post", Invoked: "Post cancelled"},
	mcpToolPublishPubNow:  {Invoking: "Queueing post", Invoked: "Post queued"},
	mcpToolDeletePub:      {Invoking: "Deleting post", Invoked: "Post deleted"},
	mcpToolRetryFailed:    {Invoking: "Retrying failed variants", Invoked: "Variant retry queued"},
	mcpToolRetryOne:       {Invoking: "Retrying variant", Invoked: "Variant retry queued"},
	mcpToolDeleteMedia:    {Invoking: "Deleting media", Invoked: "Media deleted"},
	mcpToolUpdateMedia:    {Invoking: "Updating media", Invoked: "Media updated"},
	mcpToolGetMedia:       {Invoking: "Loading media", Invoked: "Media loaded"},
	mcpToolPubEvents:      {Invoking: "Loading post events", Invoked: "Post events loaded"},
	mcpToolComments:       {Invoking: "Loading comments", Invoked: "Comments loaded"},
	mcpToolReplyComment:   {Invoking: "Queueing comment reply", Invoked: "Comment reply queued"},
	mcpToolHideComment:    {Invoking: "Queueing comment hide", Invoked: "Comment hide queued"},
	mcpToolDeleteComment:  {Invoking: "Queueing comment deletion", Invoked: "Comment deletion queued"},
	mcpToolSuggestSlot:    {Invoking: "Finding next slot", Invoked: "Next slot found"},
	mcpToolUploadURL:      {Invoking: "Uploading media", Invoked: "Media uploaded"},
	mcpToolUploadBase64:   {Invoking: "Uploading media", Invoked: "Media uploaded"},
	mcpToolPostMetrics:    {Invoking: "Loading post metrics", Invoked: "Post metrics loaded"},
	mcpToolDashboardLink:  {Invoking: "Building dashboard link", Invoked: "Dashboard link ready"},
	mcpToolSearchDocs:     {Invoking: "Searching docs", Invoked: "Docs found"},
	mcpToolRenderWidget:   {Invoking: "Rendering view", Invoked: "View rendered"},
	mcpToolRenderUpload:   {Invoking: "Opening local upload", Invoked: "Local upload ready"},
	mcpToolCreateTicket:   {Invoking: "Preparing upload", Invoked: "Upload ready"},
}

func mcpToolInvocationStatus(toolName string) mcpToolStatus {
	if status, ok := mcpToolStatuses[toolName]; ok {
		return status
	}
	return mcpToolStatus{Invoking: "Running tool", Invoked: "Tool complete"}
}

//nolint:gocyclo // Tool cases are a flat schema catalog, not nested control flow.
func mcpToolOutputSchema(toolName string) map[string]any {
	if strings.HasPrefix(toolName, "editor_") || strings.HasPrefix(toolName, "library_") || strings.HasPrefix(toolName, "style_") || strings.HasPrefix(toolName, "preferences_") || toolName == "timeline_inspect" || toolName == "image_inspect" || toolName == "media_library" || toolName == "media_analyze" || toolName == "media_analysis_status" || toolName == "media_analysis_cancel" || toolName == "media_search" || toolName == "media_inspect" || toolName == "media_frame" || toolName == "media_storyboard" || strings.HasPrefix(toolName, "scene_") || toolName == "preview_render" || toolName == "preview_audio" || toolName == "video_edit" || toolName == "image_edit" || toolName == "export_start" || toolName == "export_status" || toolName == "export_cancel" {
		return mcpOpenObjectSchema()
	}
	if toolName == mcpToolListPubs {
		return mcpStructuredOutputSchema(map[string]any{
			"publications": mcpArraySchema(mcpOpenObjectSchema()),
			"has_more":     map[string]any{"type": "boolean"},
			"next_cursor":  map[string]any{"type": "string"},
			"total_count":  map[string]any{"type": "integer"},
		}, "publications")
	}
	if toolName == mcpToolListMedia {
		return mcpStructuredOutputSchema(map[string]any{
			"media":       mcpArraySchema(mcpOpenObjectSchema()),
			"has_more":    map[string]any{"type": "boolean"},
			"next_cursor": map[string]any{"type": "string"},
			"total_count": map[string]any{"type": "integer"},
		}, "media")
	}
	if toolName == mcpToolPubEvents {
		return mcpStructuredOutputSchema(map[string]any{
			"events":      mcpArraySchema(mcpOpenObjectSchema()),
			"has_more":    map[string]any{"type": "boolean"},
			"next_cursor": map[string]any{"type": "string"},
			"total_count": map[string]any{"type": "integer"},
		}, "events")
	}
	if key, ok := mcpArrayOutputKey(toolName); ok {
		return mcpStructuredOutputSchema(map[string]any{
			key: mcpArraySchema(mcpOpenObjectSchema()),
		}, key)
	}
	switch toolName {
	case mcpToolCreatePub, mcpToolGetPub, mcpToolUpdatePub, mcpToolPubRenditions, mcpToolCancelPub,
		mcpToolSchedulePub, mcpToolPublishPubNow, mcpToolReplyRendition, mcpToolRetryFailed, mcpToolRetryOne:
		return mcpStructuredOutputSchema(map[string]any{
			"publication": mcpOpenObjectSchema(),
			"job_id":      map[string]any{"type": "string"},
		}, "publication", "job_id")
	case mcpToolDeletePub:
		return mcpStructuredOutputSchema(map[string]any{
			"message": map[string]any{"type": "string"},
			"post_id": map[string]any{"type": "string"},
			"job_id":  map[string]any{"type": "string"},
		}, "message", "post_id")
	case mcpToolGetMedia, mcpToolUpdateMedia:
		return mcpStructuredOutputSchema(map[string]any{
			"media": mcpOpenObjectSchema(),
		}, "media")
	case mcpToolInboxList:
		return mcpAuthoringSchema[EngagementPage]()
	case mcpToolInboxGet:
		return mcpAuthoringSchema[engagementservice.EngagementDetail]()
	case mcpToolInboxRefresh:
		return mcpAuthoringSchema[RefreshCapabilityOutcome]()
	case mcpToolInboxState:
		return mcpStructuredOutputSchema(map[string]any{"updated": map[string]any{"type": "boolean"}}, "updated")
	case mcpToolInboxRead:
		return mcpStructuredOutputSchema(map[string]any{"updated_count": map[string]any{"type": "integer"}}, "updated_count")
	case mcpToolInboxAction:
		return mcpStructuredOutputSchema(map[string]any{"job_id": map[string]any{"type": "string"}}, "job_id")
	case mcpToolLookupMentions:
		return mcpStructuredOutputSchema(map[string]any{"candidates": mcpArraySchema(mcpAuthoringSchema[platform.MentionCandidate]()), "mode": map[string]any{"type": "string", "enum": []string{"accounts", "exact_company"}}}, "candidates", "mode")
	case mcpToolPrepareImage:
		return mcpStructuredOutputSchema(map[string]any{"media": mcpOpenObjectSchema(), "status": map[string]any{"type": "string", "enum": []string{"ready"}}}, "media", "status")
	case mcpToolDeleteMedia:
		return mcpStructuredOutputSchema(map[string]any{
			"message":  map[string]any{"type": "string"},
			"media_id": map[string]any{"type": "string"},
		}, "message", "media_id")
	case mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment:
		return mcpStructuredOutputSchema(map[string]any{
			"message": map[string]any{"type": "string"}, "job_id": map[string]any{"type": "string"},
		}, "message", "job_id")
	case mcpToolValidatePub:
		return mcpStructuredOutputSchema(map[string]any{
			"valid":  map[string]any{"type": "boolean"},
			"issues": mcpArraySchema(mcpOpenObjectSchema()),
		}, "valid", "issues")
	case mcpToolPreviewTextCard:
		return mcpStructuredOutputSchema(map[string]any{"image_count": map[string]any{"type": "integer"}}, "image_count")
	case mcpToolSuggestSlot:
		return mcpStructuredOutputSchema(map[string]any{
			"suggestion": mcpOpenObjectSchema(),
		}, "suggestion")
	case mcpToolUploadURL, mcpToolUploadBase64:
		return mcpStructuredOutputSchema(map[string]any{
			"media": mcpOpenObjectSchema(),
		}, "media")
	case mcpToolPostMetrics:
		return mcpStructuredOutputSchema(map[string]any{
			"post_id":  map[string]any{"type": "string"},
			"variants": mcpArraySchema(mcpOpenObjectSchema()),
			"totals":   mcpOpenObjectSchema(),
		}, "post_id", "variants", "totals")
	case mcpToolDashboardLink:
		return mcpStructuredOutputSchema(map[string]any{
			"url":          map[string]any{"type": "string"},
			"kind":         map[string]any{"type": "string"},
			"workspace_id": map[string]any{"type": "string"},
		}, "url", "kind", "workspace_id")
	case mcpToolSearchDocs:
		return mcpStructuredOutputSchema(map[string]any{
			"results": mcpArraySchema(mcpOpenObjectSchema()),
		}, "results")
	case mcpToolRenderWidget:
		return mcpStructuredOutputSchema(map[string]any{
			"view":         map[string]any{"type": "string", "enum": mcpSchedulerWidgetViews()},
			"title":        map[string]any{"type": "string"},
			"workspace_id": map[string]any{"type": "string"},
			"data":         mcpOpenObjectSchema(),
		}, "view", "data")
	case mcpToolRenderUpload:
		return mcpStructuredOutputSchema(map[string]any{
			"workspace_id": map[string]any{"type": "string"},
		}, "workspace_id")
	case mcpToolCreateTicket:
		return mcpStructuredOutputSchema(map[string]any{
			"ready":      map[string]any{"type": "boolean"},
			"expires_at": map[string]any{"type": "string"},
		}, "ready", "expires_at")
	case mcpToolQuery, mcpToolExecute:
		return mcpOpenObjectSchema()
	default:
		return mcpStructuredOutputSchema(map[string]any{})
	}
}

func mcpArrayOutputKey(toolName string) (string, bool) {
	switch toolName {
	case mcpToolSearch:
		return "operations", true
	case mcpToolWorkspaces:
		return "workspaces", true
	case mcpToolProviders, mcpToolReadiness:
		return "providers", true
	case mcpToolAccounts:
		return "accounts", true
	case mcpToolComments:
		return "comments", true
	default:
		return "", false
	}
}

func mcpStructuredOutputSchema(properties map[string]any, required ...string) map[string]any {
	return map[string]any{
		"type":                 "object",
		"properties":           properties,
		"required":             required,
		"additionalProperties": false,
	}
}

func mcpArraySchema(items map[string]any) map[string]any {
	return map[string]any{
		"type":  "array",
		"items": items,
	}
}

func mcpOpenObjectSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"properties":           map[string]any{},
		"required":             []string{},
		"additionalProperties": true,
	}
}

func mcpOAuthSecurityScheme(readOnly bool) map[string]any {
	scopes := []string{mcpScopeFull}
	if readOnly {
		scopes = []string{mcpScopeRead, mcpScopeFull}
	}
	return map[string]any{
		"type":   "oauth2",
		"scopes": scopes,
	}
}
