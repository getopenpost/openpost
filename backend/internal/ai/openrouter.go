package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"strings"
	"time"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/shared"
)

const (
	defaultOpenRouterBaseURL     = "https://openrouter.ai/api/v1"
	defaultOpenRouterHTTPReferer = "https://openpost.social"
	defaultOpenRouterTitle       = "OpenPost"
	defaultOpenRouterTimeout     = 15 * time.Second
	defaultOpenRouterMaxRetries  = 4
	defaultRetryMaxInterval      = 2 * time.Second
	minWebSearchResults          = 1
	maxWebSearchResults          = 25
	minWebSearchUses             = 1
	maxWebSearchUses             = 30
	maxMultimodalSourceIDBytes   = 256
)

type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

type OpenRouterConfig struct {
	APIKey      string
	BaseURL     string
	HTTPClient  HTTPClient
	HTTPReferer string
	XTitle      string
	Timeout     time.Duration
	// Provider pins requests to one exact OpenRouter provider slug, such as
	// azure/eu. An empty value keeps the normal eligible-provider routing.
	Provider   string
	RequireZDR bool

	MaxRetries       int
	RetryMaxInterval time.Duration
}

type OpenRouter struct {
	client     openai.Client
	provider   string
	requireZDR bool
}

// OpenRouter may return assistant content as either a string or an array of
// typed text parts. The OpenAI SDK request path still owns auth, retries, and
// transport, while this narrow response shape preserves that router extension.
type openRouterChatCompletion struct {
	ID      string                    `json:"id"`
	Model   string                    `json:"model"`
	Choices []openRouterChatChoice    `json:"choices"`
	Usage   openRouterCompletionUsage `json:"usage"`
}

type openRouterChatChoice struct {
	Message struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

type openRouterCompletionUsage struct {
	PromptTokens     int64    `json:"prompt_tokens"`
	CompletionTokens int64    `json:"completion_tokens"`
	TotalTokens      int64    `json:"total_tokens"`
	Cost             *float64 `json:"cost"`
}

var _ Generator = (*OpenRouter)(nil)

func NewOpenRouter(config OpenRouterConfig) (*OpenRouter, error) {
	apiKey := strings.TrimSpace(config.APIKey)
	if apiKey == "" {
		return nil, errors.New("OpenRouter API key is required")
	}

	timeout := durationOrDefault(config.Timeout, defaultOpenRouterTimeout)
	retryMax := durationOrDefault(config.RetryMaxInterval, defaultRetryMaxInterval)
	maxRetries := config.MaxRetries
	if maxRetries == 0 {
		maxRetries = defaultOpenRouterMaxRetries
	}
	if timeout <= 0 || retryMax <= 0 || maxRetries < 0 {
		return nil, errors.New("OpenRouter timeout and retry durations must be positive")
	}

	httpReferer := strings.TrimSpace(config.HTTPReferer)
	if httpReferer == "" {
		httpReferer = defaultOpenRouterHTTPReferer
	}
	title := strings.TrimSpace(config.XTitle)
	if title == "" {
		title = defaultOpenRouterTitle
	}

	baseURL := strings.TrimSpace(config.BaseURL)
	if baseURL == "" {
		baseURL = defaultOpenRouterBaseURL
	}
	options := []option.RequestOption{
		option.WithAPIKey(apiKey),
		option.WithBaseURL(baseURL),
		option.WithHeader("HTTP-Referer", httpReferer),
		option.WithHeader("X-Title", title),
		option.WithRequestTimeout(timeout),
		option.WithMaxRetries(maxRetries),
		option.WithMaxRetryDelay(retryMax),
	}
	if config.HTTPClient != nil {
		options = append(options, option.WithHTTPClient(config.HTTPClient))
	}

	return &OpenRouter{
		client:     openai.NewClient(options...),
		provider:   strings.TrimSpace(config.Provider),
		requireZDR: config.RequireZDR,
	}, nil
}

func (o *OpenRouter) Generate(ctx context.Context, request GenerateRequest) (GenerateResult, error) {
	chatRequest, requestOptions, err := buildOpenRouterRequest(request, o.provider, o.requireZDR)
	if err != nil {
		return GenerateResult{}, err
	}

	var response openRouterChatCompletion
	requestOptions = append(requestOptions, option.WithResponseBodyInto(&response))
	_, err = o.client.Chat.Completions.New(ctx, chatRequest, requestOptions...)
	if err != nil && errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
		// The SDK exhausted its retry scope before the feature request budget.
		// Start one fresh read-only generation while the caller can still wait.
		response = openRouterChatCompletion{}
		_, err = o.client.Chat.Completions.New(ctx, chatRequest, requestOptions...)
	}
	if err != nil {
		return GenerateResult{}, sanitizeOpenRouterError(err)
	}

	text := extractOpenRouterText(response)
	if text == "" {
		return GenerateResult{}, ErrEmptyResponse
	}
	model := strings.TrimSpace(response.Model)
	if model == "" {
		model = strings.TrimSpace(request.Model)
	}

	return GenerateResult{
		Text:      text,
		Model:     model,
		RequestID: response.ID,
		Usage:     openRouterUsage(response.Usage),
	}, nil
}

