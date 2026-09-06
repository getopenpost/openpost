// Package main is the entrypoint for the OpenPost CLI.
//
// The CLI is an HTTP client for a running OpenPost instance. It does
// not embed or run the server, does not open SQLite, and does not
// touch the filesystem beyond the user's config dir and optional
// keyring entry.
//
// Authentication uses a long-lived opaque token (op_cli_*) that the
// user mints in the web UI (or via the device-code flow in
// `openpost auth login`). The token secret lives in the OS keychain
// when available, with a documented --insecure-storage fallback.
package main

import (
	"fmt"
	"os"

	"github.com/openpost/cli/internal/commands"
)

var version = "dev"

func main() {
	root := commands.NewRoot(version)
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
