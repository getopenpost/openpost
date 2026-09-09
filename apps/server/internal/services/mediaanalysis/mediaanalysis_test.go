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
