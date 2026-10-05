package publicationbuilder

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/ai"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildPreservesAuthorDirectionAtProviderBoundary(t *testing.T) {
	for _, tc := range []struct {
		name         string
		lockedFields []string
	}{
		{"locked", []string{"outcome", "audience", "angle"}},
		{"unlocked", nil},
		{"outcome only", []string{"outcome"}},
		{"source only", nil},
		{"multimodal only", nil},
		{"multiline source ID", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := BuildInput{Idea: "Export now keeps source audio.", Destinations: []Destination{{AccountID: "blue", Platform: "bluesky", AllowedOutputProfiles: []OutputProfile{{Key: "post", TextLimit: 300, MaxSegments: 1}}}}}
			sourceID := "idea"
			if tc.name == "source only" {
				input.Sources = []SourceMaterial{{ID: "notes", Kind: "text", Text: input.Idea}}
				input.Idea = ""
				sourceID = "notes"
			}
			if tc.name == "multimodal only" {
				input.Images = []ai.Image{{Data: []byte("synthetic-image"), MIMEType: "image/png"}}
				input.Idea = ""
				sourceID = ""
			}
			if tc.name == "multiline source ID" {
				sourceID = "notes\n2"
				input.Sources = []SourceMaterial{{ID: sourceID, Kind: "text", Text: input.Idea}}
				input.Idea = ""
			}
			direction := DirectionInput{}
			values := map[string]string{"outcome": "Explain the change.\nInvite feedback.", "audience": "video editors", "angle": "show the source audio"}
			locked := map[string]bool{}
			for _, field := range tc.lockedFields {
				locked[field] = true
				switch field {
				case "outcome":
					direction.Outcome = " " + values[field] + " "
				case "audience":
					direction.Audience = values[field]
				case "angle":
					direction.Angle = values[field]
				}
			}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var request struct {
					ResponseFormat struct {
						JSONSchema struct {
							Name   string `json:"name"`
							Schema struct {
								Properties map[string]map[string]any `json:"properties"`
							} `json:"schema"`
						} `json:"json_schema"`
					} `json:"response_format"`
				}
				require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
				if claims, ok := request.ResponseFormat.JSONSchema.Schema.Properties["claims"]; ok {
					items := claims["items"].(map[string]any)
					refs := items["properties"].(map[string]any)["source_refs"].(map[string]any)
					if sourceID == "" || strings.Contains(sourceID, "\n") {
						assert.NotContains(t, refs["items"].(map[string]any), "enum")
						assert.Equal(t, "string", refs["items"].(map[string]any)["type"])
						if sourceID == "" {
							assert.Equal(t, float64(0), refs["maxItems"])
						}
					} else {
						assert.Equal(t, []any{sourceID}, refs["items"].(map[string]any)["enum"], "claim references must use the supplied source ledger")
					}
				}
				var output string
				switch request.ResponseFormat.JSONSchema.Name {
				case "openpost_publication_direction":
					items := request.ResponseFormat.JSONSchema.Schema.Properties["destinations"]["items"].(map[string]any)
					account := items["properties"].(map[string]any)["account_id"].(map[string]any)
					assert.Equal(t, []any{"blue"}, account["enum"], "the provider can select only candidate accounts")
					for field := range values {
						property := request.ResponseFormat.JSONSchema.Schema.Properties[field]
						if locked[field] {
							assert.NotContains(t, request.ResponseFormat.JSONSchema.Schema.Properties, field, "the provider does not own the author's %s", field)
						} else {
							require.Equal(t, "string", property["type"])
							require.NotContains(t, property, "enum")
						}
					}
					output = `{"canonical_text":"Export now keeps source audio.","factual_kernel":["Export now keeps source audio."],"thesis":"Keep the original audio.","outcome":"conversation","audience":"video editors","angle":"show the source audio","route":"artifact_led","claims":[],"media":{"treatment":"none","role":"none","brief":"No media.","source_ref":""},"destinations":[{"account_id":"blue","include":true,"reason":"Relevant technical update."}]}`
					if len(locked) > 0 {
						var plan map[string]any
						require.NoError(t, json.Unmarshal([]byte(output), &plan))
						for field := range locked {
							delete(plan, field)
						}
						encoded, err := json.Marshal(plan)
						require.NoError(t, err)
						output = string(encoded)
					}
				case "openpost_destination_rendition":
					output = `{"account_id":"blue","objective":"conversation","archetype":"technical_note","output_profile":"post","preview":"Export now keeps source audio.","segments":[{"body":"Export now keeps source audio.","title":"","description":""}],"media":{"treatment":"none","role":"none","brief":"No media.","source_ref":""},"claims":[],"warnings":[],"follow_up_notes":[]}`
				case "openpost_publication_review":
					output = `{"approved":true,"flags":[],"replacements":[]}`
				default:
					t.Errorf("unexpected generation stage")
				}
				if _, ok := request.ResponseFormat.JSONSchema.Schema.Properties["claims"]; ok && sourceID != "" {
					var plan map[string]any
					require.NoError(t, json.Unmarshal([]byte(output), &plan))
					plan["claims"] = []any{map[string]any{"text": "Export now keeps source audio.", "status": "supported", "source_refs": []string{sourceID}}}
					encoded, err := json.Marshal(plan)
					require.NoError(t, err)
					output = string(encoded)
				}
				w.Header().Set("Content-Type", "application/json")
				require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"id": "synthetic-request", "model": "synthetic-model", "choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": output}, "finish_reason": "stop"}}}))
			}))
			defer server.Close()
			generator, err := ai.NewOpenRouter(ai.OpenRouterConfig{APIKey: "synthetic-key", BaseURL: server.URL, HTTPClient: server.Client()})
			require.NoError(t, err)
			service, err := New(generator, Config{Model: "synthetic-model"})
			require.NoError(t, err)
			input.Direction = direction
			result, err := service.Build(context.Background(), input)
			require.NoError(t, err)
			if locked["outcome"] {
				require.Equal(t, values["outcome"], result.Direction.Outcome)
			} else {
				require.Equal(t, "conversation", result.Direction.Outcome)
			}
			require.Equal(t, values["audience"], result.Direction.Audience)
			require.Equal(t, values["angle"], result.Direction.Angle)
			require.Len(t, result.Destinations, 1)
			require.Equal(t, 3, calls)
		})
	}
}

