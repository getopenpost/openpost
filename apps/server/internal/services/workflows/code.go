package workflows

import (
	"context"

	"github.com/openpost/backend/internal/workflowcode"
)

func executeCode(ctx context.Context, code string, input any) (map[string]any, error) {
	value, err := workflowcode.Evaluate(ctx, code, input)
	if err != nil {
		return nil, err
	}
	return map[string]any{"data": value}, nil
}
