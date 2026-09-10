package themes

import "math"

// Keep aligned with THEME_DITHER_MAX_OPACITY in the web theme contract.
const maximumDitherOpacity = .22

func validateDitherActionContrast(colors ThemeColorTokens) error {
	actions := []struct {
		foreground  string
		backgrounds [3]string
	}{
		{colors.ActionFocalInk, [3]string{colors.ActionFocal, colors.ActionFocalHover, colors.ActionFocalActive}},
		{colors.ActionPrimaryInk, [3]string{colors.ActionPrimary, colors.ActionPrimaryHover, colors.ActionPrimaryActive}},
		{colors.ActionOrdinaryInk, [3]string{colors.ActionOrdinary, colors.ActionOrdinaryHover, colors.ActionOrdinaryActive}},
	}
	for _, action := range actions {
		for _, background := range action.backgrounds {
			for _, underlay := range []string{colors.Canvas, colors.Surface} {
				if !readableDitherAction(action.foreground, background, underlay) {
					return invalidManifest("components.button", "dither texture must keep action text readable in every state at 4.5:1")
				}
			}
		}
	}
	return nil
}

func readableDitherAction(foreground, background, underlay string) bool {
	ink, inkOK := parseSimpleColor(foreground)
	fill, fillOK := parseSimpleColor(background)
	base, baseOK := parseSimpleColor(underlay)
	if !inkOK || !fillOK || !baseOK || ink.a < .999 || base.a < .999 {
		return false
	}
	// Browser opacity composites encoded sRGB channels before WCAG luminance.
	blend := func(inkChannel, fillChannel, baseChannel float64) float64 {
		backgroundChannel := linearToGamma(fillChannel)*fill.a + linearToGamma(baseChannel)*(1-fill.a)
		return gammaToLinear(linearToGamma(inkChannel)*maximumDitherOpacity + backgroundChannel*(1-maximumDitherOpacity))
	}
	textLuminance := .2126*ink.r + .7152*ink.g + .0722*ink.b
	fillLuminance := .2126*blend(ink.r, fill.r, base.r) + .7152*blend(ink.g, fill.g, base.g) + .0722*blend(ink.b, fill.b, base.b)
	ratio := (math.Max(textLuminance, fillLuminance) + .05) / (math.Min(textLuminance, fillLuminance) + .05)
	return ratio >= minimumTextContrast
}

func linearToGamma(value float64) float64 {
	if value <= .0031308 {
		return 12.92 * value
	}
	return 1.055*math.Pow(value, 1/2.4) - .055
}
