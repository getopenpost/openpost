package screenshottemplates

import (
	"image"
	"strings"
	"unicode"
)

func uniformRadius(r float64) [4]float64 { return [4]float64{r, r, r, r} }

func (rc *renderContext) layoutChat(doc ScreenshotTemplateDocument) (float64, error) {
	chat := doc.Conversation
	group := doc.TemplateID == "group-chat"
	y := 0.0
	if chat.ShowHeader {
		h, err := rc.chatHeader(chat, group)
		if err != nil {
			return 0, err
		}
		y = h
	}
	people := map[string]ScreenshotTemplatePerson{}
	for _, person := range chat.People {
		people[person.ID] = person
	}
	y += 20
	margin := 0.0
	if chat.Timestamp != "" {
		block := rc.layoutText([]span{{chat.Timestamp, rc.style(false, 400, 17, rc.pal.muted, 1.24)}}, 496, false)
		rc.text(block, 22, y, 496, alignCenter)
		y += block.height()
		margin = 19
	}
	messages := chat.Messages
	for index, message := range messages {
		if err := rc.ctx.Err(); err != nil {
			return 0, err
		}
		outgoing := message.SenderID == chat.SelfID
		grouped := index > 0 && messages[index-1].SenderID == message.SenderID
		last := index+1 >= len(messages) || messages[index+1].SenderID != message.SenderID
		sender := people[message.SenderID]
		gap := 13.0
		if grouped {
			gap = 4
		}
		y += max(margin, gap)
		margin = 0
		bottom, err := rc.chatMessage(message, sender, outgoing, grouped, last, group, y)
		if err != nil {
			return 0, err
		}
		y = bottom
	}
	if chat.ReadReceipt != "" && messages[len(messages)-1].SenderID == chat.SelfID {
		y += 7
		block := rc.layoutText([]span{{chat.ReadReceipt, rc.style(false, 400, 14, rc.pal.muted, 1.24)}}, 496, false)
		rc.text(block, 22, y, 496, alignEnd)
		y += block.height()
	}
	return y + 26, nil
}

func (rc *renderContext) chatMessage(message ScreenshotTemplateMessage, sender ScreenshotTemplatePerson, outgoing, grouped, last, group bool, top float64) (float64, error) {
	hasAvatar := sender.AvatarMediaID != ""
	pad := 0.0
	if hasAvatar {
		pad = 44
	}
	available := 496 - pad
	y := top
	if group && !outgoing && !grouped {
		block := rc.layoutText([]span{{sender.Name, rc.style(false, 400, 14, rc.pal.muted, 1.24)}}, available-30, false)
		rc.text(block, 22+pad+15, y, available-30, alignStart)
		y += block.height() + 4
	}
	body := message.Text
	if body == "" && message.ImageMediaID == "" {
		body = " "
	}
	textColor, bubbleColor := rc.pal.text, rc.pal.bubble
	if outgoing {
		textColor, bubbleColor = hex(0xffffff), accentBlue
	}
	bodyStyle := rc.style(false, 400, rc.size, textColor, 1.24)
	var width, height, imageHeight float64
	var photo image.Image
	var shaped *shapedText
	var block *textBlock
	if message.ImageMediaID != "" {
		img, err := rc.image(message.ImageMediaID)
		if err != nil {
			return 0, err
		}
		photo = img
		bounds := img.Bounds()
		imageHeight = min(380, 300*float64(bounds.Dy())/float64(bounds.Dx()))
		width, height = 300, imageHeight
		if body != "" {
			block = rc.layoutText([]span{{body, bodyStyle}}, 266, true)
			height += 22 + block.height()
		}
	} else {
		shaped = rc.shape([]span{{body, bodyStyle}}, true)
		width = max(32, min(shaped.maxContent()+34, 0.82*available))
		block = shaped.wrap(width - 34)
		height = 22 + block.height()
	}
	x := 22 + pad
	if outgoing {
		x = 540 - 22 - pad - width
	}
	bottom := y + height
	if hasAvatar && last {
		img, err := rc.image(sender.AvatarMediaID)
		if err != nil {
			return 0, err
		}
		ax := 22.0
		if outgoing {
			ax = 540 - 22 - 29
		}
		rc.picture(img, ax, bottom-29, 29, 29, uniformRadius(14.5), fitCover)
	}
	rc.fillRR(x, y, width, height, uniformRadius(24), bubbleColor, 1)
	if last && photo == nil {
		// iMessage tail: a square-cornered base plus a background cut-out.
		if outgoing {
			rc.fillRR(x+width-22+7, bottom-21, 22, 21, [4]float64{0, 0, 0, 18}, bubbleColor, 1)
			rc.fillRR(x+width, bottom-23, 13, 23, [4]float64{0, 0, 0, 13}, rc.pal.bg, 1)
		} else {
			rc.fillRR(x-7, bottom-21, 22, 21, [4]float64{0, 0, 18, 0}, bubbleColor, 1)
			rc.fillRR(x-13, bottom-23, 13, 23, [4]float64{0, 0, 13, 0}, rc.pal.bg, 1)
		}
	}
	if photo != nil {
		rc.picture(photo, x, y, width, imageHeight, [4]float64{24, 24, 0, 0}, fitContain)
	}
	if block != nil {
		textTop := y + 11
		if photo != nil {
			textTop = y + imageHeight + 11
		}
		rc.text(block, x+17, textTop, width-34, alignStart)
	}
	rc.region(message.ID, x, y, width, height)
	return bottom, nil
}

