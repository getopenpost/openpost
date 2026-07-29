// Package main generates the CLI reference docs from the Cobra command tree.
package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/openpost/cli/internal/commands"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

func main() {
	out := filepath.Join("..", "docs-site", "reference", "cli.md")
	if len(os.Args) > 1 {
		out = os.Args[1]
	}

	root := commands.NewRoot("dev")
	root.InitDefaultHelpFlag()
	root.InitDefaultVersionFlag()

	var buf bytes.Buffer
	buf.WriteString("# CLI Reference\n\n")
	buf.WriteString("This page is generated from the Cobra command tree. Do not edit it by hand.\n\n")
	buf.WriteString("Regenerate with:\n\n```sh\ncd cli && go run ./cmd/openpost-docs ../docs-site/reference/cli.md\n```\n\n")

	cmds := commandList(root)
	for _, cmd := range cmds {
		writeCommand(&buf, cmd)
	}

	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		fatal(err)
	}
	if err := os.WriteFile(out, buf.Bytes(), 0o644); err != nil {
		fatal(err)
	}
}

func commandList(root *cobra.Command) []*cobra.Command {
	var out []*cobra.Command
	var walk func(*cobra.Command)
	walk = func(cmd *cobra.Command) {
		if cmd.Hidden {
			return
		}
		out = append(out, cmd)
		children := cmd.Commands()
		sort.Slice(children, func(i, j int) bool {
			return children[i].CommandPath() < children[j].CommandPath()
		})
		for _, child := range children {
			walk(child)
		}
	}
	walk(root)
	return out
}

func writeCommand(buf *bytes.Buffer, cmd *cobra.Command) {
	level := 2
	if cmd.Parent() != nil {
		level = 3
	}
	buf.WriteString(strings.Repeat("#", level))
	buf.WriteString(" `")
	buf.WriteString(cmd.CommandPath())
	buf.WriteString("`\n\n")

	if cmd.Short != "" {
		buf.WriteString(escapeMarkdown(cmd.Short))
		buf.WriteString("\n\n")
	}
	if cmd.Long != "" && cmd.Long != cmd.Short {
		buf.WriteString(escapeMarkdown(strings.TrimSpace(cmd.Long)))
		buf.WriteString("\n\n")
	}

	buf.WriteString("**Usage**\n\n```text\n")
	buf.WriteString(escapeMarkdown(cmd.UseLine()))
	buf.WriteString("\n```\n\n")

	writeFlagTable(buf, "Flags", cmd.NonInheritedFlags())
	writeFlagTable(buf, "Inherited Flags", cmd.InheritedFlags())

	if cmd.HasAvailableSubCommands() {
		buf.WriteString("**Subcommands**\n\n")
		buf.WriteString("| Command | Description |\n| --- | --- |\n")
		for _, child := range cmd.Commands() {
			if child.Hidden {
				continue
			}
			buf.WriteString("| `")
			buf.WriteString(child.CommandPath())
			buf.WriteString("` | ")
			buf.WriteString(escapeMarkdown(child.Short))
			buf.WriteString(" |\n")
		}
		buf.WriteString("\n")
	}
}

func writeFlagTable(buf *bytes.Buffer, title string, flags *pflag.FlagSet) {
	if flags == nil || !flags.HasFlags() {
		return
	}
	buf.WriteString("**")
	buf.WriteString(title)
	buf.WriteString("**\n\n")
	buf.WriteString("| Flag | Default | Description |\n| --- | --- | --- |\n")
	flags.VisitAll(func(flag *pflag.Flag) {
		if flag.Hidden {
			return
		}
		name := "--" + flag.Name
		if flag.Shorthand != "" {
			name = "-" + flag.Shorthand + ", " + name
		}
		buf.WriteString("| `")
		buf.WriteString(name)
		buf.WriteString("` | `")
		if flag.DefValue == "" {
			buf.WriteString("-")
		} else {
			buf.WriteString(escapeMarkdown(flag.DefValue))
		}
		buf.WriteString("` | ")
		buf.WriteString(escapeMarkdown(flag.Usage))
		buf.WriteString(" |\n")
	})
	buf.WriteString("\n")
}

func escapeMarkdown(value string) string {
	value = strings.ReplaceAll(value, "|", "\\|")
	value = strings.ReplaceAll(value, "<", "&lt;")
	value = strings.ReplaceAll(value, ">", "&gt;")
	value = strings.ReplaceAll(value, "\n", " ")
	return value
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
