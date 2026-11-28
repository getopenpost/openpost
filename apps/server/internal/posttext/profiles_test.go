package posttext

import "testing"

func TestSavedMentionProjectsSnapshotPerNetwork(t *testing.T) {
	target := alice()
	native := NativeMentionTarget{Provider: target.Provider, Kind: target.Kind, ID: target.ID, Authority: target.Authority, Handle: target.Handle}
	profile := MentionTarget{Provider: "workspace", Kind: "profile", ID: "saved", Profiles: []MentionProfile{
		{Provider: "bluesky", Text: "@alice.bsky.social", Target: &native},
		{Provider: "x", Text: "@alice_x"},
	}}
	body := "🚀 Hi @alice, @alice stays plain"
	projection := &Projection{Mentions: Mentions{Version: 1, Spans: []MentionSpan{{Start: 8, End: 14, Text: "@alice", Target: profile}}}}
	for _, tc := range []struct {
		provider, want string
		native         int
	}{
		{"bluesky", "🚀 Hi @alice.bsky.social, @alice stays plain", 1},
		{"x", "🚀 Hi @alice_x, @alice stays plain", 0},
		{"youtube", body, 0},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			text, out, err := ForDestination(body, tc.provider, "", projection)
			if err != nil || text != tc.want || len(out.Spans) != tc.native {
				t.Fatalf("text=%q projection=%+v err=%v", text, out, err)
			}
			if tc.native == 1 && (out.Spans[0].Start != 8 || out.Spans[0].End != 26 || out.Spans[0].Target.ID != target.ID) {
				t.Fatalf("wrong UTF-8 identity: %+v", out.Spans)
			}
		})
	}
}

func TestSavedMentionPrefersExactAuthorityOverProviderWideProfile(t *testing.T) {
	profile := MentionTarget{Provider: "workspace", Kind: "profile", ID: "saved", Profiles: []MentionProfile{
		{Provider: "mastodon", Text: "@alice"},
		{Provider: "mastodon", Authority: "https://social.example", Text: "@alice@social.example"},
	}}
	body := "Hi @alice"
	projection := &Projection{Mentions: Mentions{Version: 1, Spans: []MentionSpan{{Start: 3, End: 9, Text: "@alice", Target: profile}}}}
	for authority, want := range map[string]string{
		"https://social.example": "Hi @alice@social.example",
		"https://other.example":  "Hi @alice",
	} {
		text, _, err := ForDestination(body, "mastodon", authority, projection)
		if err != nil || text != want {
			t.Fatalf("authority %s: text=%q err=%v, want %q", authority, text, err, want)
		}
	}
}
