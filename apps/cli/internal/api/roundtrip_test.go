package api

// Regression test for getopenpost/openpost#386.
//
// `openpost <command> --json` re-encodes the CLI's own decoded structs, so
// any API field the hand-written Go structs do not declare silently
// disappears from machine-readable output. This test decodes a full
// response-shaped payload into each CLI wire struct, re-marshals it (the
// same decode-then-encode path the --json printers use), and asserts that
// every property the OpenAPI schema declares survives the round trip.
//
// The expected key sets are read from apps/web/openapi.json at test time,
// so adding a field to the served schema without widening the CLI struct
// fails this test. Intentional omissions are allowlisted per schema with
// the reason recorded next to them.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// intentionallyOmittedSchemaKeys lists OpenAPI properties the CLI
// deliberately does not project, with the reason for each omission.
// Everything else declared by the schema must survive the round trip.
var intentionallyOmittedSchemaKeys = map[string]map[string]string{
	// $schema is JSON-Schema metadata (a URL to the schema document
	// itself), not resource data. No --json consumer needs it.
	"PublicationResponse": {"$schema": "JSON-Schema document URL, not resource data"},
	"AccountResponse":     {"$schema": "JSON-Schema document URL, not resource data"},
	"JobResponse":         {"$schema": "JSON-Schema document URL, not resource data"},
}

func openAPIProperties(t *testing.T, schemaName string) map[string]bool {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// This file lives in apps/cli/internal/api; the spec lives in
	// apps/web/openapi.json.
	specPath := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..", "apps", "web", "openapi.json")
	specPath, err := filepath.Abs(specPath)
	if err != nil {
		t.Fatalf("resolve openapi.json path: %v", err)
	}
	raw, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatalf("read OpenAPI spec at %s: %v (the CLI structs must stay a superset of the served schema)", specPath, err)
	}
	var spec struct {
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse OpenAPI spec: %v", err)
	}
	schema, ok := spec.Components.Schemas[schemaName]
	if !ok {
		t.Fatalf("OpenAPI schema %q not found", schemaName)
	}
	props := make(map[string]bool, len(schema.Properties))
	for name := range schema.Properties {
		props[name] = true
	}
	return props
}

// roundTrip decodes payload into v (the CLI wire struct) and re-marshals
// it, returning the re-emitted top-level key set. This mirrors what the
// --json printers do: client decode followed by output.PrintJSON.
func roundTrip(t *testing.T, payload string, v any) map[string]any {
	t.Helper()
	var fixture map[string]any
	if err := json.Unmarshal([]byte(payload), &fixture); err != nil {
		t.Fatalf("fixture is not valid JSON: %v", err)
	}
	if err := json.Unmarshal([]byte(payload), v); err != nil {
		t.Fatalf("decode into %T: %v", v, err)
	}
	remarshalled, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("re-marshal %T: %v", v, err)
	}
	var out map[string]any
	if err := json.Unmarshal(remarshalled, &out); err != nil {
		t.Fatalf("re-emitted %T is not a JSON object: %v", v, err)
	}
	return out
}

// assertFaithfulProjection fails listing every schema-declared key that
// the round trip dropped (fixture gaps are reported separately so a bad
// fixture cannot be mistaken for a struct gap).
func assertFaithfulProjection(t *testing.T, schemaName, payload string, v any) map[string]any {
	t.Helper()
	var fixture map[string]any
	if err := json.Unmarshal([]byte(payload), &fixture); err != nil {
		t.Fatalf("fixture is not valid JSON: %v", err)
	}
	want := openAPIProperties(t, schemaName)
	omitted := intentionallyOmittedSchemaKeys[schemaName]
	for key := range want {
		if omitted[key] != "" {
			continue
		}
		if _, ok := fixture[key]; !ok {
			t.Fatalf("fixture for %s does not cover schema property %q: extend the fixture before trusting this test", schemaName, key)
		}
	}
	out := roundTrip(t, payload, v)
	var dropped []string
	for key := range want {
		if omitted[key] != "" {
			continue
		}
		if _, ok := out[key]; !ok {
			dropped = append(dropped, key)
		}
	}
	if len(dropped) > 0 {
		t.Fatalf("%T drops %s %v: widen the struct so --json is a faithful projection", v, schemaName, dropped)
	}
	return out
}