//nolint:gocyclo // Provider-neutral generation options intentionally converge at this SDK request boundary.
func buildOpenRouterRequest(
	request GenerateRequest,
	providerSlug string,
	requireZDR bool,
) (openai.ChatCompletionNewParams, []option.RequestOption, error) {
	model := strings.TrimSpace(request.Model)
	if model == "" {
		return openai.ChatCompletionNewParams{}, nil, errors.New("AI model is required")
	}
	if strings.TrimSpace(request.UserPrompt) == "" && len(request.Parts) == 0 && len(request.Images) == 0 && len(request.Files) == 0 && len(request.Audio) == 0 && len(request.Videos) == 0 {
		return openai.ChatCompletionNewParams{}, nil, errors.New("AI user prompt, image, or file is required")
	}
	if request.MaxOutputTokens < 0 {
		return openai.ChatCompletionNewParams{}, nil, errors.New("AI maximum output tokens must not be negative")
	}
	webSearchTool, hasWebSearch, err := openRouterWebSearchTool(request.WebSearch)
	if err != nil {
		return openai.ChatCompletionNewParams{}, nil, err
	}

	messages := make([]openai.ChatCompletionMessageParamUnion, 0, 2)
	if systemPrompt := strings.TrimSpace(request.SystemPrompt); systemPrompt != "" {
		messages = append(messages, openai.SystemMessage(systemPrompt))
	}

	content := make([]openai.ChatCompletionContentPartUnionParam, 0, len(request.Parts)*2+len(request.Images)+len(request.Files)+len(request.Audio)+len(request.Videos)+1)
	if userPrompt := strings.TrimSpace(request.UserPrompt); userPrompt != "" {
		content = append(content, openai.TextContentPart(userPrompt))
	}
	for index, part := range request.Parts {
		items, err := openRouterMultimodalPartContent(part)
		if err != nil {
			return openai.ChatCompletionNewParams{}, nil, fmt.Errorf("AI multimodal part %d: %w", index+1, err)
		}
		content = append(content, items...)
	}
	for index, image := range request.Images {
		item, err := openRouterImageContent(image)
		if err != nil {
			return openai.ChatCompletionNewParams{}, nil, fmt.Errorf("AI image %d: %w", index+1, err)
		}
		content = append(content, item)
	}
	for index, file := range request.Files {
		item, err := openRouterFileContent(file)
		if err != nil {
			return openai.ChatCompletionNewParams{}, nil, fmt.Errorf("AI file %d: %w", index+1, err)
		}
		content = append(content, item)
	}
	for index, audio := range request.Audio {
		item, err := openRouterAudioContent(audio)
		if err != nil {
			return openai.ChatCompletionNewParams{}, nil, fmt.Errorf("AI audio %d: %w", index+1, err)
		}
		content = append(content, item)
	}
	for index, video := range request.Videos {
		item, err := openRouterVideoContent(video)
		if err != nil {
			return openai.ChatCompletionNewParams{}, nil, fmt.Errorf("AI video %d: %w", index+1, err)
		}
		content = append(content, item)
	}
	messages = append(messages, openai.UserMessage(content))

	reasoningEffort, err := openRouterReasoningEffort(request.ReasoningEffort)
	if err != nil {
		return openai.ChatCompletionNewParams{}, nil, err
	}
	providerPreferences := map[string]any{
		"data_collection":    "deny",
		"require_parameters": true,
	}
	if providerSlug = strings.TrimSpace(providerSlug); providerSlug != "" {
		providerPreferences["only"] = []string{providerSlug}
		providerPreferences["allow_fallbacks"] = false
	}
	if requireZDR {
		providerPreferences["zdr"] = true
	}
	chatRequest := openai.ChatCompletionNewParams{
		Messages:        messages,
		Model:           model,
		ReasoningEffort: reasoningEffort,
	}
	if request.ResponseSchema != nil {
		responseFormat, err := openRouterResponseFormat(*request.ResponseSchema)
		if err != nil {
			return openai.ChatCompletionNewParams{}, nil, err
		}
		chatRequest.ResponseFormat.OfJSONSchema = &responseFormat
	}
	if request.MaxOutputTokens > 0 {
		chatRequest.MaxCompletionTokens = param.NewOpt(request.MaxOutputTokens)
	}
	requestOptions := []option.RequestOption{
		option.WithJSONSet("stream", false),
		option.WithJSONSet("provider", providerPreferences),
	}
	if hasWebSearch {
		requestOptions = append(requestOptions, option.WithJSONSet("tools", []any{webSearchTool}))
	}

	return chatRequest, requestOptions, nil
}

