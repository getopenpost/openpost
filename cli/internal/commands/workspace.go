package commands

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/config"
)

func newWorkspaceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "workspace",
		Short: "Manage the active OpenPost workspace",
	}
	cmd.AddCommand(newWorkspaceListCmd())
	cmd.AddCommand(newWorkspaceUseCmd())
	cmd.AddCommand(newWorkspaceCreateCmd())
	return cmd
}

func newWorkspaceListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List workspaces",
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
			workspaces, err := client.ListWorkspaces(cmd.Context())
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(workspaces)
			}
			rows := make([][]string, 0, len(workspaces))
			for _, ws := range workspaces {
				current := ""
				if ws.ID == cfg.Profile.WorkspaceID || ws.Name == cfg.Profile.WorkspaceName || ws.ID == cfg.Workspace || ws.Name == cfg.Workspace {
					current = "*"
				}
				rows = append(rows, []string{current, ws.ID, ws.Name, ws.CreatedAt.Format("2006-01-02 15:04:05")})
			}
			p.Table([]string{"CURRENT", "ID", "NAME", "CREATED"}, rows)
			return nil
		},
	}
}

func newWorkspaceUseCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "use <name-or-id>",
		Short: "Set the active workspace for the current profile",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			workspaces, err := client.ListWorkspaces(cmd.Context())
			if err != nil {
				return err
			}
			ws, err := findWorkspace(workspaces, args[0])
			if err != nil {
				return err
			}
			if err := updateProfile(cfg.ProfileName, func(prof *config.Profile) {
				prof.WorkspaceID = ws.ID
				prof.WorkspaceName = ws.Name
			}); err != nil {
				return err
			}
			printerFrom(cfg).Printf("Using workspace %q.", ws.Name)
			return nil
		},
	}
}

func newWorkspaceCreateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "create <name>",
		Short: "Create a workspace",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			ws, err := client.CreateWorkspace(cmd.Context(), api.CreateWorkspaceInput{Name: args[0]})
			if err != nil {
				return err
			}
			if err := updateProfile(cfg.ProfileName, func(prof *config.Profile) {
				prof.WorkspaceID = ws.ID
				prof.WorkspaceName = ws.Name
			}); err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(ws)
			}
			p.Printf("Created workspace %q.", ws.Name)
			return nil
		},
	}
}

func findWorkspace(workspaces []api.Workspace, selector string) (*api.Workspace, error) {
	for i := range workspaces {
		if workspaces[i].ID == selector || workspaces[i].Name == selector {
			return &workspaces[i], nil
		}
	}
	return nil, fmt.Errorf("workspace %q not found", selector)
}