func (rc *renderContext) chatHeader(chat *ScreenshotTemplateConversation, group bool) (float64, error) {
	const top, bottomPad = 17.0, 12.0
	back := rc.layoutText([]span{{"‹", rc.style(false, 300, 55, accentBlue, 1.24)}}, 100, false)
	backWidth := back.width
	nameWidthMax := 488 - backWidth - 36 - 32
	chevron := rc.style(false, 400, 18, chevronGrey, 1.24)
	name := rc.layoutText([]span{{chat.Name + " ", rc.style(false, 400, 18, rc.pal.text, 1.24)}, {"›", chevron}}, nameWidthMax, false)
	avatarWidth := 65.0
	people := chat.People
	count := min(4, len(people))
	extra := len(people) - 4
	var countBlock *textBlock
	if group {
		avatarWidth = 8 + 33*float64(count) + 8
		if extra > 0 {
			countBlock = rc.layoutText([]span{{"+" + itoa(extra), rc.style(false, 400, 13, rc.pal.text, 1.24)}}, 100, false)
			avatarWidth = 8 + 33*float64(count) + 12 + countBlock.width + 8
		}
	}
	contactWidth := max(avatarWidth, name.width)
	contactHeight := 65 + 7 + name.height()
	rowHeight := max(contactHeight, back.height(), 30)
	free := 488 - backWidth - contactWidth - 36
	contactX := 26 + backWidth + free/2
	headerHeight := top + rowHeight + bottomPad + 1
	rc.rect(0, 0, 540, headerHeight, rc.pal.panel)
	rc.fillRR(0, headerHeight-1, 540, 1, [4]float64{}, hex(0xb5b5b5), 0x55/255.0)
	rc.text(back, 26, top+(rowHeight-back.height())/2, backWidth+4, alignStart)
	contactY := top + (rowHeight-contactHeight)/2
	avatarX := contactX + (contactWidth-avatarWidth)/2
	if group {
		for i := 0; i < count; i++ {
			person := people[i]
			ax := avatarX + 33*float64(i)
			ay := contactY + 8
			rc.circle(ax, ay, 49, rc.pal.panel)
			if err := rc.avatar(person.AvatarMediaID, strings.ToUpper(firstRunes(person.Name, 1)), ax+2, ay+2, 45, 22); err != nil {
				return 0, err
			}
		}
		if countBlock != nil {
			rc.text(countBlock, avatarX+8+33*float64(count)+12, contactY+(65-countBlock.height())/2, countBlock.width+2, alignStart)
		}
	} else {
		var mediaID string
		for _, person := range people {
			if person.ID != chat.SelfID {
				mediaID = person.AvatarMediaID
				break
			}
		}
		var initials string
		for i, word := range strings.FieldsFunc(chat.Name, unicode.IsSpace) {
			if i < 2 {
				initials += firstRunes(word, 1)
			}
		}
		if err := rc.avatar(mediaID, strings.ToUpper(initials), contactX+(contactWidth-65)/2, contactY, 65, 29); err != nil {
			return 0, err
		}
	}
	rc.text(name, contactX+(contactWidth-name.width)/2, contactY+72, name.width+2, alignCenter)
	rc.videoIcon(540-26-36, top+(rowHeight-30)/2)
	return headerHeight, nil
}

// avatar paints a circle with an image or white initials.
func (rc *renderContext) avatar(mediaID, initials string, x, y, d, fontSize float64) error {
	if mediaID != "" {
		img, err := rc.image(mediaID)
		if err != nil {
			return err
		}
		rc.picture(img, x, y, d, d, uniformRadius(d/2), fitCover)
		return nil
	}
	rc.circle(x, y, d, avatarGrey)
	if initials != "" {
		block := rc.layoutText([]span{{initials, rc.style(false, 400, fontSize, hex(0xffffff), 1.24)}}, d, false)
		rc.text(block, x, y+(d-block.height())/2, d, alignCenter)
	}
	return nil
}

func (rc *renderContext) videoIcon(x, y float64) {
	k := rc.scale
	rc.add(func(canvas *image.RGBA) {
		outer := rr{(x + 1.5 - 1.25) * k, (y + 4 - 1.25) * k, (x + 24.5 + 1.25) * k, (y + 26 + 1.25) * k, uniformRadius(6.25 * k)}
		inner := rr{(x + 1.5 + 1.25) * k, (y + 4 + 1.25) * k, (x + 24.5 - 1.25) * k, (y + 26 - 1.25) * k, uniformRadius(3.75 * k)}
		paintShape(canvas, outer.bounds(canvas.Bounds()), accentBlue, 1, func(px, py int) float64 {
			return outer.cov(px, py) * (1 - inner.cov(px, py))
		})
		p := func(dx, dy float64) [2]float64 { return [2]float64{(x + dx) * k, (y + dy) * k} }
		strokePolyline(canvas, [][2]float64{p(25, 11), p(34, 5), p(34, 25), p(25, 19), p(25, 11)}, 2.5*k, accentBlue)
	})
}

func firstRunes(value string, n int) string {
	runes := []rune(value)
	if len(runes) > n {
		runes = runes[:n]
	}
	return string(runes)
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	var digits []byte
	for ; v > 0; v /= 10 {
		digits = append([]byte{byte('0' + v%10)}, digits...)
	}
	return string(digits)
}
