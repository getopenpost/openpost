package publicationbuilder

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/openpost/backend/internal/capabilities"
)

const (
	maxIdeaCharacters         = 20_000
	maxSourceCharacters       = 80_000
	maxSourceCount            = 12
	maxDestinationCount       = 20
	maxCanonicalCharacters    = 20_000
	maxFactualKernelItems     = 24
	maxClaims                 = 48
	maxWarningsPerDestination = 12
)

var (
	allowedClaimStatuses   = []string{"supported", "user_asserted", "opinion", "parody", "needs_verification"}
	allowedMediaTreatments = []string{"none", "use_source", "annotate_source", "meme", "statement_card", "carousel", "concept_image", "short_video_script", "edit_existing_video"}
)

func validateBuildInput(input BuildInput) error {
	if strings.TrimSpace(input.Idea) == "" && len(input.Sources) == 0 && len(input.Images) == 0 {
		return errors.New("an idea or source is required")
	}
	if utf8.RuneCountInString(input.Idea) > maxIdeaCharacters {
		return fmt.Errorf("idea exceeds %d characters", maxIdeaCharacters)
	}
	if len(input.Sources) > maxSourceCount {
		return fmt.Errorf("sources exceed the limit of %d", maxSourceCount)
	}
	seenSources := map[string]struct{}{}
	for _, source := range input.Sources {
		id := strings.TrimSpace(source.ID)
		if id == "" {
			return errors.New("every source requires an id")
		}
		if _, exists := seenSources[id]; exists {
			return fmt.Errorf("source id %q is repeated", id)
		}
		seenSources[id] = struct{}{}
		if utf8.RuneCountInString(source.Text) > maxSourceCharacters {
			return fmt.Errorf("source %q exceeds %d characters", id, maxSourceCharacters)
		}
	}
	if len(input.Destinations) == 0 || len(input.Destinations) > maxDestinationCount {
		return fmt.Errorf("destinations must contain 1 to %d accounts", maxDestinationCount)
	}
	if input.DestinationPolicy == "" {
		input.DestinationPolicy = DestinationPolicyRecommend
	}
	if input.DestinationPolicy != DestinationPolicyRecommend && input.DestinationPolicy != DestinationPolicyRequireAll {
		return fmt.Errorf("unsupported destination policy %q", input.DestinationPolicy)
	}
	seenAccounts := map[string]struct{}{}
	for _, destination := range input.Destinations {
		accountID := strings.TrimSpace(destination.AccountID)
		if accountID == "" {
			return errors.New("every destination requires an account id")
		}
		if _, exists := seenAccounts[accountID]; exists {
			return fmt.Errorf("destination account %q is repeated", accountID)
		}
		seenAccounts[accountID] = struct{}{}
		if len(destination.AllowedOutputProfiles) == 0 {
			return fmt.Errorf("destination %q has no allowed output profiles", accountID)
		}
	}
	return nil
}

