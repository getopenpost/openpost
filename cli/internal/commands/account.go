package commands

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/accountpicker"
	"github.com/openpost/cli/internal/api"
)

func newAccountCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "account",
		Short: "Manage connected social accounts",
		Long: "List, rename, and disconnect social accounts. Account slugs are the\n" +
			"preferred selector for --accounts. New accounts are connected in the\n" +
			"OpenPost web UI at <instance>/accounts.",
	}
	cmd.AddCommand(newAccountListCmd())
	cmd.AddCommand(newAccountRenameCmd())
	cmd.AddCommand(newAccountDisconnectCmd())
	return cmd
}

func newAccountListCmd() *cobra.Command {
	var platform string

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List connected social accounts",
		Long: "List connected social accounts for the active workspace.\n\n" +
			"Use the SLUG column as the preferred selector for --accounts and account rename.",
		Args: cobra.NoArgs,
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
			accounts, err := client.ListAccounts(cmd.Context(), workspaceID)
			if err != nil {
				return err
			}
			if platform != "" {
				accounts = filterAccountsByPlatform(accounts, platform)
			}

			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(accounts)
			}
			if len(accounts) == 0 {
				p.Printf("%s", emptyAccountsMessage(platform, cfg.Instance))
				return nil
			}
			rows := make([][]string, 0, len(accounts))
			for _, acc := range accounts {
				rows = append(rows, []string{
					acc.ID,
					emptyDash(acc.Slug),
					acc.Platform,
					emptyDash(acc.AccountUsername),
					emptyDash(acc.InstanceURL),
					yesNo(acc.IsActive),
				})
			}
			p.Table([]string{"ID", "SLUG", "PLATFORM", "USERNAME", "INSTANCE", "ACTIVE"}, rows)
			return nil
		},
	}
	cmd.Flags().StringVar(&platform, "platform", "", "filter by platform")
	return cmd
}

func newAccountRenameCmd() *cobra.Command {
	var slug string

	cmd := &cobra.Command{
		Use:   "rename <selector> --slug <new-slug>",
		Short: "Rename a social account slug",
		Long: "Rename a connected account's slug. The selector can be an account id,\n" +
			"slug, platform:username value, bare platform when unambiguous, or mastodon host.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(slug) == "" {
				return fmt.Errorf("--slug is required")
			}
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
			accounts, err := client.ListAccounts(cmd.Context(), workspaceID)
			if err != nil {
				return err
			}
			accountIDs, err := accountpicker.Resolve(workspaceID, []string{args[0]}, accounts)
			if err != nil {
				return err
			}
			account, err := client.UpdateAccount(cmd.Context(), accountIDs[0], api.UpdateAccountInput{Slug: slug})
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(account)
			}
			p.Printf("Renamed account %s to slug %s.", account.ID, account.Slug)
			return nil
		},
	}
	cmd.Flags().StringVar(&slug, "slug", "", "new account slug")
	_ = cmd.MarkFlagRequired("slug")
	return cmd
}

func newAccountDisconnectCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "disconnect <account-id>",
		Short: "Disconnect a social account",
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
			accountID := args[0]
			if !cfg.Yes && !cfg.AsJSON {
				ok, err := confirm(fmt.Sprintf("Disconnect account %s?", accountID))
				if err != nil {
					return err
				}
				if !ok {
					printerFrom(cfg).Printf("Canceled.")
					return nil
				}
			}
			if err := client.DisconnectAccount(cmd.Context(), accountID); err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(map[string]string{"id": accountID, "status": "disconnected"})
			}
			p.Printf("Disconnected account %s.", accountID)
			return nil
		},
	}
}

// filterAccountsByPlatform returns the accounts whose Platform field
// matches the given platform. The input slice is reused as the
// backing array; the call site in account list does not need the
// original slice afterwards, so the in-place filter is safe.
func filterAccountsByPlatform(accounts []api.SocialAccount, platform string) []api.SocialAccount {
	out := accounts[:0]
	for _, acc := range accounts {
		if acc.Platform == platform {
			out = append(out, acc)
		}
	}
	return out
}

// accountsWebURL resolves <instance>/accounts. Returns "" when the
// instance is empty or unparseable so the caller can fall back to a
// generic message.
func accountsWebURL(instance string) string {
	base := strings.TrimRight(strings.TrimSpace(instance), "/")
	if base == "" {
		return ""
	}
	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/accounts"
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

// emptyAccountsMessage is shown by `account list` when the workspace
// has no matching accounts. It points the user at the web UI so the
// absence of `account connect` in the CLI is discoverable.
func emptyAccountsMessage(platform, instance string) string {
	u := accountsWebURL(instance)
	switch {
	case platform != "" && u != "":
		return fmt.Sprintf("No %s accounts are connected for this workspace. Connect one in the web UI: %s", platform, u)
	case platform != "":
		return fmt.Sprintf("No %s accounts are connected for this workspace. Connect one in the web UI.", platform)
	case u != "":
		return fmt.Sprintf("No accounts are connected for this workspace. Connect one in the web UI: %s", u)
	default:
		return "No accounts are connected for this workspace. Connect one in the web UI."
	}
}

func confirm(prompt string) (bool, error) {
	fmt.Fprintf(os.Stderr, "%s [y/N] ", prompt)
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return false, err
	}
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true, nil
	default:
		return false, nil
	}
}
