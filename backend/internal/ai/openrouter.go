package ai

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"strings"
	"time"

	openrouter "github.com/OpenRouterTeam/go-sdk"
	"github.com/OpenRouterTeam/go-sdk/models/components"
	"github.com/OpenRouterTeam/go-sdk/models/operations"
	"github.com/OpenRouterTeam/go-sdk/models/sdkerrors"
	"github.com/OpenRouterTeam/go-sdk/optionalnullable"
	"github.com/OpenRouterTeam/go-sdk/retry"
)

const (
	defaultOpenRouterHTTPReferer = "https://openpost.social"
	defaultOpenRouterTitle       = "OpenPost"
	defaultOpenRouterTimeout     = 15 * time.Second
	defaultRetryInitialInterval  = 250 * time.Millisecond
	defaultRetryMaxInterval      = 2 * time.Second
	defaultRetryMaxElapsedTime   = 5 * time.Second
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

	RetryInitialInterval time.Duration
	RetryMaxInterval     time.Duration
	RetryMaxElapsedTime  time.Duration
}

type OpenRouter struct {
	client     *openrouter.OpenRouter
	headers    map[string]string
	provider   string
	requireZDR bool
}

var _ Generator = (*OpenRouter)(nil)

func NewOpenRouter(config OpenRouterConfig) (*OpenRouter, error) {
	apiKey := strings.TrimSpace(config.APIKey)
	if apiKey == "" {
		return nil, errors.New("OpenRouter API key is required")
	}

	timeout := durationOrDefault(config.Timeout, defaultOpenRouterTimeout)
	retryInitial := durationOrDefault(config.RetryInitialInterval, defaultRetryInitialInterval)
	retryMax := durationOrDefault(config.RetryMaxInterval, defaultRetryMaxInterval)
	retryElapsed := durationOrDefault(config.RetryMaxElapsedTime, defaultRetryMaxElapsedTime)
	if timeout <= 0 || retryInitial <= 0 || retryMax <= 0 || retryElapsed <= 0 {
		return nil, errors.New("OpenRouter timeout and retry durations must be positive")
	}
	if retryMax < retryInitial {
		return nil, errors.New("OpenRouter maximum retry interval must not be shorter than its initial interval")
	}
	if retryElapsed > timeout {
		retryElapsed = timeout
	}

	httpReferer := strings.TrimSpace(config.HTTPReferer)
	if httpReferer == "" {
		httpReferer = defaultOpenRouterHTTPReferer
	}
	title := strings.TrimSpace(config.XTitle)
	if title == "" {
		title = defaultOpenRouterTitle
	}

	options := []openrouter.SDKOption{
		openrouter.WithSecurity(apiKey),
		openrouter.WithHTTPReferer(httpReferer),
		openrouter.WithXTitle(title),
		openrouter.WithTimeout(timeout),
		openrouter.WithRetryConfig(retry.Config{
			Strategy: "backoff",
			Backoff: &retry.BackoffStrategy{
				InitialInterval: milliseconds(retryInitial),
				MaxInterval:     milliseconds(retryMax),
				Exponent:        1.5,
				MaxElapsedTime:  milliseconds(retryElapsed),
			},
			RetryConnectionErrors: true,
		}),
	}
	if baseURL := strings.TrimSpace(config.BaseURL); baseURL != "" {
		options = append(options, openrouter.WithServerURL(baseURL))
	}
	if config.HTTPClient != nil {
		options = append(options, openrouter.WithClient(config.HTTPClient))
	}

	return &OpenRouter{
		client: openrouter.New(options...),
		headers: map[string]string{
			"HTTP-Referer": httpReferer,
			"X-Title":      title,
		},
		provider:   strings.TrimSpace(config.Provider),
		requireZDR: config.RequireZDR,
	}, nil
}

func (o *OpenRouter) Generate(ctx context.Context, request GenerateRequest) (GenerateResult, error) {
	chatRequest, err := buildOpenRouterRequest(request, o.provider, o.requireZDR)
	if err != nil {
		return GenerateResult{}, err
	}

	response, err := o.client.Chat.Send(ctx, chatRequest, nil, operations.WithSetHeaders(o.headers))
	if err != nil {
		return GenerateResult{}, sanitizeOpenRouterError(err)
	}
	if response == nil || response.ChatResult == nil {
		return GenerateResult{}, ErrEmptyResponse
	}

	result := response.ChatResult
	text := extractOpenRouterText(result)
	if text == "" {
		return GenerateResult{}, ErrEmptyResponse
	}
	model := strings.TrimSpace(result.Model)
	if model == "" {
		model = strings.TrimSpace(request.Model)
	}

	return GenerateResult{
		Text:      text,
		Model:     model,
		RequestID: result.ID,
		Usage:     openRouterUsage(result.Usage),
	}, nil
}