func decodeStrictJSON(text string, target any) error {
	trimmed := strings.TrimSpace(text)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	decoder := json.NewDecoder(bytes.NewBufferString(strings.TrimSpace(trimmed)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode structured AI output: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("decode structured AI output: trailing data")
	}
	return nil
}

func validateDirector(plan DirectorPlan, destinations []Destination, sourceIDs map[string]struct{}, policy DestinationPolicy) error {
	if strings.TrimSpace(plan.CanonicalText) == "" || utf8.RuneCountInString(plan.CanonicalText) > maxCanonicalCharacters {
		return errors.New("director canonical_text is missing or too long")
	}
	if len(plan.FactualKernel) == 0 || len(plan.FactualKernel) > maxFactualKernelItems {
		return errors.New("director factual_kernel is missing or too large")
	}
	if len(plan.Claims) > maxClaims {
		return errors.New("director returned too many claims")
	}
	if err := validateClaims(plan.Claims, sourceIDs); err != nil {
		return fmt.Errorf("director claims: %w", err)
	}
	if err := validateMediaPlan(plan.Media); err != nil {
		return fmt.Errorf("director media: %w", err)
	}
	allowed := make(map[string]struct{}, len(destinations))
	for _, destination := range destinations {
		allowed[destination.AccountID] = struct{}{}
	}
	if len(plan.Destinations) != len(destinations) {
		return errors.New("director must decide every supported destination exactly once")
	}
	seen := map[string]struct{}{}
	included := 0
	for index := range plan.Destinations {
		decision := &plan.Destinations[index]
		if _, ok := allowed[decision.AccountID]; !ok {
			return fmt.Errorf("director selected unknown account %q", decision.AccountID)
		}
		if _, duplicate := seen[decision.AccountID]; duplicate {
			return fmt.Errorf("director repeated account %q", decision.AccountID)
		}
		seen[decision.AccountID] = struct{}{}
		if strings.TrimSpace(decision.Reason) == "" {
			return fmt.Errorf("director decision for %q requires a reason", decision.AccountID)
		}
		if policy == DestinationPolicyRequireAll {
			decision.Include = true
		}
		if decision.Include {
			included++
		}
	}
	if included == 0 {
		return errors.New("director did not include a usable destination")
	}
	return nil
}

func validateDestinationPlan(plan DestinationPlan, destination Destination, policy platformPolicy, sourceIDs map[string]struct{}) error {
	if plan.AccountID != destination.AccountID {
		return fmt.Errorf("adapter selected unknown account %q", plan.AccountID)
	}
	if !slices.Contains(policy.Objectives, plan.Objective) {
		return fmt.Errorf("adapter selected unsupported %s objective %q", policy.Platform, plan.Objective)
	}
	if !slices.Contains(policy.Archetypes, plan.Archetype) {
		return fmt.Errorf("adapter selected unsupported %s archetype %q", policy.Platform, plan.Archetype)
	}
	profile, ok := allowedOutputProfile(destination, plan.OutputProfile)
	if !ok {
		return fmt.Errorf("adapter selected unsupported output profile %q", plan.OutputProfile)
	}
	maxSegments := profile.MaxSegments
	if maxSegments <= 0 {
		maxSegments = 1
	}
	if len(plan.Segments) == 0 || len(plan.Segments) > maxSegments {
		return fmt.Errorf("adapter returned %d segments, allowed 1 to %d", len(plan.Segments), maxSegments)
	}
	for index, segment := range plan.Segments {
		if strings.TrimSpace(segment.Body) == "" {
			return fmt.Errorf("adapter segment %d has no body", index+1)
		}
		if profile.TextLimit > 0 && capabilities.TextLength(destination.Platform, segment.Body) > profile.TextLimit {
			return fmt.Errorf("adapter segment %d exceeds %s text limit of %d", index+1, destination.Platform, profile.TextLimit)
		}
	}
	if len(plan.Claims) > maxClaims {
		return errors.New("adapter returned too many claims")
	}
	if err := validateClaims(plan.Claims, sourceIDs); err != nil {
		return fmt.Errorf("adapter claims: %w", err)
	}
	if len(plan.Warnings) > maxWarningsPerDestination || len(plan.FollowUpNotes) > maxWarningsPerDestination {
		return errors.New("adapter returned too many warnings or follow-up notes")
	}
	return validateMediaPlan(plan.Media)
}

func validateClaims(claims []Claim, sourceIDs map[string]struct{}) error {
	for _, claim := range claims {
		if strings.TrimSpace(claim.Text) == "" || !slices.Contains(allowedClaimStatuses, claim.Status) {
			return errors.New("claim text or status is invalid")
		}
		for _, sourceID := range claim.SourceRefs {
			if _, ok := sourceIDs[sourceID]; !ok {
				return fmt.Errorf("claim references unknown source %q", sourceID)
			}
		}
	}
	return nil
}

func validateMediaPlan(plan MediaPlan) error {
	if !slices.Contains(allowedMediaTreatments, plan.Treatment) {
		return fmt.Errorf("unsupported media treatment %q", plan.Treatment)
	}
	if strings.TrimSpace(plan.Role) == "" || strings.TrimSpace(plan.Brief) == "" {
		return errors.New("media role and brief are required")
	}
	return nil
}

func allowedOutputProfile(destination Destination, key string) (OutputProfile, bool) {
	for _, profile := range destination.AllowedOutputProfiles {
		if profile.Key == key {
			return profile, true
		}
	}
	return OutputProfile{}, false
}
