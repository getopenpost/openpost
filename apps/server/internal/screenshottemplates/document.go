package screenshottemplates

import (
	"errors"
	"math"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/openpost/backend/internal/memes"
)

const SchemaVersion = 1

// Renderer identifies the server renderer on saved export recipes.
const Renderer = "openpost-screenshot-go-v1"

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

type ScreenshotTemplateMeme struct {
	TemplateID      string   `json:"template_id" minLength:"1" maxLength:"80"`
	Name            string   `json:"name" minLength:"1" maxLength:"150"`
	Captions        []string `json:"captions" nullable:"false" minItems:"1" maxItems:"16" maxLength:"200"`
	OverlaySlots    int      `json:"overlay_slots" minimum:"0" maximum:"8"`
	OverlayMediaIDs []string `json:"overlay_media_ids" nullable:"false" maxItems:"8" maxLength:"80"`
	Format          string   `json:"format" enum:"png,webp,gif"`
	AltText         string   `json:"alt_text,omitempty" maxLength:"500"`
	ParentMediaID   string   `json:"parent_media_id,omitempty" maxLength:"80"`
}

type ScreenshotTemplateDocument struct {
	Meme          *ScreenshotTemplateMeme         `json:"meme,omitempty"`
	SchemaVersion int                             `json:"schema_version" enum:"1"`
	TemplateID    string                          `json:"template_id" enum:"messages,group-chat,receipt,status-page,meme"`
	Title         string                          `json:"title" minLength:"1" maxLength:"150"`
	Appearance    string                          `json:"appearance" enum:"light,dark"`
	Frame         string                          `json:"frame" enum:"natural,square,portrait"`
	TextSize      string                          `json:"text_size" enum:"small,normal,large"`
	Conversation  *ScreenshotTemplateConversation `json:"conversation,omitempty"`
	Receipt       *ScreenshotTemplateReceipt      `json:"receipt,omitempty"`
	StatusPage    *ScreenshotTemplateStatus       `json:"status_page,omitempty"`
}

