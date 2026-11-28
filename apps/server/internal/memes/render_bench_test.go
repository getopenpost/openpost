package memes

import (
	"context"
	"testing"
)

func benchMeme(b *testing.B, template string, text []string, ext string, height int) {
	provider, err := NewBuiltinProvider()
	if err != nil {
		b.Fatal(err)
	}
	request := RenderRequest{TemplateID: template, Text: text, Extension: ext, Height: height}
	if _, err := provider.Render(context.Background(), request); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := provider.Render(context.Background(), request); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkMemeDrakePNG(b *testing.B) {
	benchMeme(b, "drake", []string{"Rendering in the browser", "Rendering on the server"}, "png", 600)
}

func BenchmarkMemeDrakeEmoji(b *testing.B) {
	benchMeme(b, "drake", []string{"Rendering in the browser 😬", "Rendering on the server 🚀"}, "png", 600)
}
