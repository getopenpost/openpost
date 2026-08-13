package commands

import (
	"slices"
	"strconv"
	"strings"

	"github.com/openpost/cli/internal/api"
	"github.com/spf13/cobra"
)

func newProviderCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "provider",
		Short: "Inspect provider availability and publishing support",
	}
	cmd.AddCommand(newProviderListCmd())
	cmd.AddCommand(newProviderReadinessCmd())
	cmd.AddCommand(newProviderCapabilitiesCmd())
	return cmd
}

func newProviderListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List social providers available on the instance",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			providers, err := client.ListAccountProviders(cmd.Context())
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(providers)
			}
			if len(providers) == 0 {
				p.Printf("No social providers are available on this instance.")
				return nil
			}
			rows := make([][]string, 0, len(providers))
			for _, provider := range providers {
				rows = append(rows, []string{
					provider.Platform,
					emptyDash(provider.DisplayName),
					emptyDash(provider.AuthMode),
					yesNo(provider.Configured),
					emptyDash(provider.Status),
				})
			}
			p.Table([]string{"PROVIDER", "NAME", "AUTH", "CONFIGURED", "STATUS"}, rows)
			return nil
		},
	}
}

func newProviderReadinessCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "readiness",
		Short: "Inspect provider setup and blocking issues",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			workspaceID, err := activeWorkspaceID(cmd, client)
			if err != nil {
				return err
			}
			providers, err := client.GetProviderReadiness(cmd.Context(), workspaceID)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(providers)
			}
			rows := make([][]string, 0, len(providers))
			for _, provider := range providers {
				rows = append(rows, []string{
					provider.Provider,
					provider.State,
					provider.ConfiguredAppState,
					strconv.Itoa(provider.ConnectedAccounts),
					emptyDash(strings.Join(provider.BlockingIssues, ", ")),
					emptyDash(strings.Join(providerReadinessActions(provider), "; ")),
				})
			}
			p.Table([]string{"PROVIDER", "STATE", "APP", "ACCOUNTS", "BLOCKERS", "NEXT ACTION"}, rows)
			return nil
		},
	}
}

func providerReadinessActions(provider api.ProviderReadiness) []string {
	actions := make([]string, 0, 2)
	if provider.ConfiguredAppState == "missing" || slices.Contains(provider.BlockingIssues, "missing_configuration") {
		actions = append(actions, "Configure provider credentials for "+provider.Provider)
	}
	if slices.Contains(provider.BlockingIssues, "reconnect_required") ||
		slices.Contains(provider.BlockingIssues, "authorization_expired") ||
		slices.Contains(provider.BlockingIssues, "missing_scope") {
		actions = append(actions, "Reconnect the affected "+provider.Provider+" account")
	}
	if slices.Contains(provider.BlockingIssues, "disabled") {
		actions = append(actions, "Ask an instance administrator to re-enable "+provider.Provider)
	}
	if slices.Contains(provider.BlockingIssues, "readiness_evidence_unavailable") {
		actions = append(actions, "Retry after readiness evidence is available")
	}
	return actions
}

func newProviderCapabilitiesCmd() *cobra.Command {
	var (
		providerFilter string
		profileFilter  string
	)
	cmd := &cobra.Command{
		Use:   "capabilities",
		Short: "List provider publishing capabilities",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			catalog, err := client.ListCapabilities(cmd.Context())
			if err != nil {
				return err
			}
			filtered := catalog.Capabilities[:0]
			for _, capability := range catalog.Capabilities {
				if providerFilter != "" && capability.Provider != providerFilter {
					continue
				}
				if profileFilter != "" && capability.Profile != profileFilter && capability.OutputProfile != profileFilter {
					continue
				}
				filtered = append(filtered, capability)
			}
			catalog.Capabilities = filtered

			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(catalog)
			}
			if len(catalog.Capabilities) == 0 {
				p.Printf("No publishing capabilities match the selected filters.")
				return nil
			}
			rows := make([][]string, 0, len(catalog.Capabilities))
			for _, capability := range catalog.Capabilities {
				rows = append(rows, []string{
					capability.Provider,
					capability.Profile,
					capability.OutputProfile,
					strings.Join(capability.Intents, ","),
					strings.Join(capability.MediaShapes, ","),
					formatOptionalInt(capability.TextLimit),
					strconv.Itoa(capability.Media.MaxCount),
					strconv.Itoa(len(capability.Settings)),
				})
			}
			p.Table([]string{"PROVIDER", "PROFILE", "OUTPUT", "INTENTS", "MEDIA", "TEXT LIMIT", "MAX MEDIA", "SETTINGS"}, rows)
			return nil
		},
	}
	cmd.Flags().StringVar(&providerFilter, "provider", "", "filter by provider key")
	cmd.Flags().StringVar(&profileFilter, "content-profile", "", "filter by input or output content profile")
	return cmd
}

func formatOptionalInt(value int) string {
	if value == 0 {
		return "-"
	}
	return strconv.Itoa(value)
}
