package handlers

import (
	"errors"
	"strings"
)

const screenshotTemplateSchemaVersion = 1
const screenshotTemplateRenderer = "openpost-screenshot-html-v1"

type ScreenshotTemplatePerson struct {
	ID            string `json:"id" minLength:"1" maxLength:"80"`
	Name          string `json:"name" maxLength:"100"`
	AvatarMediaID string `json:"avatar_media_id,omitempty" maxLength:"80"`
}

type ScreenshotTemplateMessage struct {
	ID           string `json:"id" minLength:"1" maxLength:"80"`
	SenderID     string `json:"sender_id" minLength:"1" maxLength:"80"`
	Text         string `json:"text" maxLength:"2000"`
	ImageMediaID string `json:"image_media_id,omitempty" maxLength:"80"`
}

type ScreenshotTemplateConversation struct {
	Name        string                      `json:"name" maxLength:"100"`
	Timestamp   string                      `json:"timestamp" maxLength:"100"`
	ShowHeader  bool                        `json:"show_header"`
	ReadReceipt string                      `json:"read_receipt" maxLength:"100"`
	SelfID      string                      `json:"self_id" minLength:"1" maxLength:"80"`
	People      []ScreenshotTemplatePerson  `json:"people" nullable:"false" minItems:"2" maxItems:"12"`
	Messages    []ScreenshotTemplateMessage `json:"messages" nullable:"false" minItems:"1" maxItems:"80"`
}

type ScreenshotTemplateReceiptItem struct {
	ID          string `json:"id" minLength:"1" maxLength:"80"`
	Name        string `json:"name" maxLength:"200"`
	Quantity    int    `json:"quantity" minimum:"1" maximum:"999"`
	AmountCents int    `json:"amount_cents" minimum:"0" maximum:"99999999"`
}

type ScreenshotTemplateReceipt struct {
	Business    string                          `json:"business" maxLength:"150"`
	Address     string                          `json:"address" maxLength:"300"`
	Timestamp   string                          `json:"timestamp" maxLength:"100"`
	Order       string                          `json:"order" maxLength:"100"`
	Currency    string                          `json:"currency" enum:"USD,EUR,GBP,BRL,JPY"`
	TaxPercent  float64                         `json:"tax_percent" minimum:"0" maximum:"100"`
	CustomTotal string                          `json:"custom_total" maxLength:"100"`
	Footer      string                          `json:"footer" maxLength:"500"`
	Items       []ScreenshotTemplateReceiptItem `json:"items" nullable:"false" minItems:"1" maxItems:"40"`
}

type ScreenshotTemplateStatusUpdate struct {
	ID        string `json:"id" minLength:"1" maxLength:"80"`
	Stage     string `json:"stage" maxLength:"80"`
	Text      string `json:"text" maxLength:"2000"`
	Timestamp string `json:"timestamp" maxLength:"100"`
}

type ScreenshotTemplateStatus struct {
	Name     string                           `json:"name" maxLength:"150"`
	Headline string                           `json:"headline" maxLength:"200"`
	Severity string                           `json:"severity" enum:"operational,degraded,outage"`
	Updates  []ScreenshotTemplateStatusUpdate `json:"updates" nullable:"false" minItems:"1" maxItems:"30"`
}

type ScreenshotTemplateDocument struct {
	SchemaVersion int                             `json:"schema_version" enum:"1"`
	TemplateID    string                          `json:"template_id" enum:"messages,group-chat,receipt,status-page"`
	Title         string                          `json:"title" minLength:"1" maxLength:"150"`
	Appearance    string                          `json:"appearance" enum:"light,dark"`
	Frame         string                          `json:"frame" enum:"natural,square,portrait"`
	TextSize      string                          `json:"text_size" enum:"small,normal,large"`
	Conversation  *ScreenshotTemplateConversation `json:"conversation,omitempty"`
	Receipt       *ScreenshotTemplateReceipt      `json:"receipt,omitempty"`
	StatusPage    *ScreenshotTemplateStatus       `json:"status_page,omitempty"`
}

func validateScreenshotTemplateDocument(doc ScreenshotTemplateDocument) error {
	if doc.SchemaVersion != screenshotTemplateSchemaVersion || strings.TrimSpace(doc.Title) == "" {
		return errors.New("template document version or title is invalid")
	}
	payloads := 0
	if doc.Conversation != nil {
		payloads++
	}
	if doc.Receipt != nil {
		payloads++
	}
	if doc.StatusPage != nil {
		payloads++
	}
	if payloads != 1 {
		return errors.New("a template requires exactly one content family")
	}
	switch doc.TemplateID {
	case "messages", "group-chat":
		return validateScreenshotConversation(doc.Conversation)
	case "receipt":
		return validateScreenshotReceipt(doc.Receipt)
	case "status-page":
		return validateScreenshotStatus(doc.StatusPage)
	default:
		return errors.New("template is not supported")
	}
}

func validateScreenshotConversation(conversation *ScreenshotTemplateConversation) error {
	if conversation == nil {
		return errors.New("a conversation template requires conversation content")
	}
	people := make(map[string]bool)
	for _, person := range conversation.People {
		if person.ID == "" || people[person.ID] {
			return errors.New("participant IDs must be unique")
		}
		people[person.ID] = true
	}
	if !people[conversation.SelfID] {
		return errors.New("the conversation must include its author")
	}
	ids := make(map[string]bool)
	for _, message := range conversation.Messages {
		if message.ID == "" || ids[message.ID] || !people[message.SenderID] {
			return errors.New("messages require unique IDs and an existing participant")
		}
		ids[message.ID] = true
	}
	return nil
}

func validateScreenshotReceipt(receipt *ScreenshotTemplateReceipt) error {
	if receipt == nil {
		return errors.New("a receipt template requires receipt content")
	}
	ids := make(map[string]bool)
	for _, item := range receipt.Items {
		if item.ID == "" || ids[item.ID] {
			return errors.New("receipt item IDs must be unique")
		}
		ids[item.ID] = true
	}
	return nil
}

func validateScreenshotStatus(status *ScreenshotTemplateStatus) error {
	if status == nil {
		return errors.New("a status template requires status content")
	}
	ids := make(map[string]bool)
	for _, update := range status.Updates {
		if update.ID == "" || ids[update.ID] {
			return errors.New("status update IDs must be unique")
		}
		ids[update.ID] = true
	}
	return nil
}
