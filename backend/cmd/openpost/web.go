package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/publicprofiles"
	"github.com/openpost/backend/internal/usernames"
	"github.com/uptrace/bun"
)

func registerSpaRoutesFromFS(
	e *echo.Echo,
	webFS fs.FS,
	db *bun.DB,
	publicURL string,
	managedEdition bool,
	publicProfilesEnabled bool,
) {
	// Keep package tests independent of generated frontend output while still
	// failing immediately when the application starts without frontend assets.
	data, err := fs.ReadFile(webFS, "index.html")
	if err != nil || len(data) == 0 {
		panic("openpost: frontend is missing or empty (backend/cmd/openpost/public/index.html). " +
			"Run the frontend build first: `bun run build -- frontend`.")
	}
	routes, err := loadSpaRouteManifest(webFS)
	if err != nil {
		panic("openpost: frontend application route manifest is missing or invalid. " +
			"Run the frontend build first: `bun run build -- frontend`: " + err.Error())
	}
	registerSpaRoutesWithProfileMetadataAndMatcher(e, webFS, db, publicURL, managedEdition, publicProfilesEnabled, routes)
}

func registerSpaRoutes(e *echo.Echo, webFS fs.FS) {
	registerSpaRoutesWithProfileMetadata(e, webFS, nil, "", false, true)
}

const spaRouteManifestPath = "app-routes.json"

var spaRouteParameterPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(?:=[A-Za-z_][A-Za-z0-9_]*)?$`)

type spaRouteManifest struct {
	SchemaVersion int      `json:"schema_version"`
	Routes        []string `json:"routes"`
}

type spaRouteMatcher struct {
	routes []string
}

func loadSpaRouteManifest(webFS fs.FS) (spaRouteMatcher, error) {
	data, err := fs.ReadFile(webFS, spaRouteManifestPath)
	if err != nil {
		return spaRouteMatcher{}, fmt.Errorf("read %s: %w", spaRouteManifestPath, err)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var manifest spaRouteManifest
	if err := decoder.Decode(&manifest); err != nil {
		return spaRouteMatcher{}, fmt.Errorf("decode %s: %w", spaRouteManifestPath, err)
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return spaRouteMatcher{}, fmt.Errorf("decode %s: %w", spaRouteManifestPath, err)
	}
	if manifest.SchemaVersion != 1 {
		return spaRouteMatcher{}, fmt.Errorf("unsupported schema_version %d", manifest.SchemaVersion)
	}
	if len(manifest.Routes) == 0 {
		return spaRouteMatcher{}, errors.New("route manifest is empty")
	}
	for index, route := range manifest.Routes {
		if err := validateSpaRouteTemplate(route); err != nil {
			return spaRouteMatcher{}, fmt.Errorf("route %q: %w", route, err)
		}
		if index > 0 && manifest.Routes[index-1] >= route {
			return spaRouteMatcher{}, errors.New("routes must be sorted and unique")
		}
	}
	return spaRouteMatcher{routes: manifest.Routes}, nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("manifest must contain one JSON document")
		}
		return err
	}
	return nil
}

func validateSpaRouteTemplate(route string) error {
	if route == "" || !strings.HasPrefix(route, "/") || path.Clean(route) != route {
		return errors.New("path must be an absolute canonical route")
	}
	segments := splitRoutePath(route)
	for index, segment := range segments {
		if isRestRouteSegment(segment) {
			if index != len(segments)-1 {
				return errors.New("rest parameters must be valid final segments")
			}
			continue
		}
		if strings.ContainsAny(segment, "[]") && !isDynamicRouteSegment(segment) && !isOptionalRouteSegment(segment) {
			return errors.New("parameter segment has invalid brackets")
		}
	}
	return nil
}

func (matcher spaRouteMatcher) matches(requestPath string) bool {
	actual := splitRoutePath(path.Clean("/" + strings.TrimPrefix(requestPath, "/")))
	for _, route := range matcher.routes {
		if routeSegmentsMatch(splitRoutePath(route), actual) {
			return true
		}
	}
	return false
}

func splitRoutePath(route string) []string {
	trimmed := strings.Trim(route, "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}

func routeSegmentsMatch(template, actual []string) bool {
	if len(template) == 0 {
		return len(actual) == 0
	}
	segment := template[0]
	if isRestRouteSegment(segment) {
		return len(template) == 1
	}
	if isOptionalRouteSegment(segment) {
		if routeSegmentsMatch(template[1:], actual) {
			return true
		}
		return len(actual) > 0 && routeSegmentsMatch(template[1:], actual[1:])
	}
	if len(actual) == 0 {
		return false
	}
	if segment != actual[0] && !isDynamicRouteSegment(segment) {
		return false
	}
	return routeSegmentsMatch(template[1:], actual[1:])
}

func isDynamicRouteSegment(segment string) bool {
	return len(segment) > 2 && strings.HasPrefix(segment, "[") && strings.HasSuffix(segment, "]") &&
		!strings.HasPrefix(segment, "[[") && !strings.HasPrefix(segment, "[...") &&
		spaRouteParameterPattern.MatchString(segment[1:len(segment)-1])
}

func isOptionalRouteSegment(segment string) bool {
	return len(segment) > 4 && strings.HasPrefix(segment, "[[") && strings.HasSuffix(segment, "]]") &&
		!strings.HasPrefix(segment, "[[...") &&
		spaRouteParameterPattern.MatchString(segment[2:len(segment)-2])
}

func isRestRouteSegment(segment string) bool {
	return (len(segment) > 5 && strings.HasPrefix(segment, "[...") && strings.HasSuffix(segment, "]") &&
		spaRouteParameterPattern.MatchString(segment[4:len(segment)-1])) ||
		(len(segment) > 7 && strings.HasPrefix(segment, "[[...") && strings.HasSuffix(segment, "]]") &&
			spaRouteParameterPattern.MatchString(segment[5:len(segment)-2]))
}

type publicProfilePageMetadata struct {
	Username    string
	DisplayName string
	AvatarURL   string
}

func writeHTMLResponse(c echo.Context, data []byte, managedEdition bool) error {
	return writeHTMLStatusResponse(c, data, managedEdition, http.StatusOK)
}

func writeHTMLStatusResponse(c echo.Context, data []byte, managedEdition bool, status int) error {
	if managedEdition {
		data = renderManagedEditionMetadata(data)
	}
	c.Response().Header().Set("Content-Type", "text/html")
	c.Response().Header().Set("Content-Length", strconv.Itoa(len(data)))
	c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Response().Header().Set("Pragma", "no-cache")
	c.Response().Header().Set("Expires", "0")
	if c.Request().Method == http.MethodHead {
		return c.NoContent(status)
	}
	c.Response().WriteHeader(status)
	_, err := c.Response().Write(data)
	return err
}

func registerSpaRoutesWithProfileMetadata(
	e *echo.Echo,
	webFS fs.FS,
	db *bun.DB,
	publicURL string,
	managedEdition bool,
	publicProfilesEnabled bool,
) {
	routes, _ := loadSpaRouteManifest(webFS)
	registerSpaRoutesWithProfileMetadataAndMatcher(e, webFS, db, publicURL, managedEdition, publicProfilesEnabled, routes)
}

func registerSpaRoutesWithProfileMetadataAndMatcher(
	e *echo.Echo,
	webFS fs.FS,
	db *bun.DB,
	publicURL string,
	managedEdition bool,
	publicProfilesEnabled bool,
	routes spaRouteMatcher,
) {
	writeHTML := func(c echo.Context, data []byte, status int) error {
		return writeHTMLStatusResponse(c, data, managedEdition, status)
	}

	publicProfileHandler := func(c echo.Context) error {
		indexData, _ := fs.ReadFile(webFS, "index.html")
		if !publicProfilesEnabled {
			return writeHTML(c, renderPublicProfileHTML(indexData, nil, publicURL), http.StatusNotFound)
		}
		metadata, found, err := loadPublicProfilePageMetadata(c.Request().Context(), db, c.Param("username"))
		if err != nil {
			return writeHTML(c, renderPublicProfileHTML(indexData, nil, publicURL), http.StatusServiceUnavailable)
		}
		if !found {
			return writeHTML(c, renderPublicProfileHTML(indexData, nil, publicURL), http.StatusNotFound)
		}
		return writeHTML(c, renderPublicProfileHTML(indexData, &metadata, publicURL), http.StatusOK)
	}
	e.Match([]string{http.MethodGet, http.MethodHead}, "/u/:username", publicProfileHandler)

	handler := spaRequestHandler{
		webFS:          webFS,
		publicURL:      publicURL,
		managedEdition: managedEdition,
		routes:         routes,
	}
	e.Match([]string{http.MethodGet, http.MethodHead}, "/*", handler.serve)
}

type spaRequestHandler struct {
	webFS          fs.FS
	publicURL      string
	managedEdition bool
	routes         spaRouteMatcher
}

func (h spaRequestHandler) serve(c echo.Context) error {
	reqPath := normalizedRequestPath(c.Request().URL)
	if target, ok := legacyStudioRedirectTarget(c.Request().URL); ok {
		return c.Redirect(http.StatusPermanentRedirect, target)
	}
	if reqPath == "/api" || strings.HasPrefix(reqPath, "/api/") {
		return echo.NewHTTPError(http.StatusNotFound, "API not found")
	}

	relPath := strings.TrimPrefix(path.Clean(reqPath), "/")
	if relPath == "." {
		relPath = ""
	}
	if relPath == "" {
		return h.writeHTML(c, renderSpaRootHTML(
			h.webFS,
			h.publicURL,
			h.managedEdition && !requestHasSessionCookie(c.Request()),
		))
	}
	if path.Ext(relPath) == ".html" {
		if data, err := fs.ReadFile(h.webFS, relPath); err == nil {
			return h.writeHTML(c, data)
		}
	}
	return h.servePath(c, reqPath, relPath)
}

func (h spaRequestHandler) servePath(c echo.Context, reqPath, relPath string) error {
	htmlFile := relPath + ".html"
	if _, err := fs.Stat(h.webFS, htmlFile); err == nil {
		data, _ := fs.ReadFile(h.webFS, htmlFile)
		return h.writeHTML(c, data)
	}

	info, err := fs.Stat(h.webFS, relPath)
	if err == nil {
		return h.serveExistingPath(c, reqPath, relPath, info)
	}
	if os.IsNotExist(err) {
		return h.writeFallback(c, reqPath)
	}
	return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
}

func (h spaRequestHandler) serveExistingPath(
	c echo.Context,
	reqPath string,
	relPath string,
	info fs.FileInfo,
) error {
	if !info.IsDir() {
		return serveStaticAsset(c, h.webFS, relPath, info)
	}
	indexPath := relPath + "/index.html"
	if _, err := fs.Stat(h.webFS, indexPath); err == nil {
		indexData, _ := fs.ReadFile(h.webFS, indexPath)
		return h.writeHTML(c, indexData)
	}
	return h.writeFallback(c, reqPath)
}

func (h spaRequestHandler) writeHTML(c echo.Context, data []byte) error {
	return writeHTMLResponse(c, data, h.managedEdition)
}

func (h spaRequestHandler) writeFallback(c echo.Context, requestPath string) error {
	indexData, _ := fs.ReadFile(h.webFS, "index.html")
	status := http.StatusNotFound
	if h.routes.matches(requestPath) {
		status = http.StatusOK
	}
	return writeHTMLStatusResponse(c, indexData, h.managedEdition, status)
}

func normalizedRequestPath(requestURL *url.URL) string {
	if requestURL.Path == "" {
		return "/"
	}
	return requestURL.Path
}

func legacyStudioRedirectTarget(requestURL *url.URL) (string, bool) {
	if requestURL.Path != "/studio" && !strings.HasPrefix(requestURL.Path, "/studio/") {
		return "", false
	}
	target := "/image-editor" + strings.TrimPrefix(requestURL.Path, "/studio")
	if requestURL.RawQuery != "" {
		target += "?" + requestURL.RawQuery
	}
	return target, true
}

func requestHasSessionCookie(request *http.Request) bool {
	cookie, err := request.Cookie("openpost_session")
	return err == nil && strings.TrimSpace(cookie.Value) != ""
}

func renderSpaRootHTML(webFS fs.FS, publicURL string, showManagedPublicHome bool) []byte {
	indexData, _ := fs.ReadFile(webFS, "index.html")
	if showManagedPublicHome {
		return renderManagedPublicHomeHTML(indexData, publicURL)
	}
	return indexData
}

func renderManagedEditionMetadata(indexData []byte) []byte {
	htmlDocument := string(indexData)
	if !strings.Contains(htmlDocument, "<head>") || strings.Contains(htmlDocument, `name="openpost-edition"`) {
		return indexData
	}
	return []byte(strings.Replace(
		htmlDocument,
		"<head>",
		`<head>
		<meta name="openpost-edition" content="cloud">`,
		1,
	))
}

func renderManagedPublicHomeHTML(indexData []byte, publicURL string) []byte {
	htmlDocument := string(indexData)
	if !strings.Contains(htmlDocument, "<head>") || !strings.Contains(htmlDocument, "<body") {
		return indexData
	}

	canonicalURL := strings.TrimRight(strings.TrimSpace(publicURL), "/") + "/"
	canonicalTag := ""
	if isPublicHTTPURL(canonicalURL) {
		canonicalTag = `
		<link data-openpost-managed-home rel="canonical" href="` + html.EscapeString(canonicalURL) + `">`
	}
	head := `<title data-openpost-managed-home>OpenPost - content publishing workspace</title>
		<meta data-openpost-managed-home name="description" content="Create, adapt, schedule, publish, and review social content from one OpenPost workspace.">` + canonicalTag + `
		<style data-openpost-managed-home>
			#openpost-managed-public-home{box-sizing:border-box;min-height:100vh;background:#faf9f7;color:#302b28;font-family:Geist,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#openpost-managed-public-home *{box-sizing:border-box}#openpost-managed-public-home a{color:inherit}#openpost-managed-public-home .oph-shell{width:min(1180px,calc(100% - 2rem));margin:0 auto}#openpost-managed-public-home .oph-nav{display:flex;min-height:64px;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #e6e1dc}#openpost-managed-public-home .oph-brand{display:inline-flex;min-height:44px;align-items:center;gap:9px;text-decoration:none;font-size:14px;font-weight:650}#openpost-managed-public-home .oph-brand img{width:34px;height:27px}#openpost-managed-public-home .oph-navlinks{display:flex;align-items:center;gap:12px}#openpost-managed-public-home .oph-link{display:inline-flex;min-height:44px;align-items:center;text-decoration:none;font-size:14px;font-weight:600}#openpost-managed-public-home .oph-button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border-radius:10px;background:#b74c05;color:#fff;padding:0 16px;text-decoration:none;font-size:14px;font-weight:650}#openpost-managed-public-home .oph-hero{display:grid;gap:44px;padding:64px 0;border-bottom:1px solid #e6e1dc}#openpost-managed-public-home .oph-kicker{margin:0;color:#b74c05;font-size:14px;font-weight:650}#openpost-managed-public-home h1{max-width:760px;margin:16px 0 0;font-size:clamp(2.5rem,7vw,4.25rem);line-height:1.01;letter-spacing:-.035em}#openpost-managed-public-home .oph-lede{max-width:700px;margin:24px 0 0;color:#6f6762;font-size:18px;line-height:1.65}#openpost-managed-public-home .oph-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}#openpost-managed-public-home .oph-price{align-self:end;border-block:1px solid #e6e1dc;padding:24px 0}#openpost-managed-public-home .oph-price-label,#openpost-managed-public-home .oph-note{margin:0;color:#6f6762;font-size:14px;line-height:1.6}#openpost-managed-public-home .oph-price strong{display:block;margin:8px 0;font-size:48px;letter-spacing:-.035em}#openpost-managed-public-home .oph-price strong span{font-size:16px;font-weight:400;letter-spacing:0;color:#6f6762}#openpost-managed-public-home .oph-features{display:grid;gap:28px;padding:40px 0;border-bottom:1px solid #e6e1dc}#openpost-managed-public-home .oph-feature h2{margin:0;font-size:16px}#openpost-managed-public-home .oph-feature p{max-width:34ch;margin:8px 0 0;color:#6f6762;font-size:14px;line-height:1.65}#openpost-managed-public-home .oph-pricing{padding:48px 0}#openpost-managed-public-home .oph-pricing-head{display:flex;align-items:end;justify-content:space-between;gap:24px;padding-bottom:20px;border-bottom:1px solid #e6e1dc}#openpost-managed-public-home .oph-pricing h2{margin:0;font-size:28px;letter-spacing:-.02em}#openpost-managed-public-home .oph-pricing-head p{max-width:650px;margin:8px 0 0;color:#6f6762;font-size:14px;line-height:1.6}#openpost-managed-public-home .oph-plans{display:grid;margin-top:24px;border:1px solid #e6e1dc;border-radius:12px;overflow:hidden}#openpost-managed-public-home .oph-plan{padding:20px;background:#fff;border-bottom:1px solid #e6e1dc}#openpost-managed-public-home .oph-plan:last-child{border-bottom:0}#openpost-managed-public-home .oph-plan h3{margin:0;font-size:14px}#openpost-managed-public-home .oph-plan p{margin:10px 0 0;font-size:24px;font-weight:650}#openpost-managed-public-home .oph-plan span{color:#6f6762;font-size:12px;font-weight:400}#openpost-managed-public-home .oph-footer{display:flex;flex-direction:column;gap:12px;padding:24px 0;border-top:1px solid #e6e1dc;color:#6f6762;font-size:13px;line-height:1.6}#openpost-managed-public-home .oph-policies{display:flex;flex-wrap:wrap;gap:20px}#openpost-managed-public-home .oph-policies a{display:inline-flex;min-height:44px;align-items:center} @media(min-width:760px){#openpost-managed-public-home .oph-hero{grid-template-columns:minmax(0,1.35fr) minmax(250px,.65fr);padding:88px 0}#openpost-managed-public-home .oph-price{border-block:0;border-left:1px solid #e6e1dc;padding:8px 0 8px 40px}#openpost-managed-public-home .oph-features{grid-template-columns:repeat(3,1fr)}#openpost-managed-public-home .oph-feature+ .oph-feature{border-left:1px solid #e6e1dc;padding-left:28px}#openpost-managed-public-home .oph-plans{grid-template-columns:repeat(5,1fr)}#openpost-managed-public-home .oph-plan{border-right:1px solid #e6e1dc;border-bottom:0}#openpost-managed-public-home .oph-plan:last-child{border-right:0}#openpost-managed-public-home .oph-footer{flex-direction:row;align-items:center;justify-content:space-between}}@media(max-width:520px){#openpost-managed-public-home .oph-navlinks .oph-button{display:none}#openpost-managed-public-home .oph-pricing-head{align-items:start;flex-direction:column}}@media(prefers-color-scheme:dark){#openpost-managed-public-home{background:#251f1c;color:#eeeae6}#openpost-managed-public-home .oph-kicker{color:#d66c22}#openpost-managed-public-home .oph-nav,#openpost-managed-public-home .oph-hero,#openpost-managed-public-home .oph-price,#openpost-managed-public-home .oph-features,#openpost-managed-public-home .oph-pricing-head,#openpost-managed-public-home .oph-footer,#openpost-managed-public-home .oph-plan{border-color:#443a35}#openpost-managed-public-home .oph-lede,#openpost-managed-public-home .oph-price-label,#openpost-managed-public-home .oph-note,#openpost-managed-public-home .oph-feature p,#openpost-managed-public-home .oph-pricing-head p,#openpost-managed-public-home .oph-price strong span,#openpost-managed-public-home .oph-plan span,#openpost-managed-public-home .oph-footer{color:#b7ada6}#openpost-managed-public-home .oph-plan{background:#302a27}}
		</style>`
	htmlDocument = strings.Replace(htmlDocument, "<head>", "<head>\n\t\t"+head, 1)

	home := `<main id="openpost-managed-public-home">
		<header class="oph-shell oph-nav">
			<a class="oph-brand" href="https://openpost.social" aria-label="Open the OpenPost product website"><img src="/assets/brand/icon.svg" alt=""><span>OpenPost</span></a>
			<nav class="oph-navlinks" aria-label="Account navigation"><a class="oph-link" href="/login">Sign in</a><a class="oph-button" href="/register?plan=founder">Start 14-day trial</a></nav>
		</header>
		<section class="oph-shell oph-hero" aria-labelledby="openpost-public-title">
			<div><p class="oph-kicker">OpenPost</p><h1 id="openpost-public-title">Your content operation, together in one workspace.</h1><p class="oph-lede">Create one source, adapt it for each social platform, schedule every destination, and review publishing results without splitting the work across separate tools.</p><div class="oph-actions"><a class="oph-button" href="/register?plan=founder">Start 14-day trial</a><a class="oph-link" href="https://openpost.social/pricing">View full pricing</a></div></div>
			<div class="oph-price"><p class="oph-price-label">Hosted service plans from</p><strong>$15<span>/month</span></strong><p class="oph-note">Every plan starts with a 14-day free trial. A card is required. Cancel before the first charge.</p></div>
		</section>
		<section class="oph-shell oph-features" aria-label="What OpenPost includes">
			<div class="oph-feature"><h2>Create and adapt</h2><p>Keep the source idea and each platform-specific version together.</p></div>
			<div class="oph-feature"><h2>Schedule and publish</h2><p>Plan the calendar and track every queued, published, or failed destination.</p></div>
			<div class="oph-feature"><h2>Review results</h2><p>Inspect publishing activity and stored analytics without leaving the workspace.</p></div>
		</section>
		<section class="oph-shell oph-pricing" aria-labelledby="openpost-pricing-title">
			<div class="oph-pricing-head"><div><h2 id="openpost-pricing-title">Straightforward workspace pricing</h2><p>Choose the account, publishing, storage, workspace, and seat limits that fit your current operation.</p></div><a class="oph-link" href="https://openpost.social/pricing">Compare features and limits</a></div>
			<div class="oph-plans"><article class="oph-plan"><h3>Starter</h3><p>$15<span>/month</span></p></article><article class="oph-plan"><h3>Founder</h3><p>$25<span>/month</span></p></article><article class="oph-plan"><h3>Pro</h3><p>$49<span>/month</span></p></article><article class="oph-plan"><h3>Team</h3><p>$99<span>/month</span></p></article><article class="oph-plan"><h3>Agency</h3><p>$199<span>/month</span></p></article></div>
		</section>
		<footer class="oph-shell oph-footer"><p>OpenPost is operated by Rodrigo Dias, a sole trader in Porto, Portugal.</p><nav class="oph-policies" aria-label="OpenPost policies"><a href="https://openpost.social/terms">Terms of service</a><a href="https://openpost.social/privacy">Privacy policy</a><a href="https://openpost.social/refunds">Refund policy</a></nav></footer>
	</main>`

	bodyStart := strings.Index(htmlDocument, "<body")
	bodyOpenEnd := strings.Index(htmlDocument[bodyStart:], ">")
	if bodyOpenEnd < 0 {
		return indexData
	}
	bodyOpenEnd += bodyStart + 1
	return []byte(htmlDocument[:bodyOpenEnd] + "\n\t" + home + htmlDocument[bodyOpenEnd:])
}

func loadPublicProfilePageMetadata(ctx context.Context, db *bun.DB, requestedUsername string) (publicProfilePageMetadata, bool, error) {
	if db == nil {
		return publicProfilePageMetadata{}, false, nil
	}
	username := usernames.Normalize(requestedUsername)
	if usernames.Validate(username) != nil {
		return publicProfilePageMetadata{}, false, nil
	}
	var user models.User
	if err := db.NewSelect().Model(&user).
		Column("username", "display_name", "avatar_url", "public_profile_visibility_json").
		Where("LOWER(username) = ?", username).
		Where("public_profile_enabled = ?", true).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return publicProfilePageMetadata{}, false, nil
		}
		return publicProfilePageMetadata{}, false, err
	}
	visibility := publicprofiles.Parse(user.PublicProfileVisibilityJSON)
	metadata := publicProfilePageMetadata{
		Username: user.Username,
	}
	if visibility.Has(publicprofiles.FieldDisplayName) {
		metadata.DisplayName = strings.TrimSpace(user.DisplayName)
	}
	if visibility.Has(publicprofiles.FieldAvatar) {
		metadata.AvatarURL = strings.TrimSpace(user.AvatarURL)
	}
	return metadata, true, nil
}

func renderPublicProfileHTML(indexData []byte, metadata *publicProfilePageMetadata, publicURL string) []byte {
	head := `<title data-openpost-profile-meta>Public profile - OpenPost</title>
		<meta data-openpost-profile-meta name="description" content="Public OpenPost publishing profile.">
		<meta data-openpost-profile-meta name="robots" content="noindex">`
	if metadata != nil {
		displayName := metadata.DisplayName
		if displayName == "" {
			displayName = "@" + metadata.Username
		}
		title := displayName + " (@" + metadata.Username + ") - OpenPost"
		description := "See " + displayName + "'s public publishing activity on OpenPost."
		canonicalURL := strings.TrimRight(publicURL, "/") + "/u/" + url.PathEscape(metadata.Username)
		head = profileMetadataTags(title, description, canonicalURL, metadata.AvatarURL)
	}
	htmlDocument := string(indexData)
	if !strings.Contains(htmlDocument, "<head>") {
		return indexData
	}
	return []byte(strings.Replace(htmlDocument, "<head>", "<head>\n\t\t"+head, 1))
}

func profileMetadataTags(title, description, canonicalURL, avatarURL string) string {
	escapedTitle := html.EscapeString(title)
	escapedDescription := html.EscapeString(description)
	escapedURL := html.EscapeString(canonicalURL)
	tags := `<title data-openpost-profile-meta>` + escapedTitle + `</title>
		<meta data-openpost-profile-meta name="description" content="` + escapedDescription + `">
		<meta data-openpost-profile-meta name="robots" content="index, follow">
		<link data-openpost-profile-meta rel="canonical" href="` + escapedURL + `">
		<meta data-openpost-profile-meta property="og:type" content="profile">
		<meta data-openpost-profile-meta property="og:title" content="` + escapedTitle + `">
		<meta data-openpost-profile-meta property="og:description" content="` + escapedDescription + `">
		<meta data-openpost-profile-meta property="og:url" content="` + escapedURL + `">
		<meta data-openpost-profile-meta name="twitter:card" content="summary">`
	if isPublicHTTPURL(avatarURL) {
		tags += `
		<meta data-openpost-profile-meta property="og:image" content="` + html.EscapeString(avatarURL) + `">`
	}
	return tags
}

func isPublicHTTPURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func serveStaticAsset(c echo.Context, webFS fs.FS, relPath string, originalInfo fs.FileInfo) error {
	assetPath := relPath
	contentEncoding := ""
	if c.Request().Header.Get("Range") == "" {
		assetPath, contentEncoding = precompressedAssetPath(
			webFS,
			relPath,
			c.Request().Header.Get("Accept-Encoding"),
		)
	}

	file, err := http.FS(webFS).Open(assetPath)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound)
	}
	defer file.Close()

	responseHeaders := c.Response().Header()
	addVaryHeader(responseHeaders, "Accept-Encoding")
	if contentType := mime.TypeByExtension(path.Ext(relPath)); contentType != "" {
		responseHeaders.Set("Content-Type", contentType)
	}
	if contentEncoding != "" {
		responseHeaders.Set("Content-Encoding", contentEncoding)
	}
	if isImmutableAsset(relPath) {
		responseHeaders.Set("Cache-Control", "public, max-age=31536000, immutable")
	}

	info := originalInfo
	if assetPath != relPath {
		if compressedInfo, statErr := fs.Stat(webFS, assetPath); statErr == nil {
			info = compressedInfo
		}
	}
	http.ServeContent(
		c.Response().Writer,
		c.Request(),
		path.Base(relPath),
		info.ModTime(),
		file,
	)
	return nil
}

func precompressedAssetPath(webFS fs.FS, relPath, acceptEncoding string) (string, string) {
	bestPath := relPath
	bestEncoding := ""
	bestQuality := 0.0
	for _, candidate := range []struct {
		name     string
		suffix   string
		encoding string
	}{
		{name: "br", suffix: ".br", encoding: "br"},
		{name: "gzip", suffix: ".gz", encoding: "gzip"},
	} {
		quality := contentEncodingQuality(acceptEncoding, candidate.name)
		if quality <= bestQuality {
			continue
		}
		compressedPath := relPath + candidate.suffix
		if _, err := fs.Stat(webFS, compressedPath); err == nil {
			bestPath = compressedPath
			bestEncoding = candidate.encoding
			bestQuality = quality
		}
	}
	return bestPath, bestEncoding
}

func contentEncodingQuality(header, desired string) float64 {
	desiredQuality := -1.0
	wildcardQuality := -1.0
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(strings.TrimSpace(item), ";")
		name := strings.ToLower(strings.TrimSpace(parts[0]))
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, value, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if !found || !strings.EqualFold(strings.TrimSpace(key), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil {
				quality = 0
			} else {
				quality = parsed
			}
		}
		if name == desired {
			desiredQuality = quality
		}
		if name == "*" {
			wildcardQuality = quality
		}
	}
	if desiredQuality >= 0 {
		return desiredQuality
	}
	return wildcardQuality
}

func addVaryHeader(header http.Header, value string) {
	for _, item := range strings.Split(header.Get("Vary"), ",") {
		if strings.EqualFold(strings.TrimSpace(item), value) {
			return
		}
	}
	header.Add("Vary", value)
}

func isImmutableAsset(relPath string) bool {
	if strings.HasPrefix(relPath, "_app/immutable/") {
		return true
	}
	if !strings.HasPrefix(relPath, "image-editor-models/") {
		return false
	}
	filename := path.Base(relPath)
	if len(filename) != 64 {
		return false
	}
	for _, character := range filename {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
