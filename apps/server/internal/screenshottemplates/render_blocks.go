package screenshottemplates

import (
	"image"
	"image/color"
	"math"
	"strconv"
	"strings"
)

func receiptTotals(receipt *ScreenshotTemplateReceipt) (subtotal, tax, total int) {
	for _, item := range receipt.Items {
		subtotal += item.Quantity * item.AmountCents
	}
	tax = int(math.Floor(float64(subtotal)*receipt.TaxPercent/100 + 0.5))
	return subtotal, tax, subtotal + tax
}

// receiptMoney formats cents like Intl.NumberFormat("en-US", currency).
func receiptMoney(cents int, currency string) string {
	symbol := map[string]string{"USD": "$", "EUR": "€", "GBP": "£", "BRL": "R$", "JPY": "¥"}[currency]
	sign := ""
	if cents < 0 {
		sign, cents = "-", -cents
	}
	group := func(v int) string {
		digits := strconv.Itoa(v)
		var out []byte
		for i := range digits {
			if i > 0 && (len(digits)-i)%3 == 0 {
				out = append(out, ',')
			}
			out = append(out, digits[i])
		}
		return string(out)
	}
	if currency == "JPY" {
		return sign + symbol + group((cents+50)/100)
	}
	return sign + symbol + group(cents/100) + "." + strconv.Itoa(100 + cents%100)[1:]
}

func collapse(value string) string { return strings.Join(strings.Fields(value), " ") }

func (rc *renderContext) dashedRule(x, y, w float64) {
	scale := rc.scale
	rc.add(func(canvas *image.RGBA) {
		for dx := 0.0; dx < w; dx += 12 {
			shape := rr{(x + dx) * scale, y * scale, (x + math.Min(dx+6, w)) * scale, (y + 2) * scale, [4]float64{}}
			paintRR(canvas, shape, rc.pal.text, 1)
		}
	})
}

// receiptRow lays out a label and a right-aligned amount and returns its height.
func (rc *renderContext) receiptRow(x, y, w float64, label, amount string, st style, wrapOnOverflow bool) float64 {
	amountBlock := rc.layoutText([]span{{amount, st}}, w, false)
	labelBlock := rc.layoutText([]span{{label, st}}, w, false)
	if wrapOnOverflow && labelBlock.width+18+amountBlock.width > w {
		labelBlock = rc.layoutText([]span{{label, st}}, w, false)
		rc.text(labelBlock, x, y, w, alignStart)
		amountY := y + labelBlock.height() + 18
		rc.text(amountBlock, x, amountY, w, alignStart)
		return labelBlock.height() + 18 + amountBlock.height()
	}
	labelBlock = rc.layoutText([]span{{label, st}}, w-amountBlock.width-18, false)
	rc.text(labelBlock, x, y, w, alignStart)
	rc.text(amountBlock, x+w-amountBlock.width, y, amountBlock.width+2, alignStart)
	return math.Max(labelBlock.height(), amountBlock.height())
}

func (rc *renderContext) layoutReceipt(receipt *ScreenshotTemplateReceipt) (float64, error) {
	fs := rc.size * 0.8
	regular := rc.style(true, 400, fs, rc.pal.text, 1.5)
	bold := rc.style(true, 600, fs, rc.pal.text, 1.5)
	const x, w = 30.0, 480.0
	y := 38.0
	pending := 0.0
	if receipt.Business != "" {
		st := bold
		st.size, st.lhFactor = fs*1.3, 1.5
		block := rc.layoutText([]span{{receipt.Business, st}}, w, false)
		rc.text(block, x, y, w, alignCenter)
		y += block.height()
	}
	for _, line := range []string{receipt.Address, receipt.Timestamp, receipt.Order} {
		if line == "" {
			pending = math.Max(pending, 15)
			continue
		}
		y += math.Max(pending, 15)
		block := rc.layoutText([]span{{line, regular}}, w, false)
		rc.text(block, x, y, w, alignCenter)
		y += block.height()
		pending = 15
	}
	rule := func() {
		y += math.Max(pending, 25)
		rc.dashedRule(x, y, w)
		y += 2
		pending = 25
	}
	row := func(id, label, amount string, st style, top float64, wrap bool) {
		y += math.Max(pending, top)
		h := rc.receiptRow(x, y, w, label, amount, st, wrap)
		if id != "" {
			rc.region(id, x, y, w, h)
		}
		y += h
		pending = 13
	}
	rule()
	for _, item := range receipt.Items {
		if err := rc.ctx.Err(); err != nil {
			return 0, err
		}
		row(item.ID, collapse(strconv.Itoa(item.Quantity)+" "+item.Name), receiptMoney(item.Quantity*item.AmountCents, receipt.Currency), regular, 13, false)
	}
	rule()
	subtotal, tax, total := receiptTotals(receipt)
	row("", "Subtotal", receiptMoney(subtotal, receipt.Currency), regular, 13, false)
	row("", "Tax ("+strconv.FormatFloat(receipt.TaxPercent, 'f', -1, 64)+"%)", receiptMoney(tax, receipt.Currency), regular, 13, false)
	totalStyle := bold
	totalStyle.size = fs * 1.5
	amount := receipt.CustomTotal
	if amount == "" {
		amount = receiptMoney(total, receipt.Currency)
	}
	row("", "Total", amount, totalStyle, 23, true)
	rule()
	y += pending
	if receipt.Footer != "" {
		block := rc.layoutText([]span{{receipt.Footer, regular}}, w, false)
		rc.text(block, x, y, w, alignCenter)
		y += block.height()
	}
	return y + 38, nil
}