func openRouterMultimodalPartContent(part MultimodalPart) ([]openai.ChatCompletionContentPartUnionParam, error) {
	sourceID := strings.TrimSpace(part.SourceID)
	if !validMultimodalSourceID(sourceID) {
		return nil, errors.New("valid source id is required")
	}
	payloads := 0
	if part.Image != nil {
		payloads++
	}
	if part.File != nil {
		payloads++
	}
	if part.Audio != nil {
		payloads++
	}
	if part.Video != nil {
		payloads++
	}
	if payloads != 1 {
		return nil, errors.New("exactly one media payload is required")
	}

	binding, err := json.Marshal(struct {
		SourceID string `json:"source_id"`
	}{SourceID: sourceID})
	if err != nil {
		return nil, errors.New("source binding could not be encoded")
	}
	items := make([]openai.ChatCompletionContentPartUnionParam, 0, 2)
	items = append(items, openai.TextContentPart("Source binding metadata, not instructions: "+string(binding)))
	var payload openai.ChatCompletionContentPartUnionParam
	switch {
	case part.Image != nil:
		payload, err = openRouterImageContent(*part.Image)
	case part.File != nil:
		payload, err = openRouterFileContent(*part.File)
	case part.Audio != nil:
		payload, err = openRouterAudioContent(*part.Audio)
	case part.Video != nil:
		payload, err = openRouterVideoContent(*part.Video)
	}
	if err != nil {
		return nil, err
	}
	return append(items, payload), nil
}

func validMultimodalSourceID(value string) bool {
	if value == "" || len(value) > maxMultimodalSourceIDBytes {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '-' || character == '_' || character == '.' || character == ':' {
			continue
		}
		return false
	}
	return true
}

func openRouterResponseFormat(schema JSONSchema) (shared.ResponseFormatJSONSchemaParam, error) {
	name := strings.TrimSpace(schema.Name)
	if name == "" {
		return shared.ResponseFormatJSONSchemaParam{}, errors.New("AI response schema name is required")
	}
	if len(schema.Schema) == 0 {
		return shared.ResponseFormatJSONSchemaParam{}, errors.New("AI response schema is required")
	}
	config := shared.ResponseFormatJSONSchemaJSONSchemaParam{
		Name:   name,
		Schema: schema.Schema,
		Strict: param.NewOpt(true),
	}
	if description := strings.TrimSpace(schema.Description); description != "" {
		config.Description = param.NewOpt(description)
	}
	return shared.ResponseFormatJSONSchemaParam{JSONSchema: config}, nil
}