type directionProbeGenerator struct{ calls int }

func (g *directionProbeGenerator) Generate(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
	g.calls++
	return ai.GenerateResult{}, ai.ErrEmptyResponse
}

func TestBuildRejectsOversizedDirectionBeforeGeneration(t *testing.T) {
	for _, tc := range []struct {
		name      string
		direction DirectionInput
	}{
		{"outcome", DirectionInput{Outcome: strings.Repeat("x", 201)}},
		{"audience", DirectionInput{Audience: strings.Repeat("x", 1001)}},
		{"angle", DirectionInput{Angle: strings.Repeat("x", 1501)}},
		{"tone", DirectionInput{ToneAdjustment: strings.Repeat("x", 501)}},
		{"media preference", DirectionInput{MediaPreference: strings.Repeat("x", 501)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			generator := &directionProbeGenerator{}
			service, err := New(generator, Config{Model: "synthetic-model"})
			require.NoError(t, err)
			_, err = service.Build(context.Background(), BuildInput{Idea: "A release.", Direction: tc.direction, Destinations: []Destination{{AccountID: "blue", Platform: "bluesky", AllowedOutputProfiles: []OutputProfile{{Key: "post", TextLimit: 300, MaxSegments: 1}}}}})
			require.ErrorContains(t, err, "direction")
			require.Zero(t, generator.calls)
		})
	}
}
