package handlers

import "github.com/openpost/backend/internal/screenshottemplates"

// Server exports carry the Go renderer key; uploads from older clients keep
// the HTML renderer key that produced their pixels.
const (
	screenshotTemplateRenderer       = screenshottemplates.Renderer
	screenshotTemplateClientRenderer = "openpost-screenshot-html-v1"
)

type ScreenshotTemplatePerson = screenshottemplates.ScreenshotTemplatePerson
type ScreenshotTemplateMessage = screenshottemplates.ScreenshotTemplateMessage
type ScreenshotTemplateConversation = screenshottemplates.ScreenshotTemplateConversation
type ScreenshotTemplateReceiptItem = screenshottemplates.ScreenshotTemplateReceiptItem
type ScreenshotTemplateReceipt = screenshottemplates.ScreenshotTemplateReceipt
type ScreenshotTemplateStatusUpdate = screenshottemplates.ScreenshotTemplateStatusUpdate
type ScreenshotTemplateStatus = screenshottemplates.ScreenshotTemplateStatus
type ScreenshotTemplateMeme = screenshottemplates.ScreenshotTemplateMeme
type ScreenshotTemplateDocument = screenshottemplates.ScreenshotTemplateDocument

var validateScreenshotTemplateDocument = screenshottemplates.Validate