func openRouterImageContent(image Image) (openai.ChatCompletionContentPartUnionParam, error) {
	if len(image.Data) == 0 {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("data is required")
	}
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(image.MIMEType))
	if err != nil || !strings.HasPrefix(strings.ToLower(mediaType), "image/") {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("valid image MIME type is required")
	}
	detail, err := openRouterImageDetail(image.Detail)
	if err != nil {
		return openai.ChatCompletionContentPartUnionParam{}, err
	}

	dataURL := "data:" + strings.ToLower(mediaType) + ";base64," + base64.StdEncoding.EncodeToString(image.Data)
	if detail == string(ImageDetailOriginal) {
		return rawOpenRouterContentPart(map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": dataURL, "detail": detail},
		})
	}
	return openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{
		URL: dataURL, Detail: detail,
	}), nil
}

func openRouterFileContent(file File) (openai.ChatCompletionContentPartUnionParam, error) {
	if len(file.Data) == 0 {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("data is required")
	}
	mediaType, err := normalizedMIMEType(file.MIMEType)
	if err != nil {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("valid MIME type is required")
	}
	filename := strings.TrimSpace(file.Filename)
	if filename == "" || strings.ContainsAny(filename, "\x00\r\n/\\") {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("valid filename is required")
	}

	dataURL := encodeDataURL(mediaType, file.Data)
	return openai.FileContentPart(openai.ChatCompletionContentPartFileFileParam{
		FileData: param.NewOpt(dataURL),
		Filename: param.NewOpt(filename),
	}), nil
}

func openRouterAudioContent(audio Audio) (openai.ChatCompletionContentPartUnionParam, error) {
	if len(audio.Data) == 0 {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("data is required")
	}
	mediaType, err := normalizedMIMEType(audio.MIMEType)
	if err != nil || !strings.HasPrefix(mediaType, "audio/") {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("valid audio MIME type is required")
	}
	format, ok := map[string]string{
		"audio/aac": "aac", "audio/aiff": "aiff", "audio/flac": "flac",
		"audio/m4a": "m4a", "audio/mp4": "m4a", "audio/mpeg": "mp3",
		"audio/ogg": "ogg", "audio/wav": "wav", "audio/x-aiff": "aiff",
		"audio/x-m4a": "m4a", "audio/x-wav": "wav",
	}[mediaType]
	if !ok {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("supported audio MIME type is required")
	}
	encoded := base64.StdEncoding.EncodeToString(audio.Data)
	if format != "wav" && format != "mp3" {
		return rawOpenRouterContentPart(map[string]any{
			"type":        "input_audio",
			"input_audio": map[string]any{"data": encoded, "format": format},
		})
	}
	return openai.InputAudioContentPart(openai.ChatCompletionContentPartInputAudioInputAudioParam{
		Data: encoded, Format: format,
	}), nil
}

func openRouterVideoContent(video Video) (openai.ChatCompletionContentPartUnionParam, error) {
	if len(video.Data) == 0 {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("data is required")
	}
	mediaType, err := normalizedMIMEType(video.MIMEType)
	if err != nil || !strings.HasPrefix(mediaType, "video/") {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("valid video MIME type is required")
	}
	return rawOpenRouterContentPart(map[string]any{
		"type":      "video_url",
		"video_url": map[string]any{"url": encodeDataURL(mediaType, video.Data)},
	})
}

func rawOpenRouterContentPart(value map[string]any) (openai.ChatCompletionContentPartUnionParam, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return openai.ChatCompletionContentPartUnionParam{}, errors.New("OpenRouter content part could not be encoded")
	}
	return param.Override[openai.ChatCompletionContentPartUnionParam](json.RawMessage(encoded)), nil
}

