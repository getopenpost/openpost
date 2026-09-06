package commands

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/auth"
	"github.com/openpost/cli/internal/config"
)

func newAuthCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Authenticate with an OpenPost instance",
	}
	cmd.AddCommand(newAuthLoginCmd())
	cmd.AddCommand(newAuthStatusCmd())
	cmd.AddCommand(newAuthLogoutCmd())
	cmd.AddCommand(newAuthTokenCmd())
	return cmd
}

func newAuthLoginCmd() *cobra.Command {
	var device bool
	var withToken bool
	var noBrowser bool
	var insecureStorage bool

	cmd := &cobra.Command{
		Use:   "login <instance>",
		Short: "Log in to an OpenPost instance",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			instance := normalizeInstanceURL(args[0])
			if instance == "" {
				return fmt.Errorf("instance URL is required")
			}

			var token string
			var expiresAt time.Time
			if withToken {
				token, err = readTokenFromStdin()
				if err != nil {
					return err
				}
			} else {
				token, expiresAt, err = runDeviceLogin(cmd.Context(), instance, device || noBrowser, !noBrowser && !device, p)
				if err != nil {
					return err
				}
			}

			store := auth.NewStore(cfg)
			if insecureStorage {
				store = auth.NewInsecureStore(cfg.CredentialPath)
			}
			if err := store.Set(cfg.ProfileName, token); err != nil {
				return fmt.Errorf("store token: %w", err)
			}
			if err := updateProfile(cfg.ProfileName, func(prof *config.Profile) {
				prof.Instance = instance
			}); err != nil {
				return err
			}
			if cfg.AsJSON {
				return p.PrintJSON(map[string]any{
					"profile":    cfg.ProfileName,
					"instance":   instance,
					"expires_at": expiresAt,
				})
			}
			p.Printf("Logged in to %s as profile %q.", instance, cfg.ProfileName)
			return nil
		},
	}
	cmd.Flags().BoolVar(&device, "device", false, "print the device code and poll without opening a browser")
	cmd.Flags().BoolVar(&withToken, "with-token", false, "read a raw API token from stdin")
	cmd.Flags().BoolVar(&noBrowser, "no-browser", false, "skip automatically opening the browser")
	cmd.Flags().BoolVar(&insecureStorage, "insecure-storage", false, "store the token in credentials.json instead of the OS keyring")
	return cmd
}

func newAuthStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show authentication status for the active profile",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			storeName, hasToken := auth.HasToken(cfg)
			if cfg.Token != "" {
				storeName = "flag/env"
				hasToken = true
			}
			status := map[string]any{
				"profile":    cfg.ProfileName,
				"instance":   cfg.Instance,
				"token":      hasToken,
				"store":      storeName,
				"last_used":  nil,
				"expires_at": nil,
			}
			if cfg.AsJSON {
				return p.PrintJSON(status)
			}
			p.Table([]string{"PROFILE", "INSTANCE", "TOKEN", "STORE", "LAST USED", "EXPIRES"}, [][]string{{
				cfg.ProfileName,
				emptyDash(cfg.Instance),
				yesNo(hasToken),
				emptyDash(storeName),
				"-",
				"-",
			}})
			return nil
		},
	}
}

func newAuthLogoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Delete the stored token for the active profile",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			if err := auth.NewKeyringStore().Delete(cfg.ProfileName); err != nil {
				return err
			}
			if err := auth.NewInsecureStore(cfg.CredentialPath).Delete(cfg.ProfileName); err != nil {
				return err
			}
			printerFrom(cfg).Printf("Logged out profile %q.", cfg.ProfileName)
			return nil
		},
	}
}

func newAuthTokenCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "token",
		Short: "Manage API tokens",
	}
	cmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List API tokens",
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
			tokens, err := client.ListAPITokens(cmd.Context())
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(tokens)
			}
			rows := make([][]string, 0, len(tokens))
			for _, tok := range tokens {
				rows = append(rows, []string{
					tok.ID,
					tok.Name,
					tok.TokenPrefix,
					tok.Scope,
					timePtr(tok.LastUsedAt),
					timePtr(tok.ExpiresAt),
					timePtr(tok.RevokedAt),
				})
			}
			p.Table([]string{"ID", "NAME", "PREFIX", "SCOPE", "LAST USED", "EXPIRES", "REVOKED"}, rows)
			return nil
		},
	})
	cmd.AddCommand(&cobra.Command{
		Use:   "revoke <id>",
		Short: "Revoke an API token",
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
			if err := client.RevokeAPIToken(cmd.Context(), args[0]); err != nil {
				return err
			}
			printerFrom(cfg).Printf("Revoked token %s.", args[0])
			return nil
		},
	})
	return cmd
}

func readTokenFromStdin() (string, error) {
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return "", err
		}
		return "", fmt.Errorf("no token provided on stdin")
	}
	token := strings.TrimSpace(scanner.Text())
	if token == "" {
		return "", fmt.Errorf("no token provided on stdin")
	}
	return token, nil
}

func runDeviceLogin(ctx context.Context, instance string, printOnly, open bool, p interface{ Printf(string, ...any) }) (string, time.Time, error) {
	client := api.New(instance, "")
	start, err := client.StartCLIAuth(ctx, api.CLIAuthStartInput{
		ClientName:      "openpost CLI",
		ClientVersion:   api.Version(),
		ClientOS:        config.Platform(),
		RequestedScopes: "cli:full",
	})
	if err != nil {
		return "", time.Time{}, err
	}
	p.Printf("Open %s and enter code %s.", start.VerificationURL, start.UserCode)
	if open && !printOnly {
		_ = openURL(ctx, start.VerificationURL)
	}
	interval := time.Duration(start.Interval) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	deadline := time.Now().Add(time.Duration(start.ExpiresIn) * time.Second)
	for {
		if !deadline.IsZero() && time.Now().After(deadline) {
			return "", time.Time{}, fmt.Errorf("device authorization expired")
		}
		select {
		case <-ctx.Done():
			return "", time.Time{}, ctx.Err()
		case <-time.After(interval):
		}
		poll, err := client.PollCLIAuth(ctx, start.DeviceCode)
		if err != nil {
			return "", time.Time{}, err
		}
		switch poll.Status {
		case "approved":
			if poll.Token == "" {
				return "", time.Time{}, fmt.Errorf("server approved login without returning a token")
			}
			return poll.Token, poll.ExpiresAt, nil
		case "authorization_pending":
			continue
		case "access_denied":
			return "", time.Time{}, fmt.Errorf("device authorization denied")
		case "expired_token":
			return "", time.Time{}, fmt.Errorf("device authorization expired")
		default:
			return "", time.Time{}, fmt.Errorf("unexpected device authorization status %q", poll.Status)
		}
	}
}

func openURL(ctx context.Context, url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.CommandContext(ctx, "open", url)
	case "windows":
		cmd = exec.CommandContext(ctx, "rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.CommandContext(ctx, "xdg-open", url)
	}
	return cmd.Start()
}

func timePtr(t *time.Time) string {
	if t == nil || t.IsZero() {
		return "-"
	}
	return t.UTC().Format(time.RFC3339)
}
