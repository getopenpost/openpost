package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/openpost/cli/internal/auth"
	"github.com/openpost/cli/internal/config"
	"github.com/openpost/cli/internal/mcpstdio"
)

var version = "dev"

func main() {
	var (
		profile      string
		instance     string
		token        string
		showVersion  bool
		showEndpoint bool
	)
	flags := flag.NewFlagSet("openpost-mcp", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	flags.StringVar(&profile, "profile", "", "OpenPost CLI profile to use")
	flags.StringVar(&instance, "instance", "", "OpenPost instance URL override")
	flags.StringVar(&token, "token", "", "API token override")
	flags.BoolVar(&showVersion, "version", false, "print version and exit")
	flags.BoolVar(&showEndpoint, "print-endpoint", false, "print resolved remote MCP endpoint to stderr before serving")
	if err := flags.Parse(os.Args[1:]); err != nil {
		os.Exit(2)
	}
	if showVersion {
		fmt.Fprintf(os.Stderr, "openpost-mcp %s\n", version)
		return
	}

	cfg, err := config.Load(config.FlagOverrides{
		Profile:  profile,
		Instance: instance,
		Token:    token,
	})
	if err != nil {
		exitErr(err)
	}
	if cfg.Instance == "" {
		exitErr(fmt.Errorf("instance is required: run `openpost instance add <name> <url>` or pass --instance"))
	}
	resolvedToken := cfg.Token
	if resolvedToken == "" {
		resolvedToken, err = auth.NewStore(cfg).Get(cfg.ProfileName)
		if err != nil {
			exitErr(fmt.Errorf("token is required: run `openpost auth login %s` or pass --token", cfg.Instance))
		}
	}

	proxy := mcpstdio.NewProxyWithVersion(cfg.Instance, resolvedToken, version)
	if showEndpoint {
		fmt.Fprintln(os.Stderr, proxy.Endpoint)
	}
	if err := proxy.Serve(context.Background(), os.Stdin, os.Stdout); err != nil {
		exitErr(err)
	}
}

func exitErr(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}
