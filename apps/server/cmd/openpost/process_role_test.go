package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProcessCommandRejectsUnknownOrAmbiguousArguments(t *testing.T) {
	t.Parallel()

	for _, args := range [][]string{{"server"}, {"web", "worker"}, {"grant-admin"}, {"grant-admin", "--email"}, {"grant-admin", "--email", ""}, {"grant-admin", "operator@example.test"}} {
		_, err := parseProcessCommand(args)
		require.ErrorContains(t, err, "usage: openpost")
	}
}

func TestProcessRoleCapabilitiesAreMutuallyExplicit(t *testing.T) {
	t.Parallel()

	require.True(t, processRoleAll.runsWeb())
	require.True(t, processRoleAll.runsWorker())
	require.True(t, processRoleAll.autoMigrates())

	require.True(t, processRoleWeb.runsWeb())
	require.False(t, processRoleWeb.runsWorker())
	require.False(t, processRoleWeb.autoMigrates())

	require.False(t, processRoleWorker.runsWeb())
	require.True(t, processRoleWorker.runsWorker())
	require.False(t, processRoleWorker.autoMigrates())

	require.False(t, processRoleMigrate.runsWeb())
	require.False(t, processRoleMigrate.runsWorker())
	require.True(t, processRoleMigrate.autoMigrates())

	require.False(t, processRoleMaintenance.runsWeb())
	require.False(t, processRoleMaintenance.runsWorker())
	require.False(t, processRoleMaintenance.autoMigrates())
}