func (rc *renderContext) layoutStatus(status *ScreenshotTemplateStatus) (float64, error) {
	fs := rc.size * 0.7
	regular := rc.style(false, 400, fs, rc.pal.text, 1.5)
	bold := rc.style(false, 600, fs, rc.pal.text, 1.5)
	const x, w = 25.0, 490.0
	y := 32.0
	pill := rc.layoutText([]span{{"SUBSCRIBE TO UPDATES", style{fm: regular.fm, size: 9, spacing: 0.6, color: rc.pal.bg, lhFactor: 1.5}}}, 1000, false)
	pillWidth, pillHeight := pill.width+16, pill.height()+16
	nameStyle := bold
	nameStyle.size = fs * 1.6
	name := rc.layoutText([]span{{status.Name, nameStyle}}, w-pillWidth-20, false)
	headerHeight := math.Max(name.height(), pillHeight)
	rc.text(name, x, y+(headerHeight-name.height())/2, w-pillWidth-20, alignStart)
	rc.fillRR(x+w-pillWidth, y+(headerHeight-pillHeight)/2, pillWidth, pillHeight, uniformRadius(3), rc.pal.text, 1)
	rc.text(pill, x+w-pillWidth+8, y+(headerHeight-pillHeight)/2+8, pill.width+2, alignStart)
	y += headerHeight + 46

	incident := map[string]color.RGBA{"degraded": hex(0xad4610), "outage": hex(0xbd252c), "operational": hex(0x247148)}[status.Severity]
	boxTop := y
	y++
	inner := w - 2
	if strings.TrimSpace(status.Headline) != "" {
		st := bold
		st.size, st.color = fs*1.2, hex(0xffffff)
		block := rc.layoutText([]span{{status.Headline, st}}, inner-32, false)
		height := block.height() + 28
		rc.rect(x+1, y, inner, height, incident)
		rc.text(block, x+1+16, y+14, inner-32, alignStart)
		y += height
	}
	y += 17
	first := true
	for _, update := range status.Updates {
		if err := rc.ctx.Err(); err != nil {
			return 0, err
		}
		hasStage, hasText, hasTime := strings.TrimSpace(update.Stage) != "", strings.TrimSpace(update.Text) != "", strings.TrimSpace(update.Timestamp) != ""
		if !hasStage && !hasText && !hasTime {
			continue
		}
		if !first {
			y += 24
		}
		first = false
		start, height := y, 0.0
		if hasStage || hasText {
			var spans []span
			if hasStage {
				spans = append(spans, span{update.Stage, bold})
			}
			if hasStage && hasText {
				spans = append(spans, span{" · ", regular})
			}
			if hasText {
				spans = append(spans, span{update.Text, regular})
			}
			block := rc.layoutText(spans, inner-32, false)
			rc.text(block, x+1+16, y, inner-32, alignStart)
			height = block.height()
		}
		if hasTime {
			st := regular
			st.size, st.color = fs*0.86, rc.pal.muted
			block := rc.layoutText([]span{{update.Timestamp, st}}, inner-32, false)
			rc.text(block, x+1+16, start+height+5, inner-32, alignStart)
			height += 5 + block.height()
		}
		rc.region(update.ID, x+1+16, start, inner-32, height)
		y += height
	}
	y += 17
	boxHeight := y + 1 - boxTop
	// The border and box background must be painted beneath the content.
	rc.underlay(incident, x, boxTop, w, boxHeight)
	return y + 1 + 32, nil
}

// underlay paints a 1px bordered box before every previously recorded op.
func (rc *renderContext) underlay(border color.RGBA, x, y, w, h float64) {
	saved := rc.ops
	rc.ops = nil
	rc.rect(x, y, w, h, border)
	rc.rect(x+1, y+1, w-2, h-2, rc.pal.bg)
	rc.ops = append(rc.ops, saved...)
}
