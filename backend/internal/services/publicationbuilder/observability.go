package publicationbuilder

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"sync"

	"github.com/openpost/backend/internal/ai"
)

const (
	maxGenerationCalls   = 32
	maxGenerationModel   = 200
	maxGenerationRequest = 256
	maxGenerationAccount = 200
	maxGenerationTokens  = int64(1_000_000_000_000)
	maxGenerationCostUSD = 1_000_000.0
)

type generationCall struct {
	Stage        string   `json:"stage"`
	AccountID    string   `json:"account_id,omitempty"`
	Model        string   `json:"model,omitempty"`
	RequestID    string   `json:"request_id,omitempty"`
	InputTokens  int64    `json:"input_tokens"`
	OutputTokens int64    `json:"output_tokens"`
	TotalTokens  int64    `json:"total_tokens"`
	CostUSD      *float64 `json:"cost_usd,omitempty"`
}

type generationUsage struct {
	Calls        []generationCall `json:"calls"`
	InputTokens  int64            `json:"input_tokens"`
	OutputTokens int64            `json:"output_tokens"`
	TotalTokens  int64            `json:"total_tokens"`
	CostUSD      float64          `json:"cost_usd"`
}

type generationTraceKey struct{}

type generationTrace struct {
	mu    sync.Mutex
	calls []generationCall
}

func withGenerationTrace(ctx context.Context) (context.Context, *generationTrace) {
	trace := &generationTrace{calls: make([]generationCall, 0, 4)}
	return context.WithValue(ctx, generationTraceKey{}, trace), trace
}

func recordGeneration(ctx context.Context, stage, accountID string, result ai.GenerateResult) {
	trace, _ := ctx.Value(generationTraceKey{}).(*generationTrace)
	if trace == nil {
		return
	}
	call := generationCall{
		Stage:        safeGenerationStage(stage),
		AccountID:    boundedGenerationText(accountID, maxGenerationAccount),
		Model:        boundedGenerationText(result.Model, maxGenerationModel),
		RequestID:    boundedGenerationText(result.RequestID, maxGenerationRequest),
		InputTokens:  nonnegative(result.Usage.InputTokens),
		OutputTokens: nonnegative(result.Usage.OutputTokens),
		TotalTokens:  nonnegative(result.Usage.TotalTokens),
		CostUSD:      safeCost(result.Usage.CostUSD),
	}
	trace.mu.Lock()
	defer trace.mu.Unlock()
	if len(trace.calls) < maxGenerationCalls {
		trace.calls = append(trace.calls, call)
	}
}

func (trace *generationTrace) encoded() (model, requestID, usageJSON string) {
	if trace == nil {
		return "", "", "{}"
	}
	trace.mu.Lock()
	calls := append([]generationCall(nil), trace.calls...)
	trace.mu.Unlock()
	sort.SliceStable(calls, func(left, right int) bool {
		leftRank := generationStageRank(calls[left].Stage)
		rightRank := generationStageRank(calls[right].Stage)
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if calls[left].AccountID != calls[right].AccountID {
			return calls[left].AccountID < calls[right].AccountID
		}
		return false
	})

	usage := generationUsage{Calls: calls}
	for _, call := range calls {
		if model == "" && call.Model != "" {
			model = call.Model
		}
		if requestID == "" && call.RequestID != "" {
			requestID = call.RequestID
		}
		usage.InputTokens = boundedSum(usage.InputTokens, call.InputTokens, maxGenerationTokens)
		usage.OutputTokens = boundedSum(usage.OutputTokens, call.OutputTokens, maxGenerationTokens)
		usage.TotalTokens = boundedSum(usage.TotalTokens, call.TotalTokens, maxGenerationTokens)
		if call.CostUSD != nil {
			usage.CostUSD = math.Min(maxGenerationCostUSD, usage.CostUSD+*call.CostUSD)
		}
	}
	encoded, err := json.Marshal(usage)
	if err != nil {
		return model, requestID, "{}"
	}
	return model, requestID, string(encoded)
}

func safeGenerationStage(stage string) string {
	switch stage {
	case "director", "adapter", "reviewer":
		return stage
	default:
		return "unknown"
	}
}

func generationStageRank(stage string) int {
	switch stage {
	case "director":
		return 0
	case "adapter":
		return 1
	case "reviewer":
		return 2
	default:
		return 3
	}
}

func boundedGenerationText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maximum {
		value = string(runes[:maximum])
	}
	return value
}

func nonnegative(value int64) int64 {
	if value < 0 {
		return 0
	}
	return min(value, maxGenerationTokens)
}

func safeCost(value *float64) *float64 {
	if value == nil || *value < 0 || *value > maxGenerationCostUSD || math.IsInf(*value, 0) || math.IsNaN(*value) {
		return nil
	}
	copy := *value
	return &copy
}

func boundedSum(left, right, maximum int64) int64 {
	if right > maximum-left {
		return maximum
	}
	return left + right
}
