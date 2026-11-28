package capabilities

import (
	"fmt"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestInstagramCarouselCapabilityAllowsUpTo20Items(t *testing.T) {
	makeItems := func(count int) []MediaItem {
		items := make([]MediaItem, count)
		for idx := range count {
			items[idx] = MediaItem{
				ID:              fmt.Sprintf("img-%d", idx+1),
				MimeType:        "image/jpeg",
				Width:           1080,
				Height:          1080,
				Size:            100_000,
				AnalysisStatus:  "ready",
				PublicURLReady:  true,
				PublicURLStatus: 200,
			}
		}
		return items
	}

	for _, count := range []int{11, 20} {
		t.Run(fmt.Sprintf("accepts_%d", count), func(t *testing.T) {
			issues := Validate(ProviderInstagram, models.ContentProfileCarousel, "Carousel caption", "", "", makeItems(count), nil)
			for _, issue := range issues {
				require.NotEqual(t, "error", issue.Severity, "unexpected error for %d items: %+v", count, issue)
			}
		})
	}

	issues := Validate(ProviderInstagram, models.ContentProfileCarousel, "Too many items", "", "", makeItems(21), nil)
	hasCountError := false
	for _, issue := range issues {
		if issue.Severity == "error" && issue.Code == "media_count" {
			hasCountError = true
		}
	}
	require.True(t, hasCountError, "expected media_count error for 21 Instagram carousel items, got %+v", issues)
}

func TestGoogleBusinessOfferAndEventCapabilityValidation(t *testing.T) {
	missingOfferIssues := Validate(ProviderGoogleBusiness, models.ContentProfileShortText, "Holiday sale", "", "", nil, map[string]any{
		"location_id":    "loc-1",
		"topic_type":     "offer",
		"call_to_action": "shop",
	})
	codes := map[string]bool{}
	for _, issue := range missingOfferIssues {
		if issue.Severity == "error" {
			codes[issue.Code] = true
		}
	}
	require.True(t, codes["googlebusiness_event_title_required"])
	require.True(t, codes["googlebusiness_event_start_date_required"])
	require.True(t, codes["googlebusiness_offer_cta_unsupported"])
	require.True(t, codes["googlebusiness_offer_redemption_required"])

	invertedDateIssues := Validate(ProviderGoogleBusiness, models.ContentProfileShortText, "Holiday sale", "", "", nil, map[string]any{
		"location_id":       "loc-1",
		"topic_type":        "offer",
		"event_title":       "Winter Promo",
		"event_start_date":  "2026-12-20",
		"event_end_date":    "2026-12-10",
		"offer_coupon_code": "WINTER20",
	})
	hasInvertedDate := false
	for _, issue := range invertedDateIssues {
		if issue.Severity == "error" && issue.Code == "googlebusiness_event_end_before_start" {
			hasInvertedDate = true
		}
	}
	require.True(t, hasInvertedDate)

	validOfferIssues := Validate(ProviderGoogleBusiness, models.ContentProfileShortText, "Holiday sale", "", "", nil, map[string]any{
		"location_id":       "loc-1",
		"topic_type":        "offer",
		"event_title":       "Winter Promo",
		"event_start_date":  "2026-12-10",
		"event_end_date":    "2026-12-20",
		"offer_coupon_code": "WINTER20",
	})
	for _, issue := range validOfferIssues {
		require.NotEqual(t, "error", issue.Severity, "unexpected error on valid offer: %+v", issue)
	}
}
