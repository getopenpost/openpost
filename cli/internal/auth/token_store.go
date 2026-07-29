// Package auth handles CLI-side credential storage: OS keyring by
// default, 0600 credentials.json fallback, and resolve-from-everywhere
// lookup for runtime use.
package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zalando/go-keyring"

	"github.com/openpost/cli/internal/config"
)

// keyringService is the constant used as the "service" parameter in
// libsecret / macOS keychain / Windows credential manager.
const keyringService = "openpost-cli"

// Store is the credential store interface. Implementations:
//   - KeyringStore: OS keyring via zalando/go-keyring (default).
//   - InsecureStore: 0600 file at $XDG_CONFIG_HOME/openpost/credentials.json.
type Store interface {
	Get(profileName string) (string, error)
	Set(profileName, token string) error
	Delete(profileName string) error
}

// NewStore returns the appropriate Store. Insecure is consulted only
// if openStore() succeeds AND keyring.Set returns a libsecret/secret-service
// error. We don't silently degrade to file storage on the user's first
// login — that decision is the user's, via the --insecure-storage flag
// during `openpost auth login`.
func NewStore(cfg *config.Runtime) Store {
	// Heuristic: if the env explicitly opts into insecure storage,
	// or if a credentials.json already exists with a token for this
	// profile, prefer the file store. This keeps a previously
	// explicitly-chosen insecure workflow stable across upgrades.
	if os.Getenv("OPENPOST_INSECURE_STORAGE") == "1" {
		return NewInsecureStore(cfg.CredentialPath)
	}
	if hasFileToken(cfg.CredentialPath, cfg.ProfileName) {
		return NewInsecureStore(cfg.CredentialPath)
	}
	return NewKeyringStore()
}

// HasToken reports whether the active profile has a stored token in
// ANY store. Used by `openpost auth status` to show a single source of
// truth.
func HasToken(cfg *config.Runtime) (storeName string, ok bool) {
	if _, err := keyring.Get(keyringService, profileKey(cfg.ProfileName)); err == nil {
		return "keyring", true
	}
	if hasFileToken(cfg.CredentialPath, cfg.ProfileName) {
		return "file", true
	}
	return "", false
}

// ----- keyring -----

type KeyringStore struct{}

func NewKeyringStore() *KeyringStore { return &KeyringStore{} }

func (k *KeyringStore) Get(profileName string) (string, error) {
	tok, err := keyring.Get(keyringService, profileKey(profileName))
	if err != nil {
		return "", fmt.Errorf("no token in keyring for profile %q: %w", profileName, err)
	}
	return tok, nil
}

func (k *KeyringStore) Set(profileName, token string) error {
	return keyring.Set(keyringService, profileKey(profileName), token)
}

func (k *KeyringStore) Delete(profileName string) error {
	if err := keyring.Delete(keyringService, profileKey(profileName)); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return err
	}
	return nil
}

// ----- file -----

type InsecureStore struct {
	path string
}

func NewInsecureStore(path string) *InsecureStore { return &InsecureStore{path: path} }

func (f *InsecureStore) Get(profileName string) (string, error) {
	creds, err := loadCreds(f.path)
	if err != nil {
		return "", err
	}
	tok, ok := creds.Profiles[profileName]
	if !ok || tok == "" {
		return "", fmt.Errorf("no token in %s for profile %q", f.path, profileName)
	}
	return tok, nil
}

func (f *InsecureStore) Set(profileName, token string) error {
	creds, err := loadCreds(f.path)
	if err != nil {
		return err
	}
	creds.Profiles[profileName] = token
	return saveCreds(f.path, creds)
}

func (f *InsecureStore) Delete(profileName string) error {
	creds, err := loadCreds(f.path)
	if err != nil {
		return err
	}
	delete(creds.Profiles, profileName)
	return saveCreds(f.path, creds)
}

func profileKey(profileName string) string {
	return "profile:" + profileName
}

func hasFileToken(path, profileName string) bool {
	creds, err := loadCreds(path)
	if err != nil {
		return false
	}
	_, ok := creds.Profiles[profileName]
	return ok
}

// file shim to avoid an import cycle with config (which already has
// its own load/save — we duplicate the type here intentionally so the
// auth package doesn't depend on the on-disk shape, only on read+write).
type fileCreds struct {
	Profiles map[string]string `json:"profiles"`
}

func loadCreds(path string) (fileCreds, error) {
	c := fileCreds{Profiles: map[string]string{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return c, err
	}
	return c, nil
}

func saveCreds(path string, c fileCreds) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}
