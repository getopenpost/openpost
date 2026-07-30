package commands

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/auth"
	"github.com/openpost/cli/internal/config"
)

const diagnosticsLogTailLines = 100

func newInstanceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "instance",
		Short: "Manage OpenPost instance profiles",
	}
	cmd.AddCommand(newInstanceAddCmd())
	cmd.AddCommand(newInstanceListCmd())
	cmd.AddCommand(newInstanceUseCmd())
	cmd.AddCommand(newInstanceRemoveCmd())
	cmd.AddCommand(newInstanceHealthCmd())
	cmd.AddCommand(newInstanceDiagnosticsCmd())
	return cmd
}

func newInstanceAddCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "add <name> <url>",
		Short: "Add or update an instance profile",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			file, err := config.LoadConfig()
			if err != nil {
				return err
			}
			if file.Profiles == nil {
				file.Profiles = map[string]config.Profile{}
			}
			name := args[0]
			prof := file.Profiles[name]
			prof.Instance = normalizeInstanceURL(args[1])
			file.Profiles[name] = prof
			if file.CurrentProfile == "" {
				file.CurrentProfile = name
			}
			if err := config.Save(file); err != nil {
				return err
			}
			printerFrom(cfg).Printf("Saved instance profile %q.", name)
			return nil
		},
	}
}

func newInstanceListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List configured instances",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			file, err := config.LoadConfig()
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(file)
			}
			rows := make([][]string, 0, len(file.Profiles))
			for name, prof := range file.Profiles {
				current := ""
				if name == file.CurrentProfile {
					current = "*"
				}
				rows = append(rows, []string{current, name, emptyDash(prof.Instance)})
			}
			p.Table([]string{"CURRENT", "NAME", "URL"}, rows)
			return nil
		},
	}
}

func newInstanceUseCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "use <name>",
		Short: "Set the active instance profile",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			file, err := config.LoadConfig()
			if err != nil {
				return err
			}
			if _, ok := file.Profiles[args[0]]; !ok {
				return fmt.Errorf("profile %q not found", args[0])
			}
			file.CurrentProfile = args[0]
			if err := config.Save(file); err != nil {
				return err
			}
			printerFrom(cfg).Printf("Using profile %q.", args[0])
			return nil
		},
	}
}

func newInstanceRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "remove <name>",
		Short: "Remove an instance profile",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			file, err := config.LoadConfig()
			if err != nil {
				return err
			}
			if _, ok := file.Profiles[args[0]]; !ok {
				return fmt.Errorf("profile %q not found", args[0])
			}
			delete(file.Profiles, args[0])
			if file.CurrentProfile == args[0] {
				file.CurrentProfile = ""
			}
			if err := config.Save(file); err != nil {
				return err
			}
			printerFrom(cfg).Printf("Removed profile %q.", args[0])
			return nil
		},
	}
}

func newInstanceHealthCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "health",
		Short: "Check the active instance liveness and readiness",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			if cfg.Instance == "" {
				return fmt.Errorf("instance is required: run `openpost instance add <name> <url>` or pass --instance")
			}
			client := api.New(cfg.Instance, "")
			if err := client.Health(cmd.Context()); err != nil {
				return err
			}
			ready, err := client.Ready(cmd.Context())
			if err != nil {
				return err
			}

			p := printerFrom(cfg)
			out := map[string]string{
				"instance": cfg.Instance,
				"health":   "ok",
				"ready":    ready.Status,
				"database": ready.Database,
			}
			if cfg.AsJSON {
				return p.PrintJSON(out)
			}
			p.Table([]string{"INSTANCE", "HEALTH", "READY", "DATABASE"}, [][]string{{
				out["instance"],
				out["health"],
				out["ready"],
				out["database"],
			}})
			return nil
		},
	}
}

