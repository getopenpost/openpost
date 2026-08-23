package main

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestNewWorkerIDIsUniqueAndNonSensitive(t *testing.T) {
	t.Parallel()

	first := newWorkerID()
	second := newWorkerID()

	require.NotEqual(t, first, second)
	require.True(t, strings.HasPrefix(first, "worker-"))
	_, err := uuid.Parse(strings.TrimPrefix(first, "worker-"))
	require.NoError(t, err)
}
