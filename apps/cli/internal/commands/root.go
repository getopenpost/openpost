// Package commands wires the Cobra command tree for the OpenPost CLI.
//
// The tree is intentionally flat-and-shallow for the first cut:
// root
// ├── auth    (login, status, logout, token list/revoke)
// ├── instance (add, list, use, remove, health, diagnostics)
// ├── workspace (list, use, create)
// ├── account (list, rename, disconnect)
// ├── provider (list, readiness, capabilities)
// ├── media   (upload, list, update, usage, storage, delete)
// ├── schedule (list, create, update, delete, suggest, next)
// ├── post    (text-and-thread create, list, view, update, delete)
// ├── publication (format-first create, list, view, validate, publish-now)
// ├── thread  (create)
// ├── jobs    (list)
// ├── billing (status, checkout, portal)
// └── completion
//
// Each subcommand file owns its own RunE and flags. Global flags
// (--profile, --instance, --workspace, --json, --quiet, --yes,
// --no-color, --token) live on the root and are propagated through
// the loaded config rather than re-passed to every subcommand.
package commands

import (
	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/config"
)

// NewRoot returns the top-level *cobra.Command with global flags and
// all subcommands wired. version is shown in `openpost version` and
// in --help.
func NewRoot(version string) *cobra.Command {
	api.SetVersion(version)

	var (
		profileName string
		instance    string
		workspace   string
		token       string
		asJSON      bool
		quiet       bool
		yes         bool
		noColor     bool
	)

	root := &cobra.Command{
		Use:           "openpost",
		Short:         "OpenPost CLI — control an OpenPost workspace from the terminal",
		Long:          "openpost is a command-line client for the OpenPost social media scheduler.\n\nIt talks to a running OpenPost instance over HTTPS, authenticates with a revocable API token, and exposes the most common posting, scheduling, account, and media workflows for use from scripts, CI, and power-user shells.",
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       version,
		PersistentPreRunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := config.Load(config.FlagOverrides{
				Profile:   profileName,
				Instance:  instance,
				Workspace: workspace,
				Token:     token,
				AsJSON:    asJSON,
				Quiet:     quiet,
				Yes:       yes,
				NoColor:   noColor,
			})
			if err != nil {
				return err
			}
			// Stash on the command so subcommands can pull it out
			// via config.FromContext.
			config.AttachTo(cmd, cfg)
			return nil
		},
	}
	root.SetVersionTemplate("openpost {{.Version}}\n")

	pf := root.PersistentFlags()
	pf.StringVar(&profileName, "profile", "", "profile name from config (default: $OPENPOST_PROFILE or 'default')")
	pf.StringVar(&instance, "instance", "", "OpenPost instance URL (default: profile or $OPENPOST_INSTANCE)")
	pf.StringVar(&workspace, "workspace", "", "workspace name or ID (default: profile or $OPENPOST_WORKSPACE)")
	pf.StringVar(&token, "token", "", "API token override (default: keyring or $OPENPOST_TOKEN)")
	pf.BoolVar(&asJSON, "json", false, "emit machine-readable JSON instead of tables/prose")
	pf.BoolVar(&quiet, "quiet", false, "suppress non-error output")
	pf.BoolVar(&yes, "yes", false, "skip interactive confirmations")
	pf.BoolVar(&noColor, "no-color", false, "disable ANSI colors")

	root.AddCommand(newAuthCmd())
	root.AddCommand(newInstanceCmd())
	root.AddCommand(newWorkspaceCmd())
	root.AddCommand(newAccountCmd())
	root.AddCommand(newProviderCmd())
	root.AddCommand(newMediaCmd())
	root.AddCommand(newScheduleCmd())
	root.AddCommand(newPostCmd())
	root.AddCommand(newPublicationCmd())
	root.AddCommand(newThreadCmd())
	root.AddCommand(newJobsCmd())
	root.AddCommand(newBillingCmd())
	root.AddCommand(newCompletionCmd())
	root.AddCommand(newVersionCmd(version))

	return root
}
