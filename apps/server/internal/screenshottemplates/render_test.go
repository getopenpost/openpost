package screenshottemplates

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func conversation(template string, texts ...string) ScreenshotTemplateDocument {
	people := []ScreenshotTemplatePerson{{ID: "me", Name: "Me"}, {ID: "ana", Name: "Ana Souza"}}
	if template == "group-chat" {
		for _, name := range []string{"Bia", "Caio", "Dani", "Edu"} {
			people = append(people, ScreenshotTemplatePerson{ID: strings.ToLower(name), Name: name})
		}
	}
	messages := make([]ScreenshotTemplateMessage, 0, len(texts))
	for i, text := range texts {
		sender := "ana"
		if i%3 == 1 {
			sender = "me"
		}
		messages = append(messages, ScreenshotTemplateMessage{ID: fmt.Sprintf("m%d", i), SenderID: sender, Text: text})
	}
	return ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: template, Title: "t", Appearance: "light", Frame: "natural", TextSize: "normal",
		Conversation: &ScreenshotTemplateConversation{Name: "Ana Souza", Timestamp: "Today 9:41", ShowHeader: true, ReadReceipt: "Read", SelfID: "me", People: people, Messages: messages}}
}

func sixMessages() ScreenshotTemplateDocument {
	return conversation("messages", "Hey, did the deploy go out?", "Yes, just now. Posts are rendering on the server.", "Nice, I'll check the schedule.", "Can you also send the receipt screenshot for the invoice?", "Sure thing, one second", "Thanks!")
}

func receiptDoc() ScreenshotTemplateDocument {
	return ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: "receipt", Title: "r", Appearance: "light", Frame: "natural", TextSize: "normal",
		Receipt: &ScreenshotTemplateReceipt{Business: "Blue Bottle Cafe", Address: "1 Market St\nSan Francisco", Timestamp: "Nov 28, 2026 9:41 AM", Order: "Order #1042", Currency: "USD", TaxPercent: 8.5, Footer: "Thank you!\nSee you soon",
			Items: []ScreenshotTemplateReceiptItem{{ID: "i1", Name: "Flat white", Quantity: 2, AmountCents: 475}, {ID: "i2", Name: "Almond croissant with a very long description that wraps", Quantity: 1, AmountCents: 395}}}}
}

func statusDoc() ScreenshotTemplateDocument {
	return ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: "status-page", Title: "s", Appearance: "light", Frame: "natural", TextSize: "normal",
		StatusPage: &ScreenshotTemplateStatus{Name: "Acme Status", Headline: "Elevated API errors", Severity: "degraded",
			Updates: []ScreenshotTemplateStatusUpdate{{ID: "u1", Stage: "Investigating", Text: "We are looking into elevated error rates.", Timestamp: "Nov 28, 09:41 UTC"}, {ID: "u2", Stage: "Resolved", Text: "Everything is back to normal.", Timestamp: "Nov 28, 10:12 UTC"}}}}
}

func render(t testing.TB, doc ScreenshotTemplateDocument, images ImageSource) Rendered {
	t.Helper()
	out, err := Render(context.Background(), doc, images, 2)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestEveryTemplateRendersAtWidth1080(t *testing.T) {
	for name, doc := range map[string]ScreenshotTemplateDocument{"messages": sixMessages(), "group": conversation("group-chat", "hi", "hello", "yo"), "receipt": receiptDoc(), "status": statusDoc()} {
		out := render(t, doc, nil)
		if out.Image.Bounds().Dx() != 1080 || out.Image.Bounds().Dy() < 200 {
			t.Errorf("%s: unexpected size %v", name, out.Image.Bounds())
		}
	}
}

func TestFramesPadShortContent(t *testing.T) {
	for frame, height := range map[string]int{"square": 1080, "portrait": 1350} {
		doc := receiptDoc()
		doc.Frame = frame
		doc.Receipt.Items = doc.Receipt.Items[:1]
		doc.Receipt.Footer, doc.Receipt.Address = "", ""
		if got := render(t, doc, nil).Image.Bounds().Dy(); got != height {
			t.Errorf("%s height = %d, want %d", frame, got, height)
		}
	}
}

func TestOverflowAndUnsupported(t *testing.T) {
	doc := conversation("messages", strings.Repeat("a long message that wraps ", 12), "b", "c", "d", "e", "f", "g")
	doc.Frame = "square"
	if _, err := Render(context.Background(), doc, nil, 2); !errors.Is(err, ErrOverflow) {
		t.Fatalf("err = %v, want ErrOverflow", err)
	}
	doc = receiptDoc()
	doc.TextSize = "large"
	doc.Receipt.Items = nil
	for i := 0; i < 40; i++ {
		doc.Receipt.Items = append(doc.Receipt.Items, ScreenshotTemplateReceiptItem{ID: fmt.Sprint(i), Name: strings.Repeat("word ", 40), Quantity: 1, AmountCents: 100})
	}
	if _, err := Render(context.Background(), doc, nil, 2); !errors.Is(err, ErrTooTall) {
		t.Fatalf("err = %v, want ErrTooTall", err)
	}
	meme := ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: "meme", Title: "m", Appearance: "light", Frame: "natural", TextSize: "normal",
		Meme: &ScreenshotTemplateMeme{TemplateID: "x", Name: "x", Captions: []string{"a"}, OverlayMediaIDs: []string{}, Format: "png"}}
	if _, err := Render(context.Background(), meme, nil, 2); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("err = %v, want ErrUnsupported", err)
	}
	if _, err := Render(context.Background(), sixMessages(), nil, 3); err == nil {
		t.Fatal("scale 3 must be rejected")
	}
}