func normalizedMIMEType(value string) (string, error) {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(value))
	if err != nil || mediaType == "" || strings.Contains(mediaType, "*") {
		return "", errors.New("valid MIME type is required")
	}
	typeName, subtype, ok := strings.Cut(mediaType, "/")
	if !ok || typeName == "" || subtype == "" {
		return "", errors.New("valid MIME type is required")
	}
	return strings.ToLower(mediaType), nil
}

func encodeDataURL(mediaType string, data []byte) string {
	return "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(data)
}

func openRouterWebSearchTool(config WebSearchConfig) (map[string]any, bool, error) {
	if !config.Enabled {
		return nil, false, nil
	}
	if config.MaxResults < minWebSearchResults || config.MaxResults > maxWebSearchResults {
		return nil, false, errors.New("AI web search maximum results must be between 1 and 25")
	}
	if config.MaxUses < minWebSearchUses || config.MaxUses > maxWebSearchUses {
		return nil, false, errors.New("AI web search maximum uses must be between 1 and 30")
	}

	contextSize, err := openRouterWebSearchContext(config.Context)
	if err != nil {
		return nil, false, err
	}
	return map[string]any{
		"type": "openrouter:web_search",
		"parameters": map[string]any{
			"max_results":         config.MaxResults,
			"max_uses":            config.MaxUses,
			"search_context_size": contextSize,
		},
	}, true, nil
}

func openRouterWebSearchContext(context WebSearchContext) (string, error) {
	switch context {
	case WebSearchContextLow:
		return "low", nil
	case WebSearchContextMedium:
		return "medium", nil
	case WebSearchContextHigh:
		return "high", nil
	default:
		return "", errors.New("AI web search context must be low, medium, or high")
	}
}

func openRouterReasoningEffort(effort ReasoningEffort) (shared.ReasoningEffort, error) {
	switch effort {
	case "", ReasoningEffortNone:
		return shared.ReasoningEffortNone, nil
	case ReasoningEffortMinimal:
		return shared.ReasoningEffortMinimal, nil
	case ReasoningEffortLow:
		return shared.ReasoningEffortLow, nil
	case ReasoningEffortMedium:
		return shared.ReasoningEffortMedium, nil
	case ReasoningEffortHigh:
		return shared.ReasoningEffortHigh, nil
	default:
		return "", fmt.Errorf("unsupported AI reasoning effort %q", effort)
	}
}

func openRouterImageDetail(detail ImageDetail) (string, error) {
	switch detail {
	case "", ImageDetailLow:
		return "low", nil
	case ImageDetailAuto:
		return "auto", nil
	case ImageDetailHigh:
		return "high", nil
	case ImageDetailOriginal:
		return "original", nil
	default:
		return "", fmt.Errorf("unsupported AI image detail %q", detail)
	}
}

func extractOpenRouterText(result openRouterChatCompletion) string {
	for _, choice := range result.Choices {
		var text string
		if json.Unmarshal(choice.Message.Content, &text) == nil {
			if text = strings.TrimSpace(text); text != "" {
				return text
			}
			continue
		}

		var parts []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(choice.Message.Content, &parts) != nil {
			continue
		}
		textParts := make([]string, 0, len(parts))
		for _, part := range parts {
			if part.Type != "text" {
				continue
			}
			if text := strings.TrimSpace(part.Text); text != "" {
				textParts = append(textParts, text)
			}
		}
		if text := strings.Join(textParts, "\n"); text != "" {
			return text
		}
	}
	return ""
}

func openRouterUsage(usage openRouterCompletionUsage) Usage {
	return Usage{
		InputTokens:  usage.PromptTokens,
		OutputTokens: usage.CompletionTokens,
		TotalTokens:  usage.TotalTokens,
		CostUSD:      usage.Cost,
	}
}

func sanitizeOpenRouterError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return &ProviderError{Provider: "OpenRouter", StatusCode: openRouterStatusCode(err)}
}

func openRouterStatusCode(err error) int {
	var apiError *openai.Error
	if errors.As(err, &apiError) {
		return apiError.StatusCode
	}
	return 0
}

func durationOrDefault(value, fallback time.Duration) time.Duration {
	if value == 0 {
		return fallback
	}
	return value
}
