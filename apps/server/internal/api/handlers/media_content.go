package handlers

import (
	"mime"
	"net/http"
	"strings"
)

func activeMediaDocumentType(contentType string) bool {
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	return mediaType == "text/html" || mediaType == "text/xml" || mediaType == "application/xml" || strings.HasSuffix(mediaType, "+xml")
}

// Stored MIME types can predate upload validation. Only passive formats may
// render inline; unknown files remain downloadable without gaining app origin access.
func setMediaResponseHeaders(header http.Header, contentType, filename string) string {
	header.Set("X-Content-Type-Options", "nosniff")
	sandbox := "sandbox allow-same-origin"
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || !inlineMediaType(mediaType) {
		sandbox = "sandbox"
		contentType = defaultMediaMimeType
		header.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": cleanUploadFilename(filename)}))
	}
	// Native media viewers need the origin for cookie-authenticated playback.
	// Scripts remain disabled, and attachments never retain the app origin.
	header.Set("Content-Security-Policy", sandbox+"; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
	header.Set("Content-Type", contentType)
	return contentType
}

func inlineMediaType(mediaType string) bool {
	switch mediaType {
	case "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp", "image/tiff", "image/x-icon", "image/vnd.microsoft.icon":
		return true
	case "audio/aac", "audio/flac", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/ogg", "audio/opus", "audio/wav", "audio/wave", "audio/x-wav", "audio/webm", "audio/x-flac", "audio/aiff", "audio/x-aiff":
		return true
	case "video/mp4", "video/mpeg", "video/ogg", "video/webm", "video/quicktime", "video/x-matroska", "video/x-msvideo", "video/3gpp", "video/3gpp2", "application/ogg":
		return true
	case "font/woff", "font/woff2", "font/ttf", "font/otf", "font/sfnt", "application/font-sfnt", "application/x-font-ttf", "application/x-font-opentype":
		return true
	default:
		return false
	}
}