func regionByID(t *testing.T, regions []Region, id string) Region {
	t.Helper()
	for _, r := range regions {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("missing region %s", id)
	return Region{}
}

func TestRegionsAndBubbleSides(t *testing.T) {
	doc := sixMessages()
	out := render(t, doc, nil)
	for _, m := range doc.Conversation.Messages {
		if r := regionByID(t, out.Regions, m.ID); r.Width <= 0 || r.Height <= 0 {
			t.Errorf("region %s has no size: %+v", m.ID, r)
		}
	}
	incoming, outgoing := regionByID(t, out.Regions, "m0"), regionByID(t, out.Regions, "m1")
	if outgoing.X <= incoming.X || outgoing.X+outgoing.Width < 500 {
		t.Errorf("outgoing %+v should sit right of incoming %+v", outgoing, incoming)
	}
}

func TestArabicBubbleAlignsRight(t *testing.T) {
	doc := conversation("messages", "hello", "مرحبا كيف حالك اليوم؟ هذه رسالة عربية طويلة قليلا لتلتف على أكثر من سطر واحد داخل الفقاعة")
	out := render(t, doc, nil)
	region := regionByID(t, out.Regions, "m1")
	if region.X+region.Width < 500 {
		t.Fatalf("outgoing region %+v should end near the right edge", region)
	}
	// Ink inside the bubble must reach the right padding for an RTL paragraph.
	rightInk := 0
	for y := int(region.Y * 2); y < int((region.Y+region.Height)*2); y++ {
		for x := int(region.X*2) + 10; x < int((region.X+region.Width)*2)-8; x++ {
			c := out.Image.RGBAAt(x, y)
			if c.R > 200 && c.G > 200 && c.B > 200 && x > int((region.X+region.Width)*2)-60 {
				rightInk++
			}
		}
	}
	if rightInk == 0 {
		t.Fatal("expected Arabic text ink near the bubble's right edge")
	}
}

func TestImageFailureFailsRender(t *testing.T) {
	doc := sixMessages()
	doc.Conversation.Messages[0].ImageMediaID = "missing"
	_, err := Render(context.Background(), doc, func(context.Context, string) (image.Image, error) { return nil, errors.New("boom") }, 2)
	if err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("err = %v", err)
	}
	if _, err := Render(context.Background(), doc, nil, 2); err == nil {
		t.Fatal("a missing image source must fail the render")
	}
}

func TestImagesRender(t *testing.T) {
	doc := sixMessages()
	doc.Conversation.People[1].AvatarMediaID = "avatar"
	doc.Conversation.Messages[0].ImageMediaID = "photo"
	source := func(context.Context, string) (image.Image, error) {
		img := image.NewRGBA(image.Rect(0, 0, 400, 300))
		for i := 0; i < len(img.Pix); i += 4 {
			img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = 220, 40, 40, 255
		}
		return img, nil
	}
	out := render(t, doc, source)
	photo := regionByID(t, out.Regions, "m0")
	if photo.Width != 300 {
		t.Fatalf("photo bubble width = %v", photo.Width)
	}
	c := out.Image.RGBAAt(int((photo.X+photo.Width/2)*2), int((photo.Y+20)*2))
	if c.R < 200 || c.G > 80 {
		t.Fatalf("photo pixel = %v", c)
	}
}