type instanceDiagnostics struct {
	CLIVersion       string             `json:"cli_version"`
	Platform         string             `json:"platform"`
	Profile          string             `json:"profile"`
	Instance         string             `json:"instance"`
	ConfigPath       string             `json:"config_path"`
	CredentialPath   string             `json:"credential_path"`
	Deployment       string             `json:"deployment_method,omitempty"`
	Provider         string             `json:"provider,omitempty"`
	Token            bool               `json:"token"`
	TokenSource      string             `json:"token_source,omitempty"`
	Health           string             `json:"health"`
	Ready            string             `json:"ready"`
	Database         string             `json:"database"`
	Authenticated    bool               `json:"authenticated"`
	UserEmail        string             `json:"user_email,omitempty"`
	Workspace        string             `json:"workspace,omitempty"`
	WorkspaceCount   int                `json:"workspace_count"`
	BillingWorkspace string             `json:"billing_workspace_id,omitempty"`
	BillingSummary   string             `json:"billing_summary,omitempty"`
	Billing          *api.BillingStatus `json:"billing,omitempty"`
	ProviderSummary  string             `json:"provider_summary,omitempty"`
	ProviderStatus   string             `json:"provider_status,omitempty"`
	ProviderCatalog  []api.ProviderInfo `json:"provider_catalog,omitempty"`
	LogFile          string             `json:"log_file,omitempty"`
	LogTailLineCap   int                `json:"log_tail_line_cap,omitempty"`
	RedactedLogTail  []string           `json:"redacted_log_tail,omitempty"`
	Errors           []string           `json:"errors,omitempty"`
}

type instanceDiagnosticsFlags struct {
	deployment string
	provider   string
	logsFile   string
}

func newInstanceDiagnosticsCmd() *cobra.Command {
	var flags instanceDiagnosticsFlags
	cmd := &cobra.Command{
		Use:   "diagnostics",
		Short: "Collect a safe support snapshot for an OpenPost instance",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			if cfg.Instance == "" {
				return fmt.Errorf("instance is required: run `openpost instance add <name> <url>` or pass --instance")
			}

			out := instanceDiagnostics{
				CLIVersion:     cmd.Root().Version,
				Platform:       config.Platform(),
				Profile:        cfg.ProfileName,
				Instance:       cfg.Instance,
				ConfigPath:     cfg.ConfigPath,
				CredentialPath: cfg.CredentialPath,
				Deployment:     strings.TrimSpace(flags.deployment),
				Provider:       strings.TrimSpace(flags.provider),
				Workspace:      cfg.Workspace,
				Health:         "unknown",
				Ready:          "unknown",
				Database:       "unknown",
			}

			publicClient := api.New(cfg.Instance, "")
			if err := publicClient.Health(cmd.Context()); err != nil {
				out.Health = "error"
				out.Errors = append(out.Errors, "health: "+err.Error())
			} else {
				out.Health = "ok"
			}
			ready, err := publicClient.Ready(cmd.Context())
			if err != nil {
				out.Ready = "error"
				out.Database = "unknown"
				out.Errors = append(out.Errors, "readiness: "+err.Error())
			} else {
				out.Ready = ready.Status
				out.Database = ready.Database
			}

			token, source, hasToken := diagnosticsToken(cfg)
			out.Token = hasToken
			out.TokenSource = source
			if token != "" {
				authClient := api.New(cfg.Instance, token)
				if me, err := authClient.Me(cmd.Context()); err != nil {
					out.Errors = append(out.Errors, "auth: "+err.Error())
				} else {
					out.Authenticated = true
					out.UserEmail = me.Email
				}
				if workspaces, err := authClient.ListWorkspaces(cmd.Context()); err != nil {
					out.Errors = append(out.Errors, "workspaces: "+err.Error())
				} else {
					out.WorkspaceCount = len(workspaces)
					if workspaceID, ok, err := diagnosticsWorkspaceID(cfg, workspaces); err != nil {
						out.Errors = append(out.Errors, "billing: "+err.Error())
					} else if ok {
						out.BillingWorkspace = workspaceID
						if billingStatus, err := authClient.BillingStatus(cmd.Context(), workspaceID); err != nil {
							out.Errors = append(out.Errors, "billing: "+err.Error())
						} else {
							out.Billing = billingStatus
							out.BillingSummary = summarizeBillingStatus(*billingStatus)
						}
					}
				}
				if providers, err := authClient.ListAccountProviders(cmd.Context()); err != nil {
					out.Errors = append(out.Errors, "provider catalog: "+err.Error())
				} else {
					out.ProviderCatalog = providers
					out.ProviderSummary = summarizeProviderCatalog(providers)
					if out.Provider != "" {
						out.ProviderStatus = providerStatusFor(providers, out.Provider)
					}
				}
			}

			if flags.logsFile != "" {
				out.LogFile = flags.logsFile
				out.LogTailLineCap = diagnosticsLogTailLines
				lines, err := tailRedactedLogFile(flags.logsFile, diagnosticsLogTailLines)
				if err != nil {
					out.Errors = append(out.Errors, "logs: "+err.Error())
				} else {
					out.RedactedLogTail = lines
				}
			}

			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(out)
			}
			p.Table([]string{"KEY", "VALUE"}, [][]string{
				{"CLI version", emptyDash(out.CLIVersion)},
				{"Platform", out.Platform},
				{"Profile", out.Profile},
				{"Instance", out.Instance},
				{"Config path", out.ConfigPath},
				{"Credential path", out.CredentialPath},
				{"Deployment", emptyDash(out.Deployment)},
				{"Provider being tested", emptyDash(out.Provider)},
				{"Token", yesNo(out.Token)},
				{"Token source", emptyDash(out.TokenSource)},
				{"Health", out.Health},
				{"Ready", out.Ready},
				{"Database", out.Database},
				{"Authenticated", yesNo(out.Authenticated)},
				{"User email", emptyDash(out.UserEmail)},
				{"Workspace", emptyDash(out.Workspace)},
				{"Workspace count", fmt.Sprintf("%d", out.WorkspaceCount)},
				{"Billing workspace", emptyDash(out.BillingWorkspace)},
				{"Billing", emptyDash(out.BillingSummary)},
				{"Provider catalog", emptyDash(out.ProviderSummary)},
				{"Provider status", emptyDash(out.ProviderStatus)},
				{"Log file", emptyDash(out.LogFile)},
				{"Redacted log lines", fmt.Sprintf("%d", len(out.RedactedLogTail))},
			})
			if len(out.RedactedLogTail) > 0 {
				p.Printf("")
				p.Printf("last %d redacted log lines:", len(out.RedactedLogTail))
				for _, line := range out.RedactedLogTail {
					p.Printf("%s", line)
				}
			}
			if len(out.Errors) > 0 {
				p.Printf("")
				for _, diagnosticErr := range out.Errors {
					p.Printf("error: %s", diagnosticErr)
				}
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&flags.deployment, "deployment", "", "deployment method being checked (docker, binary, nixos, cloud, other)")
	cmd.Flags().StringVar(&flags.provider, "provider", "", "social provider being tested, such as x, mastodon, youtube, or tiktok")
	cmd.Flags().StringVar(&flags.logsFile, "logs-file", "", "local OpenPost log file to include as a redacted last-100-line tail")
	return cmd
}

