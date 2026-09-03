package themes

import (
	"fmt"
	"math"
	"reflect"
	"strconv"
	"strings"
)

const (
	minimumTextContrast  = 4.5
	minimumFocusContrast = 3.0
	minimumStateDistance = .014
)

type linearColor struct {
	r, g, b, a float64
}

//nolint:gocyclo // Every semantic color role is intentionally enumerated for complete fail-closed validation.
func validateColorTokens(colors ThemeColorTokens) error {
	value := reflect.ValueOf(colors)
	typeOf := value.Type()
	for index := 0; index < value.NumField(); index++ {
		name := strings.Split(typeOf.Field(index).Tag.Get("json"), ",")[0]
		if !validCSSColor(strings.TrimSpace(value.Field(index).String())) {
			return invalidManifest("colors."+name, "contains an unsafe or missing value")
		}
	}
	pairs := []struct {
		path                   string
		background, foreground string
		underlay               string
		minimum                float64
	}{
		{"canvasInk", colors.Canvas, colors.Ink, colors.Canvas, minimumTextContrast},
		{"surfaceInk", colors.Surface, colors.Ink, colors.Canvas, minimumTextContrast},
		{"mutedInk", colors.Canvas, colors.MutedInk, colors.Canvas, minimumTextContrast},
		{"brandInk", colors.Brand, colors.BrandInk, colors.Canvas, minimumTextContrast},
		{"workspaceInk", colors.Workspace, colors.WorkspaceInk, colors.Canvas, minimumTextContrast},
		{"selectionInk", colors.Selection, colors.SelectionInk, colors.Canvas, minimumTextContrast},
		{"dangerInk", colors.Danger, colors.DangerInk, colors.Canvas, minimumTextContrast},
		{"successInk", colors.Success, colors.SuccessInk, colors.Canvas, minimumTextContrast},
		{"warningInk", colors.Warning, colors.WarningInk, colors.Canvas, minimumTextContrast},
		{"infoInk", colors.Info, colors.InfoInk, colors.Canvas, minimumTextContrast},
		{"link", colors.Canvas, colors.Link, colors.Canvas, minimumTextContrast},
		{"disabledInk", colors.Disabled, colors.DisabledInk, colors.Canvas, minimumFocusContrast},
		{"fieldInk", colors.Field, colors.FieldInk, colors.Canvas, minimumTextContrast},
		{"fieldHoverInk", colors.FieldHover, colors.FieldInk, colors.Canvas, minimumTextContrast},
		{"fieldFocusInk", colors.FieldFocus, colors.FieldInk, colors.Canvas, minimumTextContrast},
		{"fieldDisabledInk", colors.FieldDisabled, colors.FieldDisabledInk, colors.Canvas, minimumFocusContrast},
		{"navigationActiveInk", colors.NavigationActive, colors.NavigationActiveInk, colors.Canvas, minimumTextContrast},
		{"sidebarInk", colors.Sidebar, colors.SidebarInk, colors.Canvas, minimumTextContrast},
		{"sidebarActiveInk", colors.SidebarActive, colors.SidebarActiveInk, colors.Sidebar, minimumTextContrast},
		{"chromeInk", colors.Chrome, colors.ChromeInk, colors.Canvas, minimumTextContrast},
	}
	for _, pair := range pairs {
		ratio, ok := contrastRatioOn(pair.background, pair.foreground, pair.underlay)
		if !ok || ratio < pair.minimum {
			return invalidManifest("colors."+pair.path, fmt.Sprintf("must have independently computed contrast of at least %.1f:1", pair.minimum))
		}
	}
	actions := []struct {
		path                   string
		foreground             string
		resting, hover, active string
	}{
		{"actionFocalInk", colors.ActionFocalInk, colors.ActionFocal, colors.ActionFocalHover, colors.ActionFocalActive},
		{"actionPrimaryInk", colors.ActionPrimaryInk, colors.ActionPrimary, colors.ActionPrimaryHover, colors.ActionPrimaryActive},
		{"actionOrdinaryInk", colors.ActionOrdinaryInk, colors.ActionOrdinary, colors.ActionOrdinaryHover, colors.ActionOrdinaryActive},
		{"actionQuietInk", colors.ActionQuietInk, colors.ActionQuiet, colors.ActionQuietHover, colors.ActionQuietActive},
		{"actionDestructiveInk", colors.ActionDestructiveInk, colors.ActionDestructive, colors.ActionDestructiveHover, colors.ActionDestructiveActive},
	}
	for _, action := range actions {
		for _, background := range []string{action.resting, action.hover, action.active} {
			for _, underlay := range []string{colors.Canvas, colors.Surface} {
				ratio, ok := contrastRatioOn(background, action.foreground, underlay)
				if !ok || ratio < minimumTextContrast {
					return invalidManifest("colors."+action.path, fmt.Sprintf("must remain readable in every interaction state at %.1f:1", minimumTextContrast))
				}
			}
		}
	}
	for _, link := range []struct {
		path, foreground string
	}{{"actionLink", colors.ActionLink}, {"actionLinkHover", colors.ActionLinkHover}} {
		for _, background := range []string{colors.Canvas, colors.Surface} {
			ratio, ok := contrastRatioOn(background, link.foreground, background)
			if !ok || ratio < minimumTextContrast {
				return invalidManifest("colors."+link.path, fmt.Sprintf("must remain readable at %.1f:1", minimumTextContrast))
			}
		}
	}
	for _, surface := range []struct {
		path  string
		color string
	}{{"canvas", colors.Canvas}, {"surface", colors.Surface}, {"field", colors.Field}, {"sidebar", colors.Sidebar}, {"actionOrdinary", colors.ActionOrdinary}} {
		ratio, ok := contrastRatio(surface.color, colors.Focus)
		if !ok || ratio < minimumFocusContrast {
			return invalidManifest("colors.focus", fmt.Sprintf("must remain visible against %s at %.1f:1", surface.path, minimumFocusContrast))
		}
	}
	for _, focalState := range []string{colors.ActionFocal, colors.ActionFocalHover, colors.ActionFocalActive} {
		if !perceptiblyDistinct(colors.Focus, focalState, colors.Canvas) {
			return invalidManifest("colors.focus", "must remain distinct from every focal action state")
		}
	}
	statuses := []struct {
		path                   string
		background, foreground string
	}{
		{"danger", colors.Danger, colors.DangerInk},
		{"success", colors.Success, colors.SuccessInk},
		{"warning", colors.Warning, colors.WarningInk},
		{"info", colors.Info, colors.InfoInk},
	}
	for first := range statuses {
		for second := first + 1; second < len(statuses); second++ {
			if !perceptiblyDistinct(statuses[first].background, statuses[second].background, colors.Canvas) &&
				!perceptiblyDistinct(statuses[first].foreground, statuses[second].foreground, colors.Canvas) {
				return invalidManifest("colors."+statuses[second].path, "must remain distinct from "+statuses[first].path)
			}
		}
	}
	states := []struct {
		path                string
		base, hover, active string
	}{
		{"actionFocal", colors.ActionFocal, colors.ActionFocalHover, colors.ActionFocalActive},
		{"actionPrimary", colors.ActionPrimary, colors.ActionPrimaryHover, colors.ActionPrimaryActive},
		{"actionOrdinary", colors.ActionOrdinary, colors.ActionOrdinaryHover, colors.ActionOrdinaryActive},
		{"actionQuiet", colors.ActionQuiet, colors.ActionQuietHover, colors.ActionQuietActive},
		{"actionDestructive", colors.ActionDestructive, colors.ActionDestructiveHover, colors.ActionDestructiveActive},
	}
	for _, state := range states {
		if !perceptiblyDistinct(state.base, state.hover, colors.Canvas) || !perceptiblyDistinct(state.base, state.active, colors.Canvas) || !perceptiblyDistinct(state.hover, state.active, colors.Canvas) {
			return invalidManifest("colors."+state.path, "must have distinct resting, hover, and active states")
		}
	}
	for _, safe := range []struct {
		path       string
		background string
		foreground string
	}{{"actionFocal", colors.ActionFocal, colors.ActionFocalInk}, {"actionPrimary", colors.ActionPrimary, colors.ActionPrimaryInk}, {"actionOrdinary", colors.ActionOrdinary, colors.ActionOrdinaryInk}, {"success", colors.Success, colors.SuccessInk}} {
		if !perceptiblyDistinct(colors.ActionDestructive, safe.background, colors.Canvas) && !perceptiblyDistinct(colors.ActionDestructiveInk, safe.foreground, colors.Canvas) {
			return invalidManifest("colors.actionDestructive", "must remain distinct from "+safe.path)
		}
	}
	return nil
}

