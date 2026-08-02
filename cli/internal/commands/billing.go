package commands

import (
	"strings"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/config"
)

func newBillingCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "billing",
		Short: "Manage billing for the managed app",
		Long:  "Inspect billing status and create hosted checkout or customer portal URLs for the active workspace.",
	}
	cmd.AddCommand(newBillingStatusCmd())
	cmd.AddCommand(newBillingCheckoutCmd())
	cmd.AddCommand(newBillingPortalCmd())
	return cmd
}

func newBillingStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show billing plan and usage for the active workspace",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, client, workspaceID, err := billingRuntime(cmd)
			if err != nil {
				return err
			}
			status, err := client.BillingStatus(cmd.Context(), workspaceID)
			if err != nil {
				return err
			}
			return printBillingStatus(cfg, status)
		},
	}
}

func newBillingCheckoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "checkout <plan>",
		Short: "Create a Polar checkout URL for the active workspace",
		Long:  "Create a hosted checkout URL for the active workspace. Plan IDs are validated by the server: starter, creator, pro, team, or agency.",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, client, workspaceID, err := billingRuntime(cmd)
			if err != nil {
				return err
			}
			session, err := client.CreateBillingCheckout(cmd.Context(), workspaceID, args[0])
			if err != nil {
				return err
			}
			return printBillingURL(cfg, session)
		},
	}
}

func newBillingPortalCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "portal",
		Short: "Create a Polar customer portal URL for the active workspace",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, client, workspaceID, err := billingRuntime(cmd)
			if err != nil {
				return err
			}
			session, err := client.CreateBillingPortal(cmd.Context(), workspaceID)
			if err != nil {
				return err
			}
			return printBillingURL(cfg, session)
		},
	}
}

func billingRuntime(cmd *cobra.Command) (*config.Runtime, *api.Client, string, error) {
	cfg, err := runtimeFrom(cmd)
	if err != nil {
		return nil, nil, "", err
	}
	client, err := clientFrom(cfg)
	if err != nil {
		return nil, nil, "", err
	}
	workspaceID, err := activeWorkspaceID(cmd, client)
	if err != nil {
		return nil, nil, "", err
	}
	return cfg, client, workspaceID, nil
}

func printBillingStatus(cfg *config.Runtime, status *api.BillingStatus) error {
	p := printerFrom(cfg)
	if cfg.AsJSON {
		return p.PrintJSON(status)
	}
	p.Table([]string{"KEY", "VALUE"}, [][]string{
		{"Workspace", emptyDash(status.WorkspaceID)},
		{"Provider", emptyDash(status.Provider)},
		{"Status", emptyDash(status.Status)},
		{"Plan", emptyDash(status.PlanID)},
		{"Period start", emptyDash(status.PeriodStart)},
		{"Current period end", emptyDash(status.CurrentPeriodEnd)},
		{"Canceling", yesNo(status.CancelAtPeriodEnd)},
		{"Usage", emptyDash(strings.Join(billingUsageRatios(status.Limits, status.Usage), ", "))},
	})
	return nil
}

func printBillingURL(cfg *config.Runtime, session *api.BillingURL) error {
	p := printerFrom(cfg)
	if cfg.AsJSON {
		return p.PrintJSON(session)
	}
	p.Table([]string{"FIELD", "VALUE"}, [][]string{
		{"ID", emptyDash(session.ID)},
		{"URL", session.URL},
	})
	return nil
}
