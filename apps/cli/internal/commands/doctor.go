package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/config"
)

type doctorReport struct {
	CLIVersion          string   `json:"cli_version"`
	Platform            string   `json:"platform"`
	Profile             string   `json:"profile"`
	Instance            string   `json:"instance"`
	InstanceConfigured  bool     `json:"instance_configured"`
	TokenConfigured     bool     `json:"token_configured"`
	TokenSource         string   `json:"token_source"`
	Workspace           string   `json:"workspace"`
	WorkspaceConfigured bool     `json:"workspace_configured"`
	ConfigPath          string   `json:"config_path"`
	CredentialPath      string   `json:"credential_path"`
	Ready               bool     `json:"ready"`
	Issues              []string `json:"issues"`
}

// newDoctorCmd reports local CLI configuration without contacting any
// instance. It never prints token material: only presence and source.
func newDoctorCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "doctor",
		Short: "Check local CLI configuration without contacting an instance",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			report := checkDoctorConfig(cmd.Root().Version, cfg)
			p := printerFrom(cfg)
			if cfg.AsJSON {
				if err := p.PrintJSON(report); err != nil {
					return err
				}
			} else {
				p.Table([]string{"KEY", "VALUE"}, [][]string{
					{"CLI version", emptyDash(report.CLIVersion)},
					{"Platform", emptyDash(report.Platform)},
					{"Profile", emptyDash(report.Profile)},
					{"Instance", emptyDash(report.Instance)},
					{"Instance configured", yesNo(report.InstanceConfigured)},
					{"Token configured", yesNo(report.TokenConfigured)},
					{"Token source", emptyDash(report.TokenSource)},
					{"Workspace", emptyDash(report.Workspace)},
					{"Workspace configured", yesNo(report.WorkspaceConfigured)},
					{"Config path", emptyDash(report.ConfigPath)},
					{"Credential path", emptyDash(report.CredentialPath)},
					{"Ready", yesNo(report.Ready)},
				})
			}
			if !report.Ready {
				return fmt.Errorf("CLI is not ready: %s", strings.Join(report.Issues, "; "))
			}
			return nil
		},
	}
}

func checkDoctorConfig(version string, cfg *config.Runtime) doctorReport {
	report := doctorReport{
		CLIVersion:          version,
		Platform:            config.Platform(),
		Profile:             cfg.ProfileName,
		Instance:            cfg.Instance,
		InstanceConfigured:  cfg.Instance != "",
		Workspace:           cfg.Workspace,
		WorkspaceConfigured: cfg.Workspace != "",
		ConfigPath:          cfg.ConfigPath,
		CredentialPath:      cfg.CredentialPath,
		Issues:              []string{},
	}
	if !report.InstanceConfigured {
		report.Issues = append(report.Issues,
			"no instance is configured: run `openpost instance add <name> <url>` or pass --instance")
	}
	_, source, hasToken := diagnosticsToken(cfg)
	report.TokenConfigured = hasToken
	report.TokenSource = source
	if !hasToken {
		report.Issues = append(report.Issues,
			"no API token is available: run `openpost auth login` or set $OPENPOST_TOKEN")
	}
	report.Ready = len(report.Issues) == 0
	return report
}
