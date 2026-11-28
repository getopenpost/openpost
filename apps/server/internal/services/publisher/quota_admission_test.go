package publisher

import (
	"context"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/providerwrite"
)

//nolint:unparam // workspaceID is part of the legacy write-scope signature; tests pass a static workspace while canonical callers use publicationWriteScope.
func legacyWriteScope(
	ctx context.Context,
	workspaceID, socialAccountID, targetKey, subject string,
) providerWriteScope {
	execution, _ := providerwrite.JobExecutionFromContext(ctx)
	owner := execution.ID
	if owner == "" {
		owner = workspaceID
	}
	return providerWriteScope{
		operationID:     strings.Join([]string{"legacy", owner, subject, "publish"}, ":"),
		socialAccountID: socialAccountID,
		targetKey:       targetKey,
		operation:       "publish",
		readiness: &writeReadiness{
			capability: capabilities.Capability{Provider: capabilities.ProviderX, OutputProfile: "x.post"},
			operation:  providerreadiness.OperationPublishImmediate,
			intent:     providerreadiness.ExecutionIntentProduction,
		},
	}
}
