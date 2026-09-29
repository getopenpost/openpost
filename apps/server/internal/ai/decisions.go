package ai

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/openai/openai-go/v3/option"
)

// Decider returns a probability for a written criterion, rather than generated prose.
type Decider interface {
	Decide(context.Context, DecisionRequest) (DecisionResult, error)
}

type DecisionRequest struct {
	Model    string
	Input    string
	Criteria string
}
type DecisionResult struct {
	Probability float64
	Model       string
	RequestID   string
	Usage       Usage
}

// Decisions uses OpenRouter's separate typed endpoint. The maintained SDK still
// owns authentication, transport, deadlines and sanitized provider errors.
func (o *OpenRouter) Decide(ctx context.Context, request DecisionRequest) (DecisionResult, error) {
	if strings.TrimSpace(request.Model) == "" || strings.TrimSpace(request.Input) == "" || strings.TrimSpace(request.Criteria) == "" {
		return DecisionResult{}, errors.New("decision model, input and criteria are required")
	}
	provider := map[string]any{"data_collection": "deny", "require_parameters": true}
	if o.requireZDR {
		provider["zdr"] = true
	}
	if o.provider != "" {
		provider["only"] = []string{o.provider}
		provider["allow_fallbacks"] = false
	}
	body := map[string]any{
		"model":     request.Model,
		"state":     request.Input,
		"questions": map[string]any{"matched": map[string]any{"type": "noul", "instructions": request.Criteria}},
		"provider":  provider,
	}
	var response struct {
		ID      string `json:"id"`
		Model   string `json:"model"`
		Answers map[string]struct {
			Type        string   `json:"type"`
			Probability *float64 `json:"noul"`
		} `json:"answers"`
		Usage struct {
			InputTokens  int64    `json:"input_tokens"`
			OutputTokens int64    `json:"output_tokens"`
			Cost         *float64 `json:"cost"`
		} `json:"usage"`
	}
	// A durable caller owns recovery. Do not repeat a potentially accepted request.
	err := o.client.Post(ctx, "../alpha/decisions", body, &response, option.WithMaxRetries(0))
	result := DecisionResult{Model: response.Model, RequestID: response.ID, Usage: Usage{InputTokens: response.Usage.InputTokens, OutputTokens: response.Usage.OutputTokens, TotalTokens: response.Usage.InputTokens + response.Usage.OutputTokens, CostUSD: response.Usage.Cost}}
	if result.Model == "" {
		result.Model = request.Model
	}
	if err != nil {
		return result, sanitizeOpenRouterError(err)
	}
	answer := response.Answers["matched"]
	if answer.Type != "noul" || answer.Probability == nil || math.IsNaN(*answer.Probability) || math.IsInf(*answer.Probability, 0) || *answer.Probability < 0 || *answer.Probability > 1 {
		return result, errors.New("AI decision returned an invalid probability")
	}
	result.Probability = *answer.Probability
	return result, nil
}
