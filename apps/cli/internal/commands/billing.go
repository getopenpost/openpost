package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/config"
)

func newBillingCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "billing",
		Short: "Manage Hosted service billing",
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
	var billingPeriod string
	cmd := &cobra.Command{
		Use:   "checkout <plan>",
		Short: "Create an OpenPost checkout URL for the active workspace",
		Long:  "Create an OpenPost checkout URL that opens Paddle's embedded payment form. Plan IDs are starter, founder, pro, team, or agency.",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, client, workspaceID, err := billingRuntime(cmd)
			if err != nil {
				return err
			}
			period := strings.ToLower(strings.TrimSpace(billingPeriod))
			if period != "monthly" && period != "annual" {
				return fmt.Errorf("--billing-period must be monthly or annual")
			}
			session, err := client.CreateBillingCheckout(cmd.Context(), workspaceID, args[0], period)
			if err != nil {
				return err
			}
			return printBillingURL(cfg, session)
		},
	}
	cmd.Flags().StringVar(&billingPeriod, "billing-period", "monthly", "Billing period: monthly or annual")
	return cmd
}

func newBillingPortalCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "portal",
		Short: "Open Paddle billing management for the active workspace",
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
		{"Plan", emptyDash(session.PlanID)},
		{"Billing period", emptyDash(session.BillingPeriod)},
		{"Trial ends", emptyDash(session.TrialEndsAt)},
	})
	return nil
}
