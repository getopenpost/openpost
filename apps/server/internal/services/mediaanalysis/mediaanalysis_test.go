package mediaanalysis

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestAnalyzeStreamingWebMRecording(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "screen.webm")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	// MediaRecorder writes a streaming WebM without a container duration.
	output, err := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=25", "-t", "2", "-c:v", "libvpx", "-live", "1", filename).CombinedOutput()
	if err != nil {
		t.Fatalf("create recording: %v: %s", err, output)
	}
	result, err := (FFmpegAnalyzer{}).Analyze(ctx, Input{Filename: filename, MIMEType: "video/webm"})
	if err != nil {
		t.Fatalf("analyze playable recording: %v", err)
	}
	if result.DurationMS < 1960 || result.DurationMS > 2040 {
		t.Fatalf("duration = %dms, want 2000ms within one frame", result.DurationMS)
	}
	if result.Width != 160 || result.Height != 90 || result.AnalysisStatus != AnalysisStatusReady {
		t.Fatalf("recording metadata: %+v", result)
	}
	if len(result.PosterContent) == 0 {
		t.Fatal("recording has no poster")
	}
	mislabelled, err := (FFmpegAnalyzer{}).Analyze(ctx, Input{Filename: filename, MIMEType: "audio/webm"})
	if err != nil || mislabelled.DominantType != "video" || mislabelled.Width != 160 {
		t.Fatalf("video tracks must override an audio declaration: %+v, %v", mislabelled, err)
	}
}

func TestAnalyzeStreamingMicrophoneWebM(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "microphone.webm")
	output, err := exec.CommandContext(t.Context(), "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:a", "libopus", "-live", "1", filename).CombinedOutput()
	if err != nil {
		t.Fatalf("create recording: %v: %s", err, output)
	}
	result, err := (FFmpegAnalyzer{}).Analyze(t.Context(), Input{Filename: filename, MIMEType: "video/webm"})
	if err != nil {
		t.Fatalf("analyze microphone recording: %v", err)
	}
	if result.DominantType != "audio" || result.AudioCodec != "opus" || result.AudioChannels != 1 || result.DurationMS < 980 || result.DurationMS > 1040 || len(result.PosterContent) != 0 {
		t.Fatalf("microphone metadata: %+v", result)
	}
}

func TestAnalyzeAnamorphicVideoDisplayDimensions(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	filename := filepath.Join(t.TempDir(), "anamorphic.mp4")
	// PAL 4:3 video stores 720x576 samples, with each pixel 16:15 as wide
	// as it is tall. Its square-pixel display dimensions are 768x576.
	output, err := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=720x576:r=25", "-vf", "setsar=16/15", "-t", "1", "-c:v", "libx264", filename).CombinedOutput()
	if err != nil {
		t.Fatalf("create anamorphic video: %v: %s", err, output)
	}
	rotated := filepath.Join(t.TempDir(), "rotated.mp4")
	output, err = exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-display_rotation:v:0", "90", "-i", filename, "-c", "copy", rotated).CombinedOutput()
	if err != nil {
		t.Fatalf("rotate anamorphic video: %v: %s", err, output)
	}
	for _, tc := range []struct {
		name          string
		filename      string
		width, height int
		aspect        string
	}{
		{"landscape", filename, 768, 576, "4:3"},
		{"rotated portrait", rotated, 576, 768, "3:4"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result, err := (FFmpegAnalyzer{}).Analyze(ctx, Input{Filename: tc.filename, MIMEType: "video/mp4"})
			if err != nil {
				t.Fatalf("analyze anamorphic video: %v", err)
			}
			if result.Width != tc.width || result.Height != tc.height || result.AspectRatio != tc.aspect {
				t.Fatalf("display geometry = %dx%d (%s), want %dx%d (%s)", result.Width, result.Height, result.AspectRatio, tc.width, tc.height, tc.aspect)
			}
		})
	}
}

func TestDisplayDimensionsWithUnknownOrInvalidSampleAspectRatio(t *testing.T) {
	for _, ratio := range []string{"", "N/A", "0:1", "1:0", "-1:1", "1:2:3", "invalid:1", "1:4294967296", "4294967295:1"} {
		t.Run(ratio, func(t *testing.T) {
			stream := probeStream{Width: 720, Height: 576, SampleAspectRatio: ratio}
			// An excessive but parseable ratio must not overflow int conversion.
			if ratio == "4294967295:1" {
				stream.Width = int(^uint(0) >> 1)
			}
			width, height := displayDimensions(&stream)
			if width != stream.Width || height != stream.Height {
				t.Fatalf("display dimensions = %dx%d, want encoded %dx%d", width, height, stream.Width, stream.Height)
			}
		})
	}
}

func TestProbeResultWithSubpixelDisplayWidth(t *testing.T) {
	result, _, err := resultFromProbe(probeOutput{Streams: []probeStream{{
		CodecType: "video", Width: 2, Height: 2, SampleAspectRatio: "1:8", Duration: "1",
	}}})
	if err != nil {
		t.Fatalf("analyze narrow stream: %v", err)
	}
	// The display width is one quarter of a pixel at the encoded height.
	// Expanding the display height preserves the 1:8 ratio with whole pixels.
	if result.Width != 2 || result.Height != 16 || result.AspectRatio != "1:8" {
		t.Fatalf("display geometry = %dx%d (%s), want 2x16 (1:8)", result.Width, result.Height, result.AspectRatio)
	}
}
