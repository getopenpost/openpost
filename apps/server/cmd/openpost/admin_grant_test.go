package main

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/config"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
)

func TestGrantInstanceAdminPromotesExistingAccount(t *testing.T) {
	ctx := context.Background()
	db, err := testdb.OpenWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))

	_, err = grantInstanceAdmin(ctx, db, "   ")
	require.ErrorContains(t, err, "requires --email")

	insertUser := func(t *testing.T, email string, isAdmin bool) {
		t.Helper()
		user := models.User{
			ID:       "user-" + email,
			Email:    email,
			Username: email,
			IsAdmin:  isAdmin,
		}
		_, err := db.NewInsert().Model(&user).Exec(ctx)
		require.NoError(t, err)
	}
	insertUser(t, "founder@example.test", false)
	insertUser(t, "teammate@example.test", false)

	result, err := grantInstanceAdmin(ctx, db, " Founder@example.test ")
	require.NoError(t, err)
	require.False(t, result.AlreadyAdmin)
	require.Equal(t, 1, result.AdminCount)

	var promoted models.User
	require.NoError(t, db.NewSelect().Model(&promoted).Where("email = ?", "founder@example.test").Scan(ctx))
	require.True(t, promoted.IsAdmin)

	repeat, err := grantInstanceAdmin(ctx, db, "founder@example.test")
	require.NoError(t, err)
	require.True(t, repeat.AlreadyAdmin)
	require.Equal(t, 1, repeat.AdminCount)

	_, err = grantInstanceAdmin(ctx, db, "missing@example.test")
	require.ErrorContains(t, err, "no account found")
}

type recordingMCPToolModeSetter struct {
	mode string
}

func (s *recordingMCPToolModeSetter) SetToolMode(mode string) {
	s.mode = mode
}

func TestConfigureMCPToolModeUsesLoadedServerConfig(t *testing.T) {
	t.Parallel()

	for _, mode := range []string{config.MCPModeDirect, config.MCPModeSearch, config.MCPModeBoth} {
		mode := mode
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			setter := &recordingMCPToolModeSetter{}

			configureMCPToolMode(setter, &config.Config{MCPMode: mode})

			require.Equal(t, mode, setter.mode)
		})
	}
}

func TestRequestConsumerClass(t *testing.T) {
	tests := []struct {
		name       string
		route      string
		userAgent  string
		clientHint string
		want       string
	}{
		{name: "native", clientHint: "native", userAgent: "Mozilla/5.0", want: "native"},
		{name: "untrusted hint", clientHint: "private-string", want: "api"},
		{name: "cli", userAgent: "openpost-cli/v4.5.6", want: "cli"},
		{name: "mcp proxy", userAgent: "openpost-mcp/v1.2.3", want: "mcp"},
		{name: "mcp route", route: "/api/v1/mcp", userAgent: "unknown", want: "mcp"},
		{name: "mcp media", userAgent: "openpost-mcp-media/v3.6.0", want: "mcp-media"},
		{name: "n8n", userAgent: "n8n-nodes-openpost/0.1.0", want: "n8n"},
		{name: "browser", userAgent: "Mozilla/5.0", want: "web"},
		{name: "other API client", userAgent: "curl/8.0", want: "api"},
		{name: "empty", want: "api"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, requestConsumerClass(tt.route, tt.userAgent, tt.clientHint))
		})
	}
}

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
