package commands

import "github.com/spf13/cobra"

func newCompletionCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "completion <bash|zsh|fish|powershell>",
		Short: "Generate shell completion script",
		Long: `Output a shell completion script for the given shell.

To load completions:

Bash:
  $ source <(openpost completion bash)

  # To load completions for each session, execute once:
  # Linux:
  $ openpost completion bash > /etc/bash_completion.d/openpost
  # macOS:
  $ openpost completion bash > $(brew --prefix)/etc/bash_completion.d/openpost

Zsh:
  # If shell completion is not already enabled in your environment,
  # you will need to enable it. You can execute the following once:
  $ echo "autoload -U compinit; compinit" >> ~/.zshrc

  # To load completions for each session, execute once:
  $ openpost completion zsh > "${fpath[1]}/_openpost"

  # You will need to start a new shell for this setup to take effect.

Fish:
  $ openpost completion fish | source

  # To load completions for each session, execute once:
  $ openpost completion fish > ~/.config/fish/completions/openpost.fish

PowerShell:
  PS> openpost completion powershell | Out-String | Invoke-Expression

  # To load completions for every new session, run:
  PS> openpost completion powershell > openpost.ps1
  # and source this file from your PowerShell profile.
`,
		DisableFlagsInUseLine: true,
		Args:                  cobra.MatchAll(cobra.ExactArgs(1), cobra.OnlyValidArgs),
		ValidArgs:             []string{"bash", "zsh", "fish", "powershell"},
		RunE: func(cmd *cobra.Command, args []string) error {
			switch args[0] {
			case "bash":
				return cmd.Root().GenBashCompletion(cmd.OutOrStdout())
			case "zsh":
				return cmd.Root().GenZshCompletion(cmd.OutOrStdout())
			case "fish":
				return cmd.Root().GenFishCompletion(cmd.OutOrStdout(), true)
			case "powershell":
				return cmd.Root().GenPowerShellCompletionWithDesc(cmd.OutOrStdout())
			}
			return nil
		},
	}
	return cmd
}