func buildOpenRouterRequest(request GenerateRequest, providerSlug string, requireZDR bool) (components.ChatRequest, error) {
	model := strings.TrimSpace(request.Model)
	if model == "" {
		return components.ChatRequest{}, errors.New("AI model is required")
	}
	if strings.TrimSpace(request.UserPrompt) == "" && len(request.Images) == 0 {
		return components.ChatRequest{}, errors.New("AI user prompt or image is required")
	}
	if request.MaxOutputTokens < 0 {
		return components.ChatRequest{}, errors.New("AI maximum output tokens must not be negative")
	}

	messages := make([]components.ChatMessages, 0, 2)
	if systemPrompt := strings.TrimSpace(request.SystemPrompt); systemPrompt != "" {
		messages = append(messages, components.CreateChatMessagesSystem(components.ChatSystemMessage{
			Content: components.CreateChatSystemMessageContentStr(systemPrompt),
		}))
	}

	content := make([]components.ChatContentItems, 0, len(request.Images)+1)
	if userPrompt := strings.TrimSpace(request.UserPrompt); userPrompt != "" {
		content = append(content, components.CreateChatContentItemsText(components.ChatContentText{Text: userPrompt}))
	}
	for index, image := range request.Images {
		item, err := openRouterImageContent(image)
		if err != nil {
			return components.ChatRequest{}, fmt.Errorf("AI image %d: %w", index+1, err)
		}
		content = append(content, item)
	}
	messages = append(messages, components.CreateChatMessagesUser(components.ChatUserMessage{
		Content: components.CreateChatUserMessageContentArrayOfChatContentItems(content),
	}))

	reasoningEffort, err := openRouterReasoningEffort(request.ReasoningEffort)
	if err != nil {
		return components.ChatRequest{}, err
	}
	dataCollection := components.DataCollectionDeny
	requireParameters := true
	stream := false
	providerPreferences := &components.ProviderPreferences{
		DataCollection:    optionalnullable.From(&dataCollection),
		RequireParameters: optionalnullable.From(&requireParameters),
	}
	if providerSlug = strings.TrimSpace(providerSlug); providerSlug != "" {
		allowedProvider := []components.ProviderPreferencesOnly{
			components.CreateProviderPreferencesOnlyStr(providerSlug),
		}
		allowFallbacks := false
		providerPreferences.Only = optionalnullable.From(&allowedProvider)
		providerPreferences.AllowFallbacks = optionalnullable.From(&allowFallbacks)
	}
	if requireZDR {
		zdr := true
		providerPreferences.Zdr = optionalnullable.From(&zdr)
	}
	chatRequest := components.ChatRequest{
		Messages:        messages,
		Model:           &model,
		Provider:        optionalnullable.From(providerPreferences),
		ReasoningEffort: optionalnullable.From(&reasoningEffort),
		Stream:          &stream,
	}
	if request.MaxOutputTokens > 0 {
		maxOutputTokens := request.MaxOutputTokens
		chatRequest.MaxCompletionTokens = optionalnullable.From(&maxOutputTokens)
	}

	return chatRequest, nil
}

func openRouterImageContent(image Image) (components.ChatContentItems, error) {
	if len(image.Data) == 0 {
		return components.ChatContentItems{}, errors.New("data is required")
	}
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(image.MIMEType))
	if err != nil || !strings.HasPrefix(strings.ToLower(mediaType), "image/") {
		return components.ChatContentItems{}, errors.New("valid image MIME type is required")
	}
	detail, err := openRouterImageDetail(image.Detail)
	if err != nil {
		return components.ChatContentItems{}, err
	}

	dataURL := "data:" + strings.ToLower(mediaType) + ";base64," + base64.StdEncoding.EncodeToString(image.Data)
	return components.CreateChatContentItemsImageURL(components.ChatContentImage{
		ImageURL: components.ChatContentImageImageURL{
			URL:    dataURL,
			Detail: detail.ToPointer(),
		},
	}), nil
}