func validCSSColor(value string) bool {
	if unsafeCSSValue(value) || !balancedParentheses(value) {
		return false
	}
	_, ok := parseSimpleColor(value)
	return ok
}

func contrastRatio(first, second string) (float64, bool) {
	a, ok := parseSimpleColor(first)
	if !ok || a.a < 0.999 {
		return 0, false
	}
	b, ok := parseSimpleColor(second)
	if !ok || b.a < 0.999 {
		return 0, false
	}
	l1 := .2126*a.r + .7152*a.g + .0722*a.b
	l2 := .2126*b.r + .7152*b.g + .0722*b.b
	return (math.Max(l1, l2) + .05) / (math.Min(l1, l2) + .05), true
}

func contrastRatioOn(background, foreground, underlay string) (float64, bool) {
	backgroundColor, ok := parseSimpleColor(background)
	if !ok {
		return 0, false
	}
	foregroundColor, ok := parseSimpleColor(foreground)
	if !ok || foregroundColor.a < 0.999 {
		return 0, false
	}
	underlayColor, ok := parseSimpleColor(underlay)
	if !ok || underlayColor.a < 0.999 {
		return 0, false
	}
	backgroundColor = compositeColor(backgroundColor, underlayColor)
	l1 := .2126*backgroundColor.r + .7152*backgroundColor.g + .0722*backgroundColor.b
	l2 := .2126*foregroundColor.r + .7152*foregroundColor.g + .0722*foregroundColor.b
	return (math.Max(l1, l2) + .05) / (math.Min(l1, l2) + .05), true
}