func diagnosticsWorkspaceID(cfg *config.Runtime, workspaces []api.Workspace) (string, bool, error) {
	selector := strings.TrimSpace(cfg.Workspace)
	if selector == "" {
		return "", false, nil
	}
	if selector == cfg.Profile.WorkspaceID || selector == cfg.Profile.WorkspaceName {
		if cfg.Profile.WorkspaceID != "" {
			return cfg.Profile.WorkspaceID, true, nil
		}
	}
	ws, err := findWorkspace(workspaces, selector)
	if err != nil {
		return "", true, err
	}
	return ws.ID, true, nil
}

func summarizeBillingStatus(status api.BillingStatus) string {
	parts := []string{}
	if status.PlanID != "" {
		parts = append(parts, status.PlanID)
	}
	if status.Status != "" {
		parts = append(parts, status.Status)
	}
	if len(parts) == 0 {
		parts = append(parts, "unknown")
	}
	if status.CancelAtPeriodEnd {
		parts = append(parts, "canceling")
	}
	usage := billingUsageRatios(status.Limits, status.Usage)
	if len(usage) > 0 {
		parts = append(parts, strings.Join(usage, ", "))
	}
	return strings.Join(parts, "; ")
}

func billingUsageRatios(limits, usage map[string]int64) []string {
	if len(limits) == 0 {
		return nil
	}
	keys := make([]string, 0, len(limits))
	for key := range limits {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%d/%d", key, usage[key], limits[key]))
	}
	return parts
}

