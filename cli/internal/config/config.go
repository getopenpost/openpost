// Package config owns the on-disk config file (~/.config/openpost/config.toml)
// and the runtime effective-config that subcommands see.
//
// Precedence: explicit flag > env var > profile in config file > built-in default.
//
// The secret token is never stored in the config file. It lives in the
// OS keyring under the profile name, with a documented fallback to a
// 0600 credentials.json when keyring is unavailable.
package config

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/spf13/cobra"
)

// FlagOverrides is the set of values supplied via the global CLI flags
// on the root command. Empty values are ignored — they fall through to
// the env / file / default chain.
type FlagOverrides struct {
	Profile   string
	Instance  string
	Workspace string
	Token     string
	AsJSON    bool
	Quiet     bool
	Yes       bool
	NoColor   bool
}

// Profile is one named entry in the config file.
type Profile struct {
	Instance      string `toml:"instance"`
	WorkspaceID   string `toml:"workspace_id"`
	WorkspaceName string `toml:"workspace_name"`
	DefaultSet    string `toml:"default_set"`
	Timezone      string `toml:"timezone"`
	Output        string `toml:"output"`      // "table" or "json"
	TokenLabel    string `toml:"token_label"` // keyring user-key; defaults to "profile:<name>"
}

// Config is the full file on disk.
type Config struct {
	CurrentProfile string             `toml:"current_profile"`
	Profiles       map[string]Profile `toml:"profiles"`
}

// Runtime is the effective resolved view for a single command
// invocation. It is what every subcommand reads.
type Runtime struct {
	ProfileName    string
	Profile        Profile
	Instance       string
	Workspace      string // resolved name or id; subcommands can pass through to API
	Token          string // resolved token (from flag, env, or keyring)
	AsJSON         bool
	Quiet          bool
	Yes            bool
	NoColor        bool
	ConfigPath     string
	CredentialPath string
}

// ctxKey is unexported so other packages can't accidentally collide
// with our config value in cobra.Command contexts.
type ctxKey struct{}

func AttachTo(cmd *cobra.Command, cfg *Runtime) {
	cmd.SetContext(context.WithValue(cmd.Context(), ctxKey{}, cfg))
}

func FromCommand(cmd *cobra.Command) *Runtime {
	if cmd == nil || cmd.Context() == nil {
		return nil
	}
	if v, ok := cmd.Context().Value(ctxKey{}).(*Runtime); ok {
		return v
	}
	return nil
}

// Load resolves precedence, loads the config file from disk, and
// returns the effective Runtime. It does NOT touch the keyring —
// callers that need the token should call TokenStore.Get with the
// resolved label.
func Load(overrides FlagOverrides) (*Runtime, error) {
	path, err := configPath()
	if err != nil {
		return nil, err
	}

	credPath, err := credentialsPath()
	if err != nil {
		return nil, err
	}

	cfg, err := LoadConfig()
	if err != nil {
		return nil, err
	}

	profileName := pickString(overrides.Profile, os.Getenv("OPENPOST_PROFILE"), cfg.CurrentProfile)
	if profileName == "" {
		profileName = "default"
	}

	prof, ok := cfg.Profiles[profileName]
	if !ok && profileName == "default" {
		// first-run convenience: implicit empty default profile
		prof = Profile{}
	} else if !ok {
		return nil, fmt.Errorf("profile %q not found in %s", profileName, path)
	}

	rt := &Runtime{
		ProfileName:    profileName,
		Profile:        prof,
		Instance:       pickString(overrides.Instance, os.Getenv("OPENPOST_INSTANCE"), prof.Instance),
		Workspace:      pickString(overrides.Workspace, os.Getenv("OPENPOST_WORKSPACE"), firstNonEmpty(prof.WorkspaceName, prof.WorkspaceID)),
		Token:          pickString(overrides.Token, os.Getenv("OPENPOST_TOKEN"), ""),
		AsJSON:         overrides.AsJSON || envBool("OPENPOST_OUTPUT_JSON") || prof.Output == "json",
		Quiet:          overrides.Quiet || envBool("OPENPOST_QUIET"),
		Yes:            overrides.Yes || envBool("OPENPOST_YES"),
		NoColor:        overrides.NoColor || envBool("OPENPOST_NO_COLOR") || os.Getenv("NO_COLOR") != "",
		ConfigPath:     path,
		CredentialPath: credPath,
	}

	if rt.Instance != "" {
		rt.Instance = strings.TrimRight(rt.Instance, "/")
	}
	return rt, nil
}

// LoadConfig reads the on-disk config file, returning an empty config
// when it does not exist yet.
func LoadConfig() (Config, error) {
	path, err := configPath()
	if err != nil {
		return Config{}, err
	}
	cfg := Config{Profiles: map[string]Profile{}}
	if data, err := os.ReadFile(path); err == nil {
		if err := toml.Unmarshal(data, &cfg); err != nil {
			return cfg, fmt.Errorf("invalid config at %s: %w", path, err)
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return cfg, fmt.Errorf("failed to read config: %w", err)
	}
	if cfg.Profiles == nil {
		cfg.Profiles = map[string]Profile{}
	}
	return cfg, nil
}

// Save writes the config back to disk with 0600 perms. It does not
// touch the credential file. Use this from `instance add/use`,
// `workspace use`, etc.
func Save(cfg Config) error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	if cfg.Profiles == nil {
		cfg.Profiles = map[string]Profile{}
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	enc := toml.NewEncoder(f)
	return enc.Encode(cfg)
}

func pickString(flagVal, envVal, fileVal string) string {
	if flagVal != "" {
		return flagVal
	}
	if envVal != "" {
		return envVal
	}
	return fileVal
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func envBool(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "" {
		return false
	}
	b, err := strconv.ParseBool(v)
	return err == nil && b
}

// configPath returns ~/.config/openpost/config.toml, honouring
// XDG_CONFIG_HOME and Windows equivalents.
func configPath() (string, error) {
	if dir := os.Getenv("OPENPOST_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, "config.toml"), nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "openpost", "config.toml"), nil
}

// credentialsPath is the insecure-storage fallback for tokens.
func credentialsPath() (string, error) {
	if dir := os.Getenv("OPENPOST_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, "credentials.json"), nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "openpost", "credentials.json"), nil
}

// Platform is exposed for diagnostics.
func Platform() string { return runtime.GOOS + "/" + runtime.GOARCH }