func Validate(doc ScreenshotTemplateDocument) error {
	if doc.SchemaVersion != SchemaVersion || strings.TrimSpace(doc.Title) == "" || utf8.RuneCountInString(doc.Title) > 150 {
		return errors.New("template document version or title is invalid")
	}
	if !slices.Contains([]string{"light", "dark"}, doc.Appearance) || !slices.Contains([]string{"natural", "square", "portrait"}, doc.Frame) || !slices.Contains([]string{"small", "normal", "large"}, doc.TextSize) {
		return errors.New("template appearance is invalid")
	}
	payloads := 0
	for _, present := range []bool{doc.Meme != nil, doc.Conversation != nil, doc.Receipt != nil, doc.StatusPage != nil} {
		if present {
			payloads++
		}
	}
	if payloads != 1 {
		return errors.New("a template requires exactly one content family")
	}
	switch doc.TemplateID {
	case "meme":
		return validateScreenshotMeme(doc.Meme)
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

func validateScreenshotMeme(meme *ScreenshotTemplateMeme) error {
	if err := validateScreenshotMemeRecipe(meme); err != nil {
		return err
	}
	for _, caption := range meme.Captions {
		if memes.ValidateCaption(caption) != nil {
			return errors.New("meme caption is invalid")
		}
	}
	for _, id := range meme.OverlayMediaIDs {
		if strings.TrimSpace(id) == "" || !bounded(id, 80) {
			return errors.New("meme image slots must be filled in order")
		}
	}
	return nil
}

func validateScreenshotMemeRecipe(meme *ScreenshotTemplateMeme) error {
	if meme == nil || strings.TrimSpace(meme.TemplateID) == "" || meme.OverlaySlots < len(meme.OverlayMediaIDs) || meme.OverlaySlots > 8 || meme.OverlaySlots < 0 || len(meme.Captions) < 1 || len(meme.Captions) > 16 || !slices.Contains([]string{"png", "webp", "gif"}, meme.Format) || !bounded(meme.TemplateID, 80) || !bounded(meme.Name, 150) || !bounded(meme.AltText, 500) || !bounded(meme.ParentMediaID, 80) {
		return errors.New("a meme requires a template and valid image slots")
	}
	return nil
}

func validateScreenshotConversation(conversation *ScreenshotTemplateConversation) error {
	if conversation == nil || len(conversation.People) < 2 || len(conversation.People) > 12 || len(conversation.Messages) < 1 || len(conversation.Messages) > 80 || !bounded(conversation.Name, 100) || !bounded(conversation.Timestamp, 100) || !bounded(conversation.ReadReceipt, 100) {
		return errors.New("a conversation template requires conversation content")
	}
	people, err := validateScreenshotParticipants(conversation.People, conversation.SelfID)
	if err != nil {
		return err
	}
	return validateScreenshotMessages(conversation.Messages, people)
}

func validateScreenshotParticipants(participants []ScreenshotTemplatePerson, selfID string) (map[string]bool, error) {
	people := make(map[string]bool)
	for _, person := range participants {
		if person.ID == "" || people[person.ID] || !bounded(person.ID, 80) || !bounded(person.Name, 100) || !bounded(person.AvatarMediaID, 80) {
			return nil, errors.New("participant IDs must be unique")
		}
		people[person.ID] = true
	}
	if !people[selfID] {
		return nil, errors.New("the conversation must include its author")
	}
	return people, nil
}

func validateScreenshotMessages(messages []ScreenshotTemplateMessage, people map[string]bool) error {
	ids := make(map[string]bool)
	for _, message := range messages {
		if message.ID == "" || ids[message.ID] || !people[message.SenderID] || !bounded(message.ID, 80) || !bounded(message.Text, 2000) || !bounded(message.ImageMediaID, 80) {
			return errors.New("messages require unique IDs and an existing participant")
		}
		ids[message.ID] = true
	}
	return nil
}

func validateScreenshotReceipt(receipt *ScreenshotTemplateReceipt) error {
	if receipt == nil || len(receipt.Items) < 1 || len(receipt.Items) > 40 || !slices.Contains([]string{"USD", "EUR", "GBP", "BRL", "JPY"}, receipt.Currency) || receipt.TaxPercent < 0 || receipt.TaxPercent > 100 || math.IsNaN(receipt.TaxPercent) || !bounded(receipt.Business, 150) || !bounded(receipt.Address, 300) || !bounded(receipt.Timestamp, 100) || !bounded(receipt.Order, 100) || !bounded(receipt.CustomTotal, 100) || !bounded(receipt.Footer, 500) {
		return errors.New("a receipt template requires receipt content")
	}
	return validateScreenshotReceiptItems(receipt.Items)
}

func validateScreenshotReceiptItems(items []ScreenshotTemplateReceiptItem) error {
	ids := make(map[string]bool)
	for _, item := range items {
		if item.ID == "" || ids[item.ID] || !bounded(item.ID, 80) || !bounded(item.Name, 200) || item.Quantity < 1 || item.Quantity > 999 || item.AmountCents < 0 || item.AmountCents > 99999999 {
			return errors.New("receipt item IDs must be unique")
		}
		ids[item.ID] = true
	}
	return nil
}

func validateScreenshotStatus(status *ScreenshotTemplateStatus) error {
	if status == nil || len(status.Updates) < 1 || len(status.Updates) > 30 || !slices.Contains([]string{"operational", "degraded", "outage"}, status.Severity) || !bounded(status.Name, 150) || !bounded(status.Headline, 200) {
		return errors.New("a status template requires status content")
	}
	ids := make(map[string]bool)
	for _, update := range status.Updates {
		if update.ID == "" || ids[update.ID] || !bounded(update.ID, 80) || !bounded(update.Stage, 80) || !bounded(update.Text, 2000) || !bounded(update.Timestamp, 100) {
			return errors.New("status update IDs must be unique")
		}
		ids[update.ID] = true
	}
	return nil
}

func bounded(value string, maximum int) bool { return utf8.RuneCountInString(value) <= maximum }

func MediaIDs(doc ScreenshotTemplateDocument) []string {
	var ids []string
	if doc.Meme != nil {
		ids = append(ids, doc.Meme.OverlayMediaIDs...)
		if doc.Meme.ParentMediaID != "" {
			ids = append(ids, doc.Meme.ParentMediaID)
		}
	}
	if doc.Conversation != nil {
		for _, person := range doc.Conversation.People {
			if person.AvatarMediaID != "" {
				ids = append(ids, person.AvatarMediaID)
			}
		}
		for _, message := range doc.Conversation.Messages {
			if message.ImageMediaID != "" {
				ids = append(ids, message.ImageMediaID)
			}
		}
	}
	slices.Sort(ids)
	return slices.Compact(ids)
}