func nestedObject(t *testing.T, parent map[string]any, key string) map[string]any {
	t.Helper()
	raw, ok := parent[key]
	if !ok {
		t.Fatalf("re-emitted payload has no %q to descend into", key)
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("re-emitted %q is %T, want object", key, raw)
	}
	return obj
}

func nestedArrayItem(t *testing.T, parent map[string]any, key string) map[string]any {
	t.Helper()
	raw, ok := parent[key]
	if !ok {
		t.Fatalf("re-emitted payload has no %q to descend into", key)
	}
	arr, ok := raw.([]any)
	if !ok {
		t.Fatalf("re-emitted %q is %T, want array", key, raw)
	}
	if len(arr) == 0 {
		t.Fatalf("re-emitted %q is empty, want at least 1 item", key)
	}
	obj, ok := arr[0].(map[string]any)
	if !ok {
		t.Fatalf("re-emitted %q[0] is %T, want object", key, arr[0])
	}
	return obj
}

func assertKeysPresent(t *testing.T, schemaName string, obj map[string]any, context string) {
	t.Helper()
	want := openAPIProperties(t, schemaName)
	omitted := intentionallyOmittedSchemaKeys[schemaName]
	var dropped []string
	for key := range want {
		if omitted[key] != "" {
			continue
		}
		if _, ok := obj[key]; !ok {
			dropped = append(dropped, key)
		}
	}
	if len(dropped) > 0 {
		t.Fatalf("%s drops %s %v", context, schemaName, dropped)
	}
}