func parseSimpleColor(value string) (linearColor, bool) {
	value = strings.TrimSpace(value)
	switch value {
	case "black":
		return linearColor{a: 1}, true
	case "white":
		return linearColor{r: 1, g: 1, b: 1, a: 1}, true
	case "transparent":
		return linearColor{}, true
	}
	if strings.HasPrefix(value, "#") {
		return parseHexColor(value)
	}
	if strings.HasPrefix(value, "oklch(") {
		return parseOKLCH(value)
	}
	if strings.HasPrefix(value, "oklab(") {
		return parseOKLab(value)
	}
	if strings.HasPrefix(value, "rgb(") || strings.HasPrefix(value, "rgba(") {
		return parseRGB(value)
	}
	if strings.HasPrefix(value, "color-mix(") {
		return parseColorMix(value)
	}
	return linearColor{}, false
}

//nolint:gocyclo // This parser accepts one deliberately small color-mix grammar and rejects every ambiguous form.
func parseColorMix(value string) (linearColor, bool) {
	if !strings.HasPrefix(value, "color-mix(") || !strings.HasSuffix(value, ")") {
		return linearColor{}, false
	}
	parts := splitTopLevel(strings.TrimSuffix(strings.TrimPrefix(value, "color-mix("), ")"), ',')
	if len(parts) != 3 || strings.TrimSpace(parts[0]) != "in oklch" {
		return linearColor{}, false
	}
	first, firstWeight, firstSet, ok := parseColorMixStop(parts[1])
	if !ok {
		return linearColor{}, false
	}
	second, secondWeight, secondSet, ok := parseColorMixStop(parts[2])
	if !ok {
		return linearColor{}, false
	}
	switch {
	case !firstSet && !secondSet:
		firstWeight, secondWeight = .5, .5
	case firstSet && !secondSet:
		secondWeight = 1 - firstWeight
	case !firstSet && secondSet:
		firstWeight = 1 - secondWeight
	}
	if firstWeight < 0 || secondWeight < 0 || firstWeight+secondWeight <= 0 {
		return linearColor{}, false
	}
	total := firstWeight + secondWeight
	firstWeight /= total
	secondWeight /= total
	alpha := firstWeight*first.a + secondWeight*second.a
	if alpha == 0 {
		return linearColor{}, true
	}
	return linearColor{
		r: (firstWeight*first.a*first.r + secondWeight*second.a*second.r) / alpha,
		g: (firstWeight*first.a*first.g + secondWeight*second.a*second.g) / alpha,
		b: (firstWeight*first.a*first.b + secondWeight*second.a*second.b) / alpha,
		a: alpha,
	}, true
}