func summarizeProviderCatalog(providers []api.ProviderInfo) string {
	if len(providers) == 0 {
		return ""
	}
	counts := map[string]int{}
	for _, provider := range providers {
		status := strings.TrimSpace(provider.Status)
		if status == "" {
			status = "unknown"
		}
		counts[status]++
	}
	parts := []string{}
	knownStatuses := map[string]bool{}
	for _, status := range []string{"available", "needs_configuration", "planned", "unknown"} {
		knownStatuses[status] = true
		if count := counts[status]; count > 0 {
			parts = append(parts, fmt.Sprintf("%s=%d", status, count))
		}
	}
	extraStatuses := []string{}
	for status, count := range counts {
		if knownStatuses[status] || count == 0 {
			continue
		}
		extraStatuses = append(extraStatuses, status)
	}
	sort.Strings(extraStatuses)
	for _, status := range extraStatuses {
		parts = append(parts, fmt.Sprintf("%s=%d", status, counts[status]))
	}
	return strings.Join(parts, " ")
}

func providerStatusFor(providers []api.ProviderInfo, requested string) string {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return ""
	}
	for _, provider := range providers {
		if !providerMatches(provider, requested) {
			continue
		}
		status := strings.TrimSpace(provider.Status)
		if status == "" {
			status = "unknown"
		}
		configured := "not configured"
		if provider.Configured {
			configured = "configured"
		}
		return fmt.Sprintf("%s: %s (%s)", providerDisplayName(provider), status, configured)
	}
	return fmt.Sprintf("%s: not found", requested)
}

func providerMatches(provider api.ProviderInfo, requested string) bool {
	needle := normalizedProviderLookup(requested)
	if needle == "" {
		return false
	}
	if needle == "twitter" && provider.Platform == "x" {
		return true
	}
	for _, value := range []string{provider.Platform, provider.DisplayName, provider.Name, provider.InstanceURL} {
		if normalizedProviderLookup(value) == needle {
			return true
		}
	}
	return false
}

func providerDisplayName(provider api.ProviderInfo) string {
	if provider.DisplayName != "" {
		return provider.DisplayName
	}
	if provider.Name != "" {
		return provider.Name
	}
	return provider.Platform
}

func normalizedProviderLookup(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(" ", "", "-", "", "_", "", "/", "", ":", "")
	value = replacer.Replace(value)
	if value == "twitter" {
		return "x"
	}
	return value
}

func diagnosticsToken(cfg *config.Runtime) (token string, source string, ok bool) {
	if cfg.Token != "" {
		return cfg.Token, "flag/env", true
	}
	source, ok = auth.HasToken(cfg)
	if !ok {
		return "", "", false
	}
	token, err := auth.NewStore(cfg).Get(cfg.ProfileName)
	if err != nil {
		return "", source, true
	}
	return token, source, true
}

func tailRedactedLogFile(path string, limit int) ([]string, error) {
	if limit <= 0 {
		limit = diagnosticsLogTailLines
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close() //nolint:errcheck

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	lines := make([]string, 0, limit)
	for scanner.Scan() {
		line := redactDiagnosticLogLine(scanner.Text())
		if len(lines) < limit {
			lines = append(lines, line)
			continue
		}
		copy(lines, lines[1:])
		lines[len(lines)-1] = line
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return lines, nil
}

var diagnosticRedactionPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(authorization:\s*bearer\s+)[^\s]+`),
	regexp.MustCompile(`(?i)("?(?:access_token|refresh_token|client_secret|jwt_secret|encryption_key)"?\s*[:=]\s*"?)[^"\s,]+`),
	regexp.MustCompile(`(?i)((?:token|secret|password|api[_-]?key|client[_-]?secret|jwt[_-]?secret|encryption[_-]?key)\s*=\s*)[^\s]+`),
	regexp.MustCompile(`(?i)(OPENPOST_[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*=)[^\s]+`),
}

func redactDiagnosticLogLine(line string) string {
	redacted := line
	for _, pattern := range diagnosticRedactionPatterns {
		redacted = pattern.ReplaceAllString(redacted, `${1}[redacted]`)
	}
	return redacted
}
