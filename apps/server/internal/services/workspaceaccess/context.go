package workspaceaccess

import "context"

type storedAuthorityKey struct{}

// WithStoredAuthority carries previously recorded identity assurance into a
// native application command. The command must still authorize current scope
// and membership. HTTP authentication never populates this context value.
func WithStoredAuthority(ctx context.Context, authority StoredAuthority) context.Context {
	return context.WithValue(ctx, storedAuthorityKey{}, authority)
}

func StoredAuthorityFromContext(ctx context.Context) (StoredAuthority, bool) {
	authority, ok := ctx.Value(storedAuthorityKey{}).(StoredAuthority)
	return authority, ok
}