func parseColorMixStop(value string) (linearColor, float64, bool, bool) {
	value = strings.TrimSpace(value)
	weight := 0.0
	weightSet := false
	if separator := strings.LastIndexByte(value, ' '); separator >= 0 && strings.HasSuffix(strings.TrimSpace(value[separator+1:]), "%") {
		parsed, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(value[separator+1:]), "%"), 64)
		if err != nil || parsed < 0 || parsed > 100 {
			return linearColor{}, 0, false, false
		}
		weight = parsed / 100
		weightSet = true
		value = strings.TrimSpace(value[:separator])
	}
	color, ok := parseSimpleColor(value)
	return color, weight, weightSet, ok
}

func splitTopLevel(value string, separator rune) []string {
	parts := []string{}
	start, depth := 0, 0
	for index, current := range value {
		switch current {
		case '(':
			depth++
		case ')':
			depth--
		default:
			if current == separator && depth == 0 {
				parts = append(parts, strings.TrimSpace(value[start:index]))
				start = index + 1
			}
		}
		if depth < 0 {
			return nil
		}
	}
	if depth != 0 {
		return nil
	}
	return append(parts, strings.TrimSpace(value[start:]))
}

func compositeColor(foreground, background linearColor) linearColor {
	alpha := foreground.a + background.a*(1-foreground.a)
	if alpha == 0 {
		return linearColor{}
	}
	return linearColor{
		r: (foreground.r*foreground.a + background.r*background.a*(1-foreground.a)) / alpha,
		g: (foreground.g*foreground.a + background.g*background.a*(1-foreground.a)) / alpha,
		b: (foreground.b*foreground.a + background.b*background.a*(1-foreground.a)) / alpha,
		a: alpha,
	}
}

func perceptiblyDistinct(first, second, underlay string) bool {
	distance, ok := perceptualColorDistance(first, second, underlay)
	return ok && distance >= minimumStateDistance
}

func perceptualColorDistance(first, second, underlay string) (float64, bool) {
	firstColor, ok := parseSimpleColor(first)
	if !ok {
		return 0, false
	}
	secondColor, ok := parseSimpleColor(second)
	if !ok {
		return 0, false
	}
	base, ok := parseSimpleColor(underlay)
	if !ok || base.a < .999 {
		return 0, false
	}
	firstColor = compositeColor(firstColor, base)
	secondColor = compositeColor(secondColor, base)
	firstL, firstA, firstB := linearToOKLab(firstColor)
	secondL, secondA, secondB := linearToOKLab(secondColor)
	distance := math.Hypot(math.Hypot(firstL-secondL, firstA-secondA), firstB-secondB)
	return distance, true
}

func linearToOKLab(color linearColor) (float64, float64, float64) {
	l := math.Cbrt(.4122214708*color.r + .5363325363*color.g + .0514459929*color.b)
	m := math.Cbrt(.2119034982*color.r + .6806995451*color.g + .1073969566*color.b)
	s := math.Cbrt(.0883024619*color.r + .2817188376*color.g + .6299787005*color.b)
	return .2104542553*l + .793617785*m - .0040720468*s,
		1.9779984951*l - 2.428592205*m + .4505937099*s,
		.0259040371*l + .7827717662*m - .808675766*s
}

func parseHexColor(value string) (linearColor, bool) {
	digits := strings.TrimPrefix(value, "#")
	if len(digits) == 3 || len(digits) == 4 {
		expanded := make([]byte, 0, len(digits)*2)
		for index := range digits {
			expanded = append(expanded, digits[index], digits[index])
		}
		digits = string(expanded)
	}
	if len(digits) != 6 && len(digits) != 8 {
		return linearColor{}, false
	}
	parsed, err := strconv.ParseUint(digits, 16, 32)
	if err != nil {
		return linearColor{}, false
	}
	if len(digits) == 6 {
		parsed = parsed<<8 | 0xff
	}
	r := float64((parsed>>24)&0xff) / 255
	g := float64((parsed>>16)&0xff) / 255
	b := float64((parsed>>8)&0xff) / 255
	a := float64(parsed&0xff) / 255
	return linearColor{gammaToLinear(r), gammaToLinear(g), gammaToLinear(b), a}, true
}

func parseOKLCH(value string) (linearColor, bool) {
	fields, alpha, ok := parseFunctionalFields(value, "oklch", 3)
	if !ok {
		return linearColor{}, false
	}
	l, ok := parsePercentOrNumber(fields[0])
	if !ok {
		return linearColor{}, false
	}
	c, err := strconv.ParseFloat(fields[1], 64)
	if err != nil || c < 0 {
		return linearColor{}, false
	}
	h, err := strconv.ParseFloat(strings.TrimSuffix(fields[2], "deg"), 64)
	if err != nil {
		return linearColor{}, false
	}
	radians := h * math.Pi / 180
	return oklabToLinear(l, c*math.Cos(radians), c*math.Sin(radians), alpha), true
}

