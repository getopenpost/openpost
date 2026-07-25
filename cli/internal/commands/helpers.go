package commands

import (
	"context"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/auth"
	"github.com/openpost/cli/internal/config"
	"github.com/openpost/cli/internal/output"
)

func runtimeFrom(cmd *cobra.Command) (*config.Runtime, error) {
	cfg := config.FromCommand(cmd)
	if cfg == nil {
		return nil, fmt.Errorf("runtime config was not loaded")
	}
	return cfg, nil
}

func printerFrom(cfg *config.Runtime) *output.Printer {
	return output.New(cfg.AsJSON, cfg.Quiet)
}

func clientFrom(cfg *config.Runtime) (*api.Client, error) {
	if cfg.Instance == "" {
		return nil, fmt.Errorf("instance is required: run `openpost instance add <name> <url>` or pass --instance")
	}
	token := cfg.Token
	if token == "" {
		stored, err := auth.NewStore(cfg).Get(cfg.ProfileName)
		if err != nil {
			return nil, api.ErrAuthRequired
		}
		token = stored
	}
	c := api.New(cfg.Instance, token)
	return c, c.CheckToken()
}

func updateProfile(profileName string, mutate func(*config.Profile)) error {
	file, err := config.LoadConfig()
	if err != nil {
		return err
	}
	if file.Profiles == nil {
		file.Profiles = map[string]config.Profile{}
	}
	prof := file.Profiles[profileName]
	mutate(&prof)
	file.Profiles[profileName] = prof
	if file.CurrentProfile == "" {
		file.CurrentProfile = profileName
	}
	return config.Save(file)
}

func yesNo(ok bool) string {
	if ok {
		return "yes"
	}
	return "no"
}

func normalizeInstanceURL(raw string) string {
	return strings.TrimRight(strings.TrimSpace(raw), "/")
}

func emptyDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}

func activeWorkspaceID(cmd *cobra.Command, client *api.Client) (string, error) {
	cfg, err := runtimeFrom(cmd)
	if err != nil {
		return "", err
	}
	if cfg.Workspace == "" {
		return "", fmt.Errorf("workspace is required: run `openpost workspace use <name-or-id>` or pass --workspace")
	}
	if cfg.Workspace == cfg.Profile.WorkspaceID || cfg.Workspace == cfg.Profile.WorkspaceName {
		if cfg.Profile.WorkspaceID != "" {
			return cfg.Profile.WorkspaceID, nil
		}
	}
	return resolveWorkspaceID(cmd.Context(), client, cfg.Workspace)
}

func confirmMutation(cfg *config.Runtime, prompt string) (bool, error) {
	if cfg.Yes {
		return true, nil
	}
	if cfg.AsJSON {
		return false, fmt.Errorf("--yes is required for this action when using --json")
	}
	return confirm(prompt)
}

func newConfirmedDeleteCmd(
	use string,
	short string,
	noun string,
	deleteItem func(context.Context, *api.Client, string) error,
) *cobra.Command {
	return &cobra.Command{
		Use:   use,
		Short: short,
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			ok, err := confirmMutation(cfg, fmt.Sprintf("Delete %s %s?", noun, args[0]))
			if err != nil {
				return err
			}
			if !ok {
				printerFrom(cfg).Printf("Canceled.")
				return nil
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			if err := deleteItem(cmd.Context(), client, args[0]); err != nil {
				return err
			}
			if cfg.AsJSON {
				return printerFrom(cfg).PrintJSON(map[string]string{"id": args[0], "status": "deleted"})
			}
			printerFrom(cfg).Printf("Deleted %s %s.", noun, args[0])
			return nil
		},
	}
}

func resolveWorkspaceID(ctx context.Context, client *api.Client, selector string) (string, error) {
	workspaces, err := client.ListWorkspaces(ctx)
	if err != nil {
		return "", err
	}
	ws, err := findWorkspace(workspaces, selector)
	if err != nil {
		return "", err
	}
	return ws.ID, nil
}