func TestMoneyFormatting(t *testing.T) {
	for _, tc := range []struct {
		cents    int
		currency string
		want     string
	}{{123450, "USD", "$1,234.50"}, {1200, "EUR", "€12.00"}, {300, "GBP", "£3.00"}, {500, "BRL", "R$5.00"}, {50000, "JPY", "¥500"}, {123456700, "JPY", "¥1,234,567"}, {5, "USD", "$0.05"}} {
		if got := receiptMoney(tc.cents, tc.currency); got != tc.want {
			t.Errorf("%d %s = %q, want %q", tc.cents, tc.currency, got, tc.want)
		}
	}
}

func TestColorEmojiRendersInColor(t *testing.T) {
	out := render(t, conversation("messages", "🎉🙂"), nil)
	region := regionByID(t, out.Regions, "m0")
	colored := 0
	for y := int(region.Y * 2); y < int((region.Y+region.Height)*2); y++ {
		for x := int(region.X * 2); x < int((region.X+region.Width)*2); x++ {
			c := out.Image.RGBAAt(x, y)
			if c.R > 200 && c.G > 150 && c.B < 90 || c.R > 200 && c.G < 80 && c.B > 100 {
				colored++
			}
		}
	}
	if colored < 50 {
		t.Fatalf("expected colored emoji pixels, got %d", colored)
	}
}

func TestEncoders(t *testing.T) {
	out := render(t, receiptDoc(), nil)
	if data, err := EncodePNG(out.Image); err != nil || len(data) < 100 {
		t.Fatal(err)
	}
	if data, err := EncodeJPEG(out.Image); err != nil || len(data) < 100 {
		t.Fatal(err)
	}
}

func TestWriteRenders(t *testing.T) {
	// Visual review aid: OPENPOST_WRITE_RENDERS=/some/dir writes every sample.
	dir := os.Getenv("OPENPOST_WRITE_RENDERS")
	if dir == "" {
		t.Skip("set OPENPOST_WRITE_RENDERS to an output directory")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	avatar := func(context.Context, string) (image.Image, error) {
		img := image.NewRGBA(image.Rect(0, 0, 600, 400))
		for y := 0; y < 400; y++ {
			for x := 0; x < 600; x++ {
				img.SetRGBA(x, y, color.RGBA{uint8(x / 3), uint8(y / 2), 160, 255})
			}
		}
		return img, nil
	}
	group := conversation("group-chat", "Who is bringing snacks?", "I can bring chips", "Great, I'll grab drinks", "Count me in for dessert", "See you all at 7", "Don't be late!")
	group.Conversation.People[2].AvatarMediaID = "a"
	group.Conversation.Messages[0].SenderID, group.Conversation.Messages[1].SenderID = "bia", "bia"
	photo := sixMessages()
	photo.Conversation.People[1].AvatarMediaID = "a"
	photo.Conversation.Messages[2].ImageMediaID = "p"
	arabic := conversation("messages", "مرحبا! كيف حالك؟", "أنا بخير، شكرا لك. وأنت؟ هذه رسالة طويلة قليلا لاختبار الالتفاف", "שלום, מה שלומך?", "Mixed English and عربي text")
	emoji := conversation("messages", "Launch day 🎉🚀", "We shipped it 🙂👍 ❤️", "👩‍💻 deploying…")
	docs := map[string]ScreenshotTemplateDocument{"messages": sixMessages(), "group": group, "photo": photo, "receipt": receiptDoc(), "status": statusDoc(), "arabic": arabic, "emoji": emoji}
	for name, doc := range docs {
		for _, appearance := range []string{"light", "dark"} {
			doc.Appearance = appearance
			out := render(t, doc, avatar)
			data, err := EncodePNG(out.Image)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, name+"-"+appearance+".png"), data, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestConversationSpeed(t *testing.T) {
	doc := sixMessages()
	render(t, doc, nil)
	start := time.Now()
	out := render(t, doc, nil)
	renderTime := time.Since(start)
	start = time.Now()
	if _, err := EncodeJPEG(out.Image); err != nil {
		t.Fatal(err)
	}
	t.Logf("render %v jpeg %v", renderTime, time.Since(start))
}

func BenchmarkRenderConversation(b *testing.B) {
	doc := sixMessages()
	render(b, doc, nil)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		render(b, doc, nil)
	}
}

func BenchmarkEncodeJPEG(b *testing.B) {
	out := render(b, sixMessages(), nil)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := EncodeJPEG(out.Image); err != nil {
			b.Fatal(err)
		}
	}
}
