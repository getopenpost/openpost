package main

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"html"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/usernames"
	"github.com/uptrace/bun"
)

//go:embed all:public
var embeddedWeb embed.FS

func RegisterSpaRoutes(e *echo.Echo, db *bun.DB, publicURL string) {
	webFS, err := fs.Sub(embeddedWeb, "public")
	if err != nil {
		panic(err)
	}
	// Keep package tests independent of generated frontend output while still
	// failing immediately when the application starts with an empty embed.
	data, err := fs.ReadFile(webFS, "index.html")
	if err != nil || len(data) == 0 {
		panic("openpost: embedded frontend is missing or empty (backend/cmd/openpost/public/index.html). " +
			"Run the frontend build first: `cd frontend && pnpm build` (or use `devenv shell -- build`).")
	}
	registerSpaRoutesWithProfileMetadata(e, webFS, db, publicURL)
}

func registerSpaRoutes(e *echo.Echo, webFS fs.FS) {
	registerSpaRoutesWithProfileMetadata(e, webFS, nil, "")
}

type publicProfilePageMetadata struct {
	Username    string
	DisplayName string
	AvatarURL   string
}

func registerSpaRoutesWithProfileMetadata(e *echo.Echo, webFS fs.FS, db *bun.DB, publicURL string) {
	writeHTML := func(c echo.Context, data []byte) error {
		c.Response().Header().Set("Content-Type", "text/html")
		c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Response().Header().Set("Pragma", "no-cache")
		c.Response().Header().Set("Expires", "0")
		_, err := c.Response().Write(data)
		return err
	}

	e.GET("/u/:username", func(c echo.Context) error {
		indexData, _ := fs.ReadFile(webFS, "index.html")
		metadata, found, err := loadPublicProfilePageMetadata(c.Request().Context(), db, c.Param("username"))
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to load public profile")
		}
		if !found {
			return writeHTML(c, renderPublicProfileHTML(indexData, nil, publicURL))
		}
		return writeHTML(c, renderPublicProfileHTML(indexData, &metadata, publicURL))
	})

	e.GET("/*", func(c echo.Context) error {
		reqPath := c.Request().URL.Path
		if reqPath == "" {
			reqPath = "/"
		}

		if strings.HasPrefix(reqPath, "/api") {
			return echo.NewHTTPError(http.StatusNotFound, "API not found")
		}

		relPath := strings.TrimPrefix(path.Clean(reqPath), "/")
		if relPath == "." {
			relPath = ""
		}

		if relPath == "" {
			indexData, _ := fs.ReadFile(webFS, "index.html")
			return writeHTML(c, indexData)
		}
		if path.Ext(relPath) == ".html" {
			data, readErr := fs.ReadFile(webFS, relPath)
			if readErr == nil {
				return writeHTML(c, data)
			}
		}

		htmlFile := relPath + ".html"
		if _, err := fs.Stat(webFS, htmlFile); err == nil {
			data, _ := fs.ReadFile(webFS, htmlFile)
			return writeHTML(c, data)
		}

		info, err := fs.Stat(webFS, relPath)
		if err == nil {
			if info.IsDir() {
				indexPath := relPath + "/index.html"
				if _, statErr := fs.Stat(webFS, indexPath); statErr == nil {
					indexData, _ := fs.ReadFile(webFS, indexPath)
					return writeHTML(c, indexData)
				}

				indexData, _ := fs.ReadFile(webFS, "index.html")
				return writeHTML(c, indexData)
			}

			return serveStaticAsset(c, webFS, relPath, info)
		}

		if os.IsNotExist(err) {
			indexData, _ := fs.ReadFile(webFS, "index.html")
			return writeHTML(c, indexData)
		}

		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	})
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
		Column("username", "display_name", "avatar_url").
		Where("LOWER(username) = ?", username).
		Where("public_profile_enabled = ?", true).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return publicProfilePageMetadata{}, false, nil
		}
		return publicProfilePageMetadata{}, false, err
	}
	return publicProfilePageMetadata{
		Username:    user.Username,
		DisplayName: strings.TrimSpace(user.DisplayName),
		AvatarURL:   strings.TrimSpace(user.AvatarURL),
	}, true, nil
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
	if !strings.HasPrefix(relPath, "studio-models/") {
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
