package textcards

import (
	"context"
	"strings"
	"testing"
)

func BenchmarkRenderSingleCard(b *testing.B) {
	body := strings.Repeat("Shipping the new renderer today. It is faster, sharper and works headless. ", 4)
	style := Style{Appearance: "light", Rounded: true, Shadow: true}
	identity := Identity{Name: "OpenPost", Handle: "openpost"}
	if _, err := Render(context.Background(), body, "", style, identity, nil, 0); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := Render(context.Background(), body, "", style, identity, nil, 0); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkRenderCarousel(b *testing.B) {
	body := strings.Repeat("Shipping the new renderer today. It is faster, sharper and works headless.\n", 25)
	style := Style{Appearance: "dark", Rounded: true, Shadow: true}
	identity := Identity{Name: "OpenPost", Handle: "openpost"}
	b.ReportAllocs()
	for b.Loop() {
		images, err := Render(context.Background(), body, "", style, identity, nil, 0)
		if err != nil {
			b.Fatal(err)
		}
		if len(images) < 2 {
			b.Fatalf("expected a carousel, got %d page", len(images))
		}
	}
}
