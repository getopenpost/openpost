package platform

import "testing"

func TestValidateMediaBlueskyRejectsMixedVideo(t *testing.T) {
	RegisterAllMediaValidators()
	issues := ValidateMedia(providerBluesky, []MediaItem{
		{ID: "video", MimeType: "video/mp4"},
		{ID: "image", MimeType: "image/png"},
	})

	if len(issues) != 1 {
		t.Fatalf("expected one issue, got %d", len(issues))
	}
	if issues[0].Severity != severityError {
		t.Fatalf("expected error severity, got %q", issues[0].Severity)
	}
}

func TestValidateMediaThreadsUsesMimeTypeForVideo(t *testing.T) {
	RegisterAllMediaValidators()
	issues := ValidateMedia(providerThreads, []MediaItem{
		{ID: "video-without-extension", MimeType: "video/mp4"},
	})

	if len(issues) != 0 {
		t.Fatalf("expected no issues for mp4 video, got %#v", issues)
	}
}

func TestValidateMediaThreadsAcceptsMixedCarousel(t *testing.T) {
	RegisterAllMediaValidators()
	issues := ValidateMedia(providerThreads, []MediaItem{
		{ID: "image", MimeType: "image/webp"},
		{ID: "video", MimeType: "video/quicktime"},
	})

	if len(issues) != 0 {
		t.Fatalf("expected no issues for a mixed Threads carousel, got %#v", issues)
	}
}

func TestValidateMediaThreadsRejectsTooManyOrUnsupportedAttachments(t *testing.T) {
	RegisterAllMediaValidators()
	media := make([]MediaItem, 11)
	for index := range media {
		media[index] = MediaItem{ID: "image", MimeType: "image/jpeg"}
	}

	issues := ValidateMedia(providerThreads, media)
	if len(issues) != 1 || issues[0].Severity != severityError || issues[0].Message != "Threads supports up to 10 media attachments per post." {
		t.Fatalf("expected a Threads carousel count error, got %#v", issues)
	}

	issues = ValidateMedia(providerThreads, []MediaItem{{ID: "document", MimeType: "application/pdf"}})
	if len(issues) != 1 || issues[0].MediaID != "document" || issues[0].Severity != severityError {
		t.Fatalf("expected an unsupported Threads media error, got %#v", issues)
	}
}

func TestValidateMediaLinkedInWarnsForMultipleAttachments(t *testing.T) {
	RegisterAllMediaValidators()
	issues := ValidateMedia(providerLinkedIn, []MediaItem{
		{ID: "first", MimeType: "image/png"},
		{ID: "second", MimeType: "image/png"},
	})

	if len(issues) != 1 {
		t.Fatalf("expected one issue, got %d", len(issues))
	}
	if issues[0].Severity != severityWarning {
		t.Fatalf("expected warning severity, got %q", issues[0].Severity)
	}
}

func TestValidateMediaLinkedInAcceptsDocument(t *testing.T) {
	RegisterAllMediaValidators()
	issues := ValidateMedia(providerLinkedIn, []MediaItem{{ID: "deck", MimeType: "application/pdf"}})
	if len(issues) != 0 {
		t.Fatalf("expected no issues for one PDF document, got %#v", issues)
	}
}

func TestValidateMediaTikTokAcceptsVideoOrPhotoPost(t *testing.T) {
	RegisterAllMediaValidators()

	issues := ValidateMedia(providerTikTok, []MediaItem{{ID: "image", MimeType: "image/jpeg"}})
	if len(issues) != 0 {
		t.Fatalf("expected no issues for one image, got %#v", issues)
	}

	issues = ValidateMedia(providerTikTok, []MediaItem{
		{ID: "first", MimeType: "image/webp"},
		{ID: "second", MimeType: "image/jpeg"},
	})
	if len(issues) != 0 {
		t.Fatalf("expected no issues for photo post, got %#v", issues)
	}

	issues = ValidateMedia(providerTikTok, []MediaItem{{ID: "video", MimeType: "video/mp4"}})
	if len(issues) != 0 {
		t.Fatalf("expected no issues for one video, got %#v", issues)
	}
}

