package themes

import "math"

// Keep aligned with @openpost/dither's button opacity and texture contrast range.
const (
	maximumDitherOpacity         = .16
	minimumDitherTextureContrast = 1.18
	maximumDitherTextureContrast = 1.8
)

func validateDitherActionContrast(colors ThemeColorTokens, validation manifestValidation) error {
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
				if !balancedDitherAction(action.foreground, background, underlay, validation) {
					return invalidManifest("components.button", "dither texture must keep text at 4.5:1 and its two colors between 1.18:1 and 1.8:1 in every state")
				}
			}
		}
	}
	return nil
}

func balancedDitherAction(foreground, background, underlay string, validation manifestValidation) bool {
	ink, inkOK := parseSimpleColor(foreground)
	fill, fillOK := parseSimpleColor(background)
	base, baseOK := parseSimpleColor(underlay)
	if !inkOK || !fillOK || !baseOK || ink.a < .999 || base.a < .999 {
		return false
	}
	// Browser opacity composites encoded sRGB channels before WCAG luminance.
	backgroundChannel := func(fillChannel, baseChannel float64) float64 {
		return linearToGamma(fillChannel)*fill.a + linearToGamma(baseChannel)*(1-fill.a)
	}
	blend := func(inkChannel, fillChannel, baseChannel float64) float64 {
		backgroundChannel := backgroundChannel(fillChannel, baseChannel)
		return gammaToLinear(linearToGamma(inkChannel)*maximumDitherOpacity + backgroundChannel*(1-maximumDitherOpacity))
	}
	textLuminance := .2126*ink.r + .7152*ink.g + .0722*ink.b
	fillLuminance := .2126*blend(ink.r, fill.r, base.r) + .7152*blend(ink.g, fill.g, base.g) + .0722*blend(ink.b, fill.b, base.b)
	backgroundLuminance := .2126*gammaToLinear(backgroundChannel(fill.r, base.r)) + .7152*gammaToLinear(backgroundChannel(fill.g, base.g)) + .0722*gammaToLinear(backgroundChannel(fill.b, base.b))
	contrast := func(first, second float64) float64 {
		return (math.Max(first, second) + .05) / (math.Min(first, second) + .05)
	}
	textureRatio := contrast(backgroundLuminance, fillLuminance)
	if contrast(textLuminance, fillLuminance) < minimumTextContrast {
		return false
	}
	return validation == validateStoredManifest || (textureRatio >= minimumDitherTextureContrast && textureRatio <= maximumDitherTextureContrast)
}

func linearToGamma(value float64) float64 {
	if value <= .0031308 {
		return 12.92 * value
	}
	return 1.055*math.Pow(value, 1/2.4) - .055
}