const fullPublicationFixture = `{
	"id": "pub_1",
	"workspace_id": "ws_1",
	"created_by": "user_1",
	"creation_source": "web",
	"creation_preset": "announcement",
	"title": "Launch day",
	"intent": "announce",
	"content_profile": "post",
	"source_text": "We launched.",
	"source_url": "https://example.com/launch",
	"goal": "awareness",
	"audience": "founders",
	"metadata": {"campaign": "launch"},
	"status": "draft",
	"revision": 3,
	"random_delay_minutes": 15,
	"random_delay_inherited": true,
	"social_set_id": "set_1",
	"review_state": "pending",
	"review_id": "rev_1",
	"review_epoch": 2,
	"repost_override": {"mode": "custom", "rule": {"cadence": "weekly"}, "target_account_ids": ["acc_1"]},
	"failure_dismissed_at": "2026-07-05T10:00:00Z",
	"scheduled_at": "2026-07-06T10:00:00Z",
	"actual_run_at": "2026-07-06T10:01:00Z",
	"created_at": "2026-07-04T21:00:00Z",
	"updated_at": "2026-07-04T22:00:00Z",
	"segments": [
		{
			"id": "seg_1",
			"position": 0,
			"body": "We launched.",
			"title": "Launch",
			"description": "Launch post",
			"settings": {"link": "https://example.com"},
			"url": "https://example.com/launch",
			"media": [
				{
					"id": "med_1",
					"mime_type": "image/png",
					"size": 42,
					"original_filename": "launch.png",
					"width": 32,
					"height": 18,
					"duration_ms": 0,
					"frame_rate": 0,
					"aspect_ratio": "16:9",
					"dominant_type": "image",
					"analysis_status": "done",
					"public_url_ready": true,
					"public_url_status": 200,
					"url": "/media/med_1",
					"alt_text": "launch art",
					"role": "inline",
					"settings": {"crop": "fill"},
					"display_order": 1,
					"thumbnail_timestamp_ms": 1500,
					"poster_thumbnail_url": "/media/med_1/poster",
					"analysis_error": "none",
					"public_url_checked_at": "2026-07-04T21:30:00Z",
					"public_url_error": "none"
				}
			]
		}
	],
	"renditions": [
		{
			"id": "rend_1",
			"publication_id": "pub_1",
			"social_account_id": "acc_1",
 "account": {"platform": "x", "display_name": "@founder", "avatar_url": "https://cdn.example/founder.jpg"},
			"target_key": "x:handle",
			"platform": "x",
			"profile": "post",
			"output_profile": "x-post",
			"format_locked": true,
			"body": "We launched.",
			"title": "Launch",
			"description": "Launch post",
			"settings": {"thread": false},
			"status": "draft",
			"schedule_override": "2026-07-06T11:00:00Z",
			"delivery": {
				"target_key": "x:handle",
				"state": "pending",
				"current_attempt_id": "att_1",
				"current_attempt_number": 1,
				"current_attempt_created_at": "2026-07-04T21:00:00Z",
				"recovery_action": "none",
				"error_kind": "provider",
				"error_code": "E_TIMEOUT",
				"error_http_status": 502,
				"external_id": "ext_1",
				"external_url": "https://x.com/i/1",
				"last_reconciled_at": "2026-07-04T21:05:00Z",
				"next_reconciliation_at": "2026-07-04T22:05:00Z",
				"terminal_reason": "none"
			},
			"segments": [
				{
					"id": "rseg_1",
					"publication_segment_id": "seg_1",
					"position": 0,
					"body": "We launched.",
					"body_override": "We launched!",
					"title": "Launch",
					"title_override": "Launch!",
					"description": "Launch post",
					"description_override": "Launch post!",
					"url": "https://example.com/launch",
					"url_override": "https://example.com/launch2",
					"media_inherited": true,
					"settings": {"thread": false},
					"status": "draft",
					"error_retryable": true,
					"error_message": "timeout",
					"error_kind": "provider",
					"error_code": "E_TIMEOUT",
					"error_http_status": 502,
					"error_retry_at": "2026-07-04T21:10:00Z",
					"error_action": "retry",
					"external_id": "ext_1",
					"external_url": "https://x.com/i/1",
					"media": [],
					"output_media": [
						{
							"id": "med_1",
							"mime_type": "image/png",
							"size": 42,
							"original_filename": "launch.png",
							"width": 32,
							"height": 18,
							"duration_ms": 0,
							"frame_rate": 0,
							"aspect_ratio": "16:9",
							"dominant_type": "image",
							"analysis_status": "done",
							"public_url_ready": true,
							"public_url_status": 200,
							"url": "/media/med_1",
							"alt_text": "launch art",
							"role": "generated",
							"settings": {},
							"display_order": 0,
							"thumbnail_timestamp_ms": 0,
							"poster_thumbnail_url": "",
							"analysis_error": "none",
							"public_url_checked_at": "",
							"public_url_error": "none"
						}
					],
					"source_overrides": [
						{
							"publication_segment_id": "seg_1",
							"body_override": "@alice",
 "mentions": {"version":1,"spans":[{"start":0,"end":6,"text":"@alice","target":{"provider":"bluesky","kind":"person","id":"did:plc:ewvi7nxzyoun6zhxrhs64oiz"}}]},
							"media_inherited": true,
							"media": [{"media_id": "med_1", "role": "inline", "alt_text": "launch art"}]
						}
					]
				}
			],
			"media": [],
			"external_id": "ext_1",
			"external_url": "https://x.com/i/1",
			"error_message": "timeout",
			"error_kind": "provider",
			"error_code": "E_TIMEOUT",
			"error_http_status": 502,
			"error_retryable": true,
			"error_retry_at": "2026-07-04T21:10:00Z",
			"error_action": "retry"
		}
	],
	"media": []
}`

