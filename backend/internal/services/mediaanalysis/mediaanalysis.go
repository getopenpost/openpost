package mediaanalysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const (
	AnalysisStatusPending = "pending"
	AnalysisStatusReady   = "ready"
	AnalysisStatusFailed  = "failed"
)

type Input struct {
	Filename string
	MIMEType string
	Content  []byte
}

type Result struct {
	Width           int
	Height          int
	DurationMS      int64
	FrameRate       float64
	PosterMIMEType  string
	PosterContent   []byte
	AnalysisStatus  string
	AnalysisError   string
	DominantType    string
	AspectRatio     string
	ThumbnailObject string
}

type Analyzer interface {
	Analyze(context.Context, Input) (Result, error)
}

type DisabledAnalyzer struct{}

func (DisabledAnalyzer) Analyze(_ context.Context, input Input) (Result, error) {
	return DisabledAnalyzer{}.AnalyzeFallback(input.MIMEType), nil
}

func (DisabledAnalyzer) AnalyzeFallback(mimeType string) Result {
	dominant := "other"
	if strings.HasPrefix(mimeType, "video/") {
		dominant = "video"
	}
	return Result{
		AnalysisStatus: AnalysisStatusPending,
		AnalysisError:  "media analyzer is not configured",
		DominantType:   dominant,
	}
}

type FakeAnalyzer struct {
	Result Result
	Err    error
}

func (f FakeAnalyzer) Analyze(_ context.Context, _ Input) (Result, error) {
	if f.Err != nil {
		return Result{AnalysisStatus: AnalysisStatusFailed, AnalysisError: f.Err.Error()}, f.Err
	}
	result := f.Result
	if result.AnalysisStatus == "" {
		result.AnalysisStatus = AnalysisStatusReady
	}
	return result, nil
}

type FFmpegAnalyzer struct {
	FFprobePath string
	Timeout     time.Duration
}

func (a FFmpegAnalyzer) Analyze(ctx context.Context, input Input) (Result, error) {
	if input.Filename == "" {
		return Result{AnalysisStatus: AnalysisStatusFailed, AnalysisError: "filename is required"}, errors.New("filename is required")
	}
	ffprobe := a.FFprobePath
	if ffprobe == "" {
		ffprobe = "ffprobe"
	}
	timeout := a.Timeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(probeCtx, ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate,duration", "-of", "json", input.Filename)
	output, err := cmd.Output()
	if err != nil {
		return Result{AnalysisStatus: AnalysisStatusFailed, AnalysisError: err.Error(), DominantType: "video"}, err
	}
	var probe struct {
		Streams []struct {
			Width        int    `json:"width"`
			Height       int    `json:"height"`
			AvgFrameRate string `json:"avg_frame_rate"`
			Duration     string `json:"duration"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(output, &probe); err != nil {
		return Result{AnalysisStatus: AnalysisStatusFailed, AnalysisError: err.Error(), DominantType: "video"}, err
	}
	if len(probe.Streams) == 0 {
		err := errors.New("no video stream found")
		return Result{AnalysisStatus: AnalysisStatusFailed, AnalysisError: err.Error(), DominantType: "video"}, err
	}
	stream := probe.Streams[0]
	durationSeconds, _ := strconv.ParseFloat(stream.Duration, 64)
	result := Result{
		Width:          stream.Width,
		Height:         stream.Height,
		DurationMS:     int64(durationSeconds * 1000),
		FrameRate:      parseFrameRate(stream.AvgFrameRate),
		AnalysisStatus: AnalysisStatusReady,
		DominantType:   "video",
		AspectRatio:    aspectRatio(stream.Width, stream.Height),
	}
	return result, nil
}

func parseFrameRate(value string) float64 {
	parts := strings.Split(value, "/")
	if len(parts) == 2 {
		numerator, _ := strconv.ParseFloat(parts[0], 64)
		denominator, _ := strconv.ParseFloat(parts[1], 64)
		if denominator != 0 {
			return numerator / denominator
		}
	}
	rate, _ := strconv.ParseFloat(value, 64)
	return rate
}

func aspectRatio(width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	gcd := greatestCommonDivisor(width, height)
	return fmt.Sprintf("%d:%d", width/gcd, height/gcd)
}

func greatestCommonDivisor(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a
	}
	return a
}
