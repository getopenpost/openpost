package platform

import (
	"context"
	"errors"
)

// BaseAdapter provides default unsupported stubs for core Adapter methods
// that non-OAuth or non-refreshing providers do not implement.
// Optional extension interfaces (CommentAdapter, AccountSelectionAdapter, etc.)
// are intentionally omitted so type assertions remain accurate.
type BaseAdapter struct{}

func (BaseAdapter) GenerateAuthURL(string) (string, map[string]string) {
	return "", nil
}

func (BaseAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{Supported: false, CredentialSource: RefreshCredentialNone}
}

func (BaseAdapter) RefreshToken(context.Context, RefreshTokenInput) (*TokenResult, error) {
	return nil, errors.New("token refresh is not supported")
}