func TestValidateMediaTikTokEnforcesPhotoPostLimits(t *testing.T) {
	RegisterAllMediaValidators()
	photos := make([]MediaItem, 35, 36)
	for index := range photos {
		photos[index] = MediaItem{ID: "photo", MimeType: "image/webp"}
	}

	if issues := ValidateMedia(providerTikTok, photos); len(issues) != 0 {
		t.Fatalf("expected 35 TikTok photos to pass, got %#v", issues)
	}
	issues := ValidateMedia(providerTikTok, append(photos, MediaItem{ID: "extra", MimeType: "image/jpeg"}))
	if len(issues) != 1 || issues[0].Message != "TikTok photo posts support 1-35 images." {
		t.Fatalf("expected TikTok photo count error, got %#v", issues)
	}
	issues = ValidateMedia(providerTikTok, []MediaItem{{ID: "png", MimeType: "image/png"}})
	if len(issues) != 1 || issues[0].MediaID != "png" || issues[0].Message != "TikTok photo posts support JPEG or WebP images only." {
		t.Fatalf("expected TikTok photo MIME error, got %#v", issues)
	}
}

func TestValidateMediaFacebookAcceptsMultiPhotoAttachments(t *testing.T) {
	RegisterAllMediaValidators()

	photos := make([]MediaItem, 10, 11)
	for index := range photos {
		photos[index] = MediaItem{ID: "photo", MimeType: "image/png"}
	}
	issues := ValidateMedia(providerFacebook, photos)
	if len(issues) != 0 {
		t.Fatalf("expected no issues for ten photo attachments, got %#v", issues)
	}

	issues = ValidateMedia(providerFacebook, []MediaItem{{ID: "video", MimeType: "video/quicktime"}})
	if len(issues) != 0 {
		t.Fatalf("expected no issues for one video attachment, got %#v", issues)
	}

	issues = ValidateMedia(providerFacebook, append(photos, MediaItem{ID: "extra", MimeType: "image/webp"}))
	if len(issues) != 1 || issues[0].Message != "Facebook photo posts support up to 10 media attachments." {
		t.Fatalf("expected Facebook photo count error, got %#v", issues)
	}

	issues = ValidateMedia(providerFacebook, []MediaItem{
		{ID: "image", MimeType: "image/png"},
		{ID: "video", MimeType: "video/mp4"},
	})
	if len(issues) != 1 || issues[0].MediaID != "video" || issues[0].Message != "Facebook multi-photo posts support JPEG, PNG, or WebP images only." {
		t.Fatalf("expected Facebook multi-photo MIME error, got %#v", issues)
	}
}

func TestValidateMediaInstagramRequiresOneToTenSupportedMedia(t *testing.T) {
	RegisterAllMediaValidators()

	issues := ValidateMedia(providerInstagram, nil)
	if len(issues) != 1 {
		t.Fatalf("expected one missing-media issue, got %d", len(issues))
	}

	issues = ValidateMedia(providerInstagram, []MediaItem{{ID: "file", MimeType: "application/pdf"}})
	if len(issues) != 1 {
		t.Fatalf("expected one unsupported-media issue, got %d", len(issues))
	}

	issues = ValidateMedia(providerInstagram, []MediaItem{{ID: "image", MimeType: "image/png"}})
	if len(issues) != 0 {
		t.Fatalf("expected no issues for one image, got %#v", issues)
	}

	carousel := make([]MediaItem, 10, 11)
	for index := range carousel {
		mimeType := "image/webp"
		if index%2 == 1 {
			mimeType = "video/mp4"
		}
		carousel[index] = MediaItem{ID: "media", MimeType: mimeType}
	}
	if issues = ValidateMedia(providerInstagram, carousel); len(issues) != 0 {
		t.Fatalf("expected no issues for a ten-item Instagram carousel, got %#v", issues)
	}
	issues = ValidateMedia(providerInstagram, append(carousel, MediaItem{ID: "extra", MimeType: "image/jpeg"}))
	if len(issues) != 1 || issues[0].Message != "Instagram publishing requires 1-10 image or video attachments." {
		t.Fatalf("expected Instagram carousel count error, got %#v", issues)
	}
	issues = ValidateMedia(providerInstagram, []MediaItem{{ID: "webm", MimeType: "video/webm"}})
	if len(issues) != 1 || issues[0].MediaID != "webm" {
		t.Fatalf("expected Instagram MIME error, got %#v", issues)
	}
}