func openRouterReasoningEffort(effort ReasoningEffort) (components.ChatRequestReasoningEffort, error) {
	switch effort {
	case "", ReasoningEffortNone:
		return components.ChatRequestReasoningEffortNone, nil
	case ReasoningEffortMinimal:
		return components.ChatRequestReasoningEffortMinimal, nil
	case ReasoningEffortLow:
		return components.ChatRequestReasoningEffortLow, nil
	case ReasoningEffortMedium:
		return components.ChatRequestReasoningEffortMedium, nil
	case ReasoningEffortHigh:
		return components.ChatRequestReasoningEffortHigh, nil
	default:
		return "", fmt.Errorf("unsupported AI reasoning effort %q", effort)
	}
}

func openRouterImageDetail(detail ImageDetail) (components.ChatContentImageDetail, error) {
	switch detail {
	case "", ImageDetailLow:
		return components.ChatContentImageDetailLow, nil
	case ImageDetailAuto:
		return components.ChatContentImageDetailAuto, nil
	case ImageDetailHigh:
		return components.ChatContentImageDetailHigh, nil
	case ImageDetailOriginal:
		return components.ChatContentImageDetailOriginal, nil
	default:
		return "", fmt.Errorf("unsupported AI image detail %q", detail)
	}
}

func extractOpenRouterText(result *components.ChatResult) string {
	for _, choice := range result.Choices {
		content, ok := choice.Message.Content.GetOrZero()
		if !ok {
			continue
		}
		if content.Str != nil {
			if text := strings.TrimSpace(*content.Str); text != "" {
				return text
			}
		}
		var textParts []string
		for _, item := range content.ArrayOfChatContentItems {
			if item.ChatContentText != nil {
				if text := strings.TrimSpace(item.ChatContentText.Text); text != "" {
					textParts = append(textParts, text)
				}
			}
		}
		if len(textParts) > 0 {
			return strings.Join(textParts, "\n")
		}
	}
	return ""
}

func openRouterUsage(usage *components.ChatUsage) Usage {
	if usage == nil {
		return Usage{}
	}
	result := Usage{
		InputTokens:  usage.PromptTokens,
		OutputTokens: usage.CompletionTokens,
		TotalTokens:  usage.TotalTokens,
	}
	if cost, ok := usage.Cost.GetOrZero(); ok && !usage.Cost.IsNull() {
		result.CostUSD = &cost
	}
	return result
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
	var apiError *sdkerrors.APIError
	if errors.As(err, &apiError) {
		return apiError.StatusCode
	}
	if statusCode := openRouterClientErrorStatusCode(err); statusCode != 0 {
		return statusCode
	}
	return openRouterServerErrorStatusCode(err)
}

func openRouterClientErrorStatusCode(err error) int {
	switch err.(type) {
	case *sdkerrors.BadRequestResponseError:
		return http.StatusBadRequest
	case *sdkerrors.UnauthorizedResponseError:
		return http.StatusUnauthorized
	case *sdkerrors.PaymentRequiredResponseError:
		return http.StatusPaymentRequired
	case *sdkerrors.ForbiddenResponseError:
		return http.StatusForbidden
	case *sdkerrors.NotFoundResponseError:
		return http.StatusNotFound
	case *sdkerrors.RequestTimeoutResponseError:
		return http.StatusRequestTimeout
	case *sdkerrors.PayloadTooLargeResponseError:
		return http.StatusRequestEntityTooLarge
	case *sdkerrors.UnprocessableEntityResponseError:
		return http.StatusUnprocessableEntity
	case *sdkerrors.TooManyRequestsResponseError:
		return http.StatusTooManyRequests
	default:
		return 0
	}
}

func openRouterServerErrorStatusCode(err error) int {
	switch err.(type) {
	case *sdkerrors.InternalServerResponseError:
		return http.StatusInternalServerError
	case *sdkerrors.BadGatewayResponseError:
		return http.StatusBadGateway
	case *sdkerrors.ServiceUnavailableResponseError:
		return http.StatusServiceUnavailable
	case *sdkerrors.EdgeNetworkTimeoutResponseError:
		return 524
	case *sdkerrors.ProviderOverloadedResponseError:
		return 529
	default:
		return 0
	}
}

func durationOrDefault(value, fallback time.Duration) time.Duration {
	if value == 0 {
		return fallback
	}
	return value
}

func milliseconds(duration time.Duration) int {
	value := duration.Milliseconds()
	if value < 1 {
		return 1
	}
	return int(value)
}
