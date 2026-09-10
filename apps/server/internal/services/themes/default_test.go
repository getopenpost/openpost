package themes

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUnconfiguredOrganizationUsesDitherAndKeepsSavedChoices(t *testing.T) {
	service, _ := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}

	for _, scheme := range []ColorScheme{SchemeLight, SchemeDark} {
		resolved, err := service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: scheme})
		require.NoError(t, err)
		require.Equal(t, "dither", resolved.ID)
		require.Equal(t, scheme, resolved.Scheme)
		require.Equal(t, FallbackNone, resolved.FallbackReason)
	}
	settings, err := service.Settings(t.Context(), actor, "workspace-1")
	require.NoError(t, err)
	require.Equal(t, "dither", settings.OrganizationDefault.ID)

	_, err = service.SetOrganizationSettings(t.Context(), actor, OrganizationSettingsInput{
		OrganizationID: "org-1", DefaultReference: builtInReference(BuiltIns()["workshop"]),
	})
	require.NoError(t, err)
	resolved, err := service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, "workshop", resolved.ID, "an explicitly saved choice must take precedence over the app default")

	workspaceChoice := builtInReference(BuiltIns()["dither-moss"])
	_, err = service.AssignWorkspace(t.Context(), actor, WorkspaceAssignmentInput{WorkspaceID: "workspace-1", Reference: &workspaceChoice})
	require.NoError(t, err)
	resolved, err = service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeDark})
	require.NoError(t, err)
	require.Equal(t, "dither-moss", resolved.ID, "a Workspace override must still take precedence")
}
