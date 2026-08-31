package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProcessCommandContract(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		args        []string
		role        processRole
		checkConfig bool
		rotateKey   bool
		showHelp    bool
	}{
		{name: "default remains the combined self-host process", role: processRoleAll},
		{name: "explicit combined process", args: []string{"all"}, role: processRoleAll},
		{name: "web process", args: []string{"web"}, role: processRoleWeb},
		{name: "worker process", args: []string{"worker"}, role: processRoleWorker},
		{name: "migration process", args: []string{"migrate"}, role: processRoleMigrate},
		{name: "encryption key rotation", args: []string{"rotate-encryption-key"}, role: processRoleMaintenance, rotateKey: true},
		{name: "configuration check remains available", args: []string{"check-config"}, checkConfig: true},
		{name: "help", args: []string{"--help"}, showHelp: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			command, err := parseProcessCommand(test.args)

			require.NoError(t, err)
			require.Equal(t, test.role, command.role)
			require.Equal(t, test.checkConfig, command.checkConfig)
			require.Equal(t, test.rotateKey, command.rotateEncryptionKey)
			require.Equal(t, test.showHelp, command.showHelp)
		})
	}
}

func TestProcessCommandRejectsUnknownOrAmbiguousArguments(t *testing.T) {
	t.Parallel()

	for _, args := range [][]string{{"server"}, {"web", "worker"}} {
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