func parseOKLab(value string) (linearColor, bool) {
	fields, alpha, ok := parseFunctionalFields(value, "oklab", 3)
	if !ok {
		return linearColor{}, false
	}
	l, ok := parsePercentOrNumber(fields[0])
	if !ok {
		return linearColor{}, false
	}
	a, errA := strconv.ParseFloat(fields[1], 64)
	b, errB := strconv.ParseFloat(fields[2], 64)
	if errA != nil || errB != nil {
		return linearColor{}, false
	}
	return oklabToLinear(l, a, b, alpha), true
}

func parseRGB(value string) (linearColor, bool) {
	prefix := "rgb"
	if strings.HasPrefix(value, "rgba(") {
		prefix = "rgba"
	}
	body := strings.TrimSuffix(strings.TrimPrefix(value, prefix+"("), ")")
	body = strings.ReplaceAll(body, ",", " ")
	parts := strings.Split(body, "/")
	fields := strings.Fields(parts[0])
	if len(fields) != 3 || len(parts) > 2 {
		return linearColor{}, false
	}
	channels := [3]float64{}
	for index, field := range fields {
		parsed, err := strconv.ParseFloat(strings.TrimSuffix(field, "%"), 64)
		if err != nil {
			return linearColor{}, false
		}
		if strings.HasSuffix(field, "%") {
			parsed /= 100
		} else {
			parsed /= 255
		}
		if parsed < 0 || parsed > 1 {
			return linearColor{}, false
		}
		channels[index] = gammaToLinear(parsed)
	}
	alpha := 1.0
	if len(parts) == 2 {
		var ok bool
		alpha, ok = parseAlpha(strings.TrimSpace(parts[1]))
		if !ok {
			return linearColor{}, false
		}
	} else if prefix == "rgba" && len(fields) == 3 {
		return linearColor{}, false
	}
	return linearColor{channels[0], channels[1], channels[2], alpha}, true
}

func parseFunctionalFields(value, name string, count int) ([]string, float64, bool) {
	body := strings.TrimSuffix(strings.TrimPrefix(value, name+"("), ")")
	parts := strings.Split(body, "/")
	if len(parts) > 2 {
		return nil, 0, false
	}
	fields := strings.Fields(parts[0])
	if len(fields) != count {
		return nil, 0, false
	}
	alpha := 1.0
	if len(parts) == 2 {
		var ok bool
		alpha, ok = parseAlpha(strings.TrimSpace(parts[1]))
		if !ok {
			return nil, 0, false
		}
	}
	return fields, alpha, true
}

func parsePercentOrNumber(value string) (float64, bool) {
	parsed, err := strconv.ParseFloat(strings.TrimSuffix(value, "%"), 64)
	if err != nil {
		return 0, false
	}
	if strings.HasSuffix(value, "%") {
		parsed /= 100
	}
	return parsed, parsed >= 0 && parsed <= 1
}

func parseAlpha(value string) (float64, bool) {
	parsed, ok := parsePercentOrNumber(value)
	return parsed, ok
}

func oklabToLinear(l, a, b, alpha float64) linearColor {
	lRoot := l + .3963377774*a + .2158037573*b
	mRoot := l - .1055613458*a - .0638541728*b
	sRoot := l - .0894841775*a - 1.291485548*b
	lCube, mCube, sCube := lRoot*lRoot*lRoot, mRoot*mRoot*mRoot, sRoot*sRoot*sRoot
	return linearColor{
		r: clamp01(4.0767416621*lCube - 3.3077115913*mCube + .2309699292*sCube),
		g: clamp01(-1.2684380046*lCube + 2.6097574011*mCube - .3413193965*sCube),
		b: clamp01(-.0041960863*lCube - .7034186147*mCube + 1.707614701*sCube),
		a: alpha,
	}
}

func gammaToLinear(value float64) float64 {
	if value <= .04045 {
		return value / 12.92
	}
	return math.Pow((value+.055)/1.055, 2.4)
}

func clamp01(value float64) float64 { return math.Max(0, math.Min(1, value)) }