func TestPublicationJSONProjectionMatchesOpenAPI(t *testing.T) {
	t.Parallel()
	var pub Publication
	out := assertFaithfulProjection(t, "PublicationResponse", fullPublicationFixture, &pub)

	// Nested projections must be faithful too: publication segments and
	// their media, the repost override, and every rendition subtree.
	assertKeysPresent(t, "PublicationSegmentResponse",
		nestedArrayItem(t, out, "segments"), "publication.segments[0]")
	assertKeysPresent(t, "MediaSummary",
		nestedArrayItem(t, nestedArrayItem(t, out, "segments"), "media"),
		"publication.segments[0].media[0]")
	assertKeysPresent(t, "Override",
		nestedObject(t, out, "repost_override"), "publication.repost_override")

	rendition := nestedArrayItem(t, out, "renditions")
	assertKeysPresent(t, "RenditionResponse", rendition, "publication.renditions[0]")
	assertKeysPresent(t, "RenditionAccountIdentity", nestedObject(t, rendition, "account"), "publication.renditions[0].account")
	assertKeysPresent(t, "ProviderDeliveryResponse",
		nestedObject(t, rendition, "delivery"), "publication.renditions[0].delivery")

	segment := nestedArrayItem(t, rendition, "segments")
	assertKeysPresent(t, "RenditionSegmentResponse", segment,
		"publication.renditions[0].segments[0]")
	assertKeysPresent(t, "RenditionSourceOverride",
		nestedArrayItem(t, segment, "source_overrides"),
		"publication.renditions[0].segments[0].source_overrides[0]")
}

func TestWorkspaceJSONProjectionMatchesOpenAPI(t *testing.T) {
	t.Parallel()
	const fixture = `{
		"id": "ws_1",
		"organization_id": "org_1",
		"organization_name": "Acme",
		"name": "Acme workspace",
		"avatar_url": "https://example.com/avatar.png",
		"color": "dither",
		"created_at": "2026-07-04T21:00:00Z",
		"role": "admin",
		"can_edit": true,
		"can_connect": true,
		"can_approve": true,
		"client_reviews_enabled": true,
		"sso_required": false,
		"sso_authenticated": true,
		"sso_identity_linked": true,
		"sso_provider_id": "sso_1",
		"sso_provider_name": "Example SSO"
	}`
	var ws Workspace
	assertFaithfulProjection(t, "WorkspaceResponse", fixture, &ws)
}

func TestSocialAccountJSONProjectionMatchesOpenAPI(t *testing.T) {
	t.Parallel()
	const fixture = `{
		"id": "acc_1",
		"slug": "main-x",
		"platform": "x",
		"account_id": "x_handle",
		"account_username": "@rodrigo",
		"account_kind": "person",
		"account_avatar_url": "https://example.com/avatar.png",
		"alias": "Main",
		"instance_url": "",
		"is_active": true,
		"thread_replies_supported": true,
		"messaging_supported": false,
		"messages_enabled": false,
		"limit_profile": "standard",
		"capability_checked_at": "2026-07-04T21:00:00Z",
		"fediverse_software": "mastodon",
		"grant_destination_count": 1,
		"shared_grant": false,
		"provider_installation_id": "inst_1"
	}`
	var acc SocialAccount
	assertFaithfulProjection(t, "AccountResponse", fixture, &acc)
}

func TestJobJSONProjectionMatchesOpenAPI(t *testing.T) {
	t.Parallel()
	const fixture = `{
		"id": "job_1",
		"type": "publish",
		"payload": "{\"publication_id\":\"pub_1\"}",
		"status": "pending",
		"run_at": "2026-07-06T10:00:00Z",
		"attempts": 0,
		"max_attempts": 5,
		"last_error": "worker timeout",
		"created_at": "2026-07-04T21:00:00Z",
		"publication_id": "pub_1",
		"locked_at": "2026-07-04T21:01:00Z"
	}`
	var job Job
	assertFaithfulProjection(t, "JobResponse", fixture, &job)
}
