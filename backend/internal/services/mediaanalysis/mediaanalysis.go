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
	ContainerFormat string
	VideoCodec      string
	VideoProfile    string
	AudioCodec      string
	PixelFormat     string
	ColorSpace      string
	BitRate         int64
	Rotation        int
	AudioChannels   int
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
	FFmpegPath  string
	Timeout     time.Duration
}

type probeStream struct {
	CodecType      string `json:"codec_type"`
	CodecName      string `json:"codec_name"`
	Profile        string `json:"profile"`
	PixelFormat    string `json:"pix_fmt"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	AvgFrameRate   string `json:"avg_frame_rate"`
	Duration       string `json:"duration"`
	BitRate        string `json:"bit_rate"`
	Channels       int    `json:"channels"`
	ColorSpace     string `json:"color_space"`
	ColorTransfer  string `json:"color_transfer"`
	ColorPrimaries string `json:"color_primaries"`
	Tags           struct {
		Rotate string `json:"rotate"`
	} `json:"tags"`
	SideData []struct {
		Rotation int `json:"rotation"`
	} `json:"side_data_list"`
}

type probeOutput struct {
	Streams []probeStream `json:"streams"`
	Format  struct {
		FormatName string `json:"format_name"`
		Duration   string `json:"duration"`
		BitRate    string `json:"bit_rate"`
	} `json:"format"`
}

func (a FFmpegAnalyzer) Analyze(ctx context.Context, input Input) (Result, error) {
	if input.Filename == "" {
		return Result{AnalysisStatus: AnalysisStatusFailed, AnalysisError: "filename is required"}, errors.New("filename is required")
	}
	probe, err := a.probe(ctx, input.Filename)
	if err != nil {
		return failedVideoResult(err), err
	}
	result, durationSeconds, err := resultFromProbe(probe)
	if err != nil {
		return failedVideoResult(err), err
	}
	if poster, posterErr := a.renderPoster(ctx, input.Filename, durationSeconds); posterErr == nil {
		result.PosterMIMEType = "image/jpeg"
		result.PosterContent = poster
	}
	return result, nil
}

func (a FFmpegAnalyzer) probe(ctx context.Context, filename string) (probeOutput, error) {
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

	cmd := exec.CommandContext(
		probeCtx,
		ffprobe,
		"-v", "error",
		"-show_entries", "format=format_name,duration,bit_rate:stream=codec_type,codec_name,profile,pix_fmt,width,height,avg_frame_rate,duration,bit_rate,channels,color_space,color_transfer,color_primaries:stream_tags=rotate:stream_side_data=rotation",
		"-of", "json",
		filename,
	)
	output, err := cmd.Output()
	if err != nil {
		return probeOutput{}, err
	}
	var probe probeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		return probeOutput{}, err
	}
	return probe, nil
}

func resultFromProbe(probe probeOutput) (Result, float64, error) {
	videoStream, audioCodec, audioChannels := primaryStreams(probe.Streams)
	if videoStream == nil {
		return Result{}, 0, errors.New("no video stream found")
	}
	durationSeconds := parsePositiveFloat(firstNonEmpty(videoStream.Duration, probe.Format.Duration))
	if durationSeconds <= 0 {
		return Result{}, 0, errors.New("video duration is unavailable")
	}
	width, height := displayDimensions(videoStream)
	result := Result{
		Width:           width,
		Height:          height,
		DurationMS:      int64(durationSeconds * 1000),
		FrameRate:       parseFrameRate(videoStream.AvgFrameRate),
		ContainerFormat: strings.Split(probe.Format.FormatName, ",")[0],
		VideoCodec:      videoStream.CodecName,
		VideoProfile:    videoStream.Profile,
		AudioCodec:      audioCodec,
		PixelFormat:     videoStream.PixelFormat,
		ColorSpace:      firstNonEmpty(videoStream.ColorSpace, videoStream.ColorPrimaries, videoStream.ColorTransfer),
		BitRate:         parsePositiveInt64(firstNonEmpty(videoStream.BitRate, probe.Format.BitRate)),
		Rotation:        streamRotation(videoStream.Tags.Rotate, videoStream.SideData),
		AudioChannels:   audioChannels,
		AnalysisStatus:  AnalysisStatusReady,
		DominantType:    "video",
		AspectRatio:     aspectRatio(width, height),
	}
	return result, durationSeconds, nil
}

func primaryStreams(streams []probeStream) (*probeStream, string, int) {
	var videoStream *probeStream
	audioCodec := ""
	audioChannels := 0
	for i := range streams {
		stream := &streams[i]
		switch stream.CodecType {
		case "video":
			if videoStream == nil {
				videoStream = stream
			}
		case "audio":
			if audioCodec == "" {
				audioCodec = stream.CodecName
				audioChannels = stream.Channels
			}
		}
	}
	return videoStream, audioCodec, audioChannels
}

func displayDimensions(videoStream *probeStream) (int, int) {
	width, height := videoStream.Width, videoStream.Height
	rotation := streamRotation(videoStream.Tags.Rotate, videoStream.SideData)
	if rotation == 90 || rotation == 270 {
		width, height = height, width
	}
	return width, height
}

func failedVideoResult(err error) Result {
	return Result{AnalysisStatus: AnalysisStatusFailed, AnalysisError: err.Error(), DominantType: "video"}
}

func (a FFmpegAnalyzer) renderPoster(ctx context.Context, filename string, durationSeconds float64) ([]byte, error) {
	ffmpeg := strings.TrimSpace(a.FFmpegPath)
	if ffmpeg == "" {
		ffmpeg = "ffmpeg"
	}
	timeout := a.Timeout
	if timeout == 0 {
		timeout = 2 * time.Minute
	}
	posterCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	timestamp := durationSeconds * 0.1
	if timestamp > 5 {
		timestamp = 5
	}
	if timestamp < 0.05 {
		timestamp = 0.05
	}
	cmd := exec.CommandContext(
		posterCtx,
		ffmpeg,
		"-hide_banner",
		"-loglevel", "error",
		"-ss", strconv.FormatFloat(timestamp, 'f', 3, 64),
		"-i", filename,
		"-frames:v", "1",
		"-vf", "scale=1280:-2:force_original_aspect_ratio=decrease",
		"-f", "image2pipe",
		"-vcodec", "mjpeg",
		"pipe:1",
	)
	poster, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	if len(poster) == 0 {
		return nil, errors.New("poster generation returned no image")
	}
	return poster, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func parsePositiveFloat(value string) float64 {
	number, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if number < 0 {
		return 0
	}
	return number
}

func parsePositiveInt64(value string) int64 {
	number, _ := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if number < 0 {
		return 0
	}
	return number
}

func streamRotation(tagsRotation string, sideData []struct {
	Rotation int `json:"rotation"`
}) int {
	rotation, _ := strconv.Atoi(strings.TrimSpace(tagsRotation))
	for _, side := range sideData {
		if side.Rotation != 0 {
			rotation = side.Rotation
			break
		}
	}
	rotation %= 360
	if rotation < 0 {
		rotation += 360
	}
	switch {
	case rotation >= 45 && rotation < 135:
		return 90
	case rotation >= 135 && rotation < 225:
		return 180
	case rotation >= 225 && rotation < 315:
		return 270
	default:
		return 0
	}
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
