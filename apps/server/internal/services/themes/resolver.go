package themes

import (
	"context"
	"errors"
	"fmt"
)

type resolutionStore interface {
	Selection(context.Context, string) (Selection, error)
	published(context.Context, string, string, int) (*PublishedRevision, error)
	publishedResourcesAvailable(context.Context, string, string, int, ThemeManifest) error
}

type resolver struct{ store resolutionStore }

func newResolver(store resolutionStore) *resolver { return &resolver{store: store} }

// ResolveInput takes workspace plus concrete scheme only. The organization
// is derived from the workspace server-side so callers cannot request a
// cross-organization resolution; user appearance preference (light/dark/
// system) is resolved to a concrete scheme by the client before calling.
type ResolveInput struct {
	WorkspaceID string
	Scheme      ColorScheme
}

func (r *resolver) Resolve(ctx context.Context, input ResolveInput) (ResolvedTheme, error) {
	if input.WorkspaceID == "" || !validScheme(input.Scheme) {
		return ResolvedTheme{}, fmt.Errorf("%w: workspace_id and light or dark scheme are required", ErrInvalidInput)
	}
	if r == nil || r.store == nil {
		return ResolvedTheme{}, ErrUnavailable
	}
	selection, err := r.store.Selection(ctx, input.WorkspaceID)
	if err != nil {
		return ResolvedTheme{}, fmt.Errorf("%w: resolve workspace selection", ErrUnavailable)
	}
	result, err := r.resolveReference(ctx, selection.OrganizationID, selection.Reference, input.Scheme)
	result.organizationID = selection.OrganizationID
	return result, err
}

//nolint:gocyclo // Resolution keeps every reference failure mapped to one complete Workshop fallback rather than a hybrid theme.
func (r *resolver) resolveReference(ctx context.Context, organizationID string, reference ThemeReference, scheme ColorScheme) (ResolvedTheme, error) {
	if reference.Kind == ReferenceBuiltIn {
		family, ok := BuiltIns()[reference.ID]
		if !ok || reference.Version != builtInVersion(family) {
			return workshopFallback(scheme, FallbackInvalidReference), nil
		}
		manifest := family.Schemes.For(scheme)
		if manifest == nil {
			return workshopFallback(scheme, FallbackUnsupportedScheme), nil
		}
		normalized, err := NormalizeSchemeManifest(scheme, *manifest)
		if err != nil {
			return workshopFallback(scheme, FallbackInvalidManifest), nil
		}
		return resolved(family, reference, scheme, normalized, ResolutionBuiltIn, FallbackNone), nil
	}
	if reference.Kind != ReferenceCustom || reference.ID == "" || reference.Version < 1 {
		return workshopFallback(scheme, FallbackInvalidReference), nil
	}
	revision, err := r.store.published(ctx, organizationID, reference.ID, reference.Version)
	if err != nil {
		switch {
		case errors.Is(err, ErrInaccessible), errors.Is(err, ErrNotFound):
			return workshopFallback(scheme, FallbackMissing), nil
		case errors.Is(err, errStoredManifest):
			return workshopFallback(scheme, FallbackInvalidManifest), nil
		default:
			return ResolvedTheme{}, fmt.Errorf("%w: load published theme", ErrUnavailable)
		}
	}
	if revision == nil || revision.Revision != reference.Version {
		return workshopFallback(scheme, FallbackUnpublished), nil
	}
	if err := r.store.publishedResourcesAvailable(ctx, organizationID, reference.ID, reference.Version, revision.Manifest); err != nil {
		switch {
		case errors.Is(err, errUnsafeResource):
			return workshopFallback(scheme, FallbackUnsafeResource), nil
		case errors.Is(err, errResourceFailed):
			return workshopFallback(scheme, FallbackResourceFailed), nil
		default:
			return ResolvedTheme{}, fmt.Errorf("%w: validate published resources", ErrUnavailable)
		}
	}
	manifest := revision.Manifest.Schemes.For(scheme)
	if manifest == nil {
		return workshopFallback(scheme, FallbackUnsupportedScheme), nil
	}
	normalized, err := NormalizeSchemeManifest(scheme, *manifest)
	if err != nil {
		return workshopFallback(scheme, FallbackInvalidManifest), nil
	}
	return resolved(revision.Manifest, reference, scheme, normalized, ResolutionOrganization, FallbackNone), nil
}

func resolved(family ThemeManifest, reference ThemeReference, scheme ColorScheme, manifest ThemeSchemeManifest, source ResolutionSource, reason FallbackReason) ResolvedTheme {
	revision := family.Revision
	if reference.Kind == ReferenceCustom {
		revision = fmt.Sprintf("%d", reference.Version)
	}
	return ResolvedTheme{ID: family.ID, Revision: revision, Name: family.Name, IconPack: family.IconPack, Source: source, RequestedScheme: scheme, Scheme: scheme, Manifest: manifest, Fonts: runtimeFontFacesForScheme(family.Fonts, manifest), Assets: family.Assets, FallbackReason: reason, CacheIdentity: fmt.Sprintf("%s:%s:%d:%s", source, reference.ID, reference.Version, scheme)}
}

func runtimeFontFacesForScheme(fonts []ThemeFontFace, manifest ThemeSchemeManifest) []ThemeRuntimeFontFace {
	type fontReference struct {
		family string
		weight int
	}
	references := map[fontReference]struct{}{}
	for _, role := range []ThemeTypographyRoleTokens{
		manifest.Typography.Display,
		manifest.Typography.Title,
		manifest.Typography.Body,
		manifest.Typography.Label,
		manifest.Typography.Metadata,
		manifest.Typography.Code,
	} {
		references[fontReference{family: role.Family, weight: role.Weight}] = struct{}{}
	}
	usedFonts := make([]ThemeFontFace, 0, len(fonts))
	for _, font := range fonts {
		if _, used := references[fontReference{family: font.Family, weight: font.Weight}]; !used || font.Style != "normal" {
			continue
		}
		usedFonts = append(usedFonts, font)
	}
	return runtimeFontFaces(usedFonts)
}

func runtimeFontFaces(fonts []ThemeFontFace) []ThemeRuntimeFontFace {
	result := make([]ThemeRuntimeFontFace, 0, len(fonts))
	for _, font := range fonts {
		result = append(result, ThemeRuntimeFontFace{
			ID: font.ID, Family: font.Family, SourceURL: font.SourceURL, Format: font.Format,
			Weight: font.Weight, Style: font.Style, Display: font.Display,
		})
	}
	return result
}

func workshopFallback(scheme ColorScheme, reason FallbackReason) ResolvedTheme {
	family := BuiltIns()["workshop"]
	reference := builtInReference(family)
	result := resolved(family, reference, scheme, Workshop(scheme), ResolutionFallback, reason)
	result.CacheIdentity = fmt.Sprintf("fallback:workshop:%d:%s:%s", reference.Version, scheme, reason)
	return result
}
