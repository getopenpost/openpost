package themes

import (
	"fmt"
	"math"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

var (
	cssLengthPattern   = regexp.MustCompile(`^([0-9]+(?:\.[0-9]+)?)(px|rem|em|%|vw|vh)$`)
	cssTimePattern     = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)?(?:ms|s)$`)
	cssTrackingPattern = regexp.MustCompile(`^-?[0-9]+(?:\.[0-9]+)?(?:px|rem|em)$`)
	lineHeightPattern  = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)?$`)
)

var safeFontFallbacks = map[string]struct{}{
	"Arial": {}, "BlinkMacSystemFont": {}, "Consolas": {}, "Courier New": {},
	"DM Sans": {}, "Geist": {}, "Geist Mono": {}, "Georgia": {}, "Helvetica": {}, "Inter": {},
	"Inter Tight": {}, "Manrope": {}, "Menlo": {}, "Monaco": {}, "Segoe UI": {},
	"SFMono-Regular": {}, "Source Serif 4": {}, "Times New Roman": {},
	"-apple-system": {}, "monospace": {}, "sans-serif": {}, "serif": {},
	"system-ui": {}, "ui-monospace": {}, "ui-serif": {},
}

const (
	minimumTypographyPixels      = 11
	minimumBaseSpacingPixels     = 2
	minimumPageGutterPixels      = 8
	minimumLayoutGapPixels       = 4
	minimumContentMaxWidthPixels = 320
	minimumSidebarWidthPixels    = 160
	minimumShellBarHeightPixels  = 44
)

func NormalizeSchemeManifest(scheme ColorScheme, input ThemeSchemeManifest) (ThemeSchemeManifest, error) {
	if !validScheme(scheme) {
		return ThemeSchemeManifest{}, invalidManifest("scheme", "must be light or dark")
	}
	if err := validateColorTokens(input.Colors); err != nil {
		return ThemeSchemeManifest{}, err
	}
	if !reflect.DeepEqual(input.ProtectedEditor, protectedEditorTokens(scheme)) {
		return ThemeSchemeManifest{}, invalidManifest("protectedEditor", "is code-owned and cannot be changed")
	}
	if err := normalizeTypography(&input.Typography); err != nil {
		return ThemeSchemeManifest{}, err
	}
	if err := validateSpacing(input.Spacing); err != nil {
		return ThemeSchemeManifest{}, err
	}
	if err := validateShape(input.Shape); err != nil {
		return ThemeSchemeManifest{}, err
	}
	if err := validateStringFields("elevation", input.Elevation, validCSSShadow); err != nil {
		return ThemeSchemeManifest{}, err
	}
	if err := validateMotion(input.Motion); err != nil {
		return ThemeSchemeManifest{}, err
	}
	if err := validateShell(input.Shell); err != nil {
		return ThemeSchemeManifest{}, err
	}
	if err := validateComponents(input.Components); err != nil {
		return ThemeSchemeManifest{}, err
	}
	return input, nil
}

//nolint:gocyclo // All six typography roles share one explicit normalization and availability contract.
func normalizeTypography(input *ThemeTypographyTokens) error {
	roles := []struct {
		path string
		role *ThemeTypographyRoleTokens
	}{
		{"display", &input.Display}, {"title", &input.Title}, {"body", &input.Body},
		{"label", &input.Label}, {"metadata", &input.Metadata}, {"code", &input.Code},
	}
	for _, item := range roles {
		role := item.role
		role.Family = strings.TrimSpace(role.Family)
		if role.Family == "" || !fontFamilyPattern.MatchString(role.Family) || unsafeCSSValue(role.Family) {
			return invalidManifest("typography."+item.path+".family", "must be a local font family")
		}
		if len(role.Fallbacks) == 0 || len(role.Fallbacks) > 8 {
			return invalidManifest("typography."+item.path+".fallbacks", "must contain 1 to 8 safe fallback families")
		}
		seen := map[string]struct{}{}
		for index, fallback := range role.Fallbacks {
			fallback = strings.TrimSpace(fallback)
			if _, ok := safeFontFallbacks[fallback]; !ok {
				return invalidManifest(fmt.Sprintf("typography.%s.fallbacks[%d]", item.path, index), "is not a bundled or safe system family")
			}
			if _, exists := seen[fallback]; exists {
				return invalidManifest("typography."+item.path+".fallbacks", "contains duplicates")
			}
			role.Fallbacks[index] = fallback
			seen[fallback] = struct{}{}
		}
		if role.Weight < 100 || role.Weight > 900 || role.Weight%100 != 0 {
			return invalidManifest("typography."+item.path+".weight", "must be a 100-step integer weight")
		}
		if !boundedCSSLength(role.Size, minimumTypographyPixels, 256) {
			return invalidManifest("typography."+item.path+".size", fmt.Sprintf("must be between %dpx and 256px", minimumTypographyPixels))
		}
		if !lineHeightPattern.MatchString(role.LineHeight) {
			return invalidManifest("typography."+item.path+".lineHeight", "must be a unitless line height")
		}
		lineHeight, _ := strconv.ParseFloat(role.LineHeight, 64)
		if lineHeight < 1 || lineHeight > 2.5 {
			return invalidManifest("typography."+item.path+".lineHeight", "must be between 1 and 2.5")
		}
		tracking, ok := signedCSSPixels(role.Tracking)
		if !ok || math.Abs(tracking) > 16 {
			return invalidManifest("typography."+item.path+".tracking", "must be a CSS length between -16px and 16px")
		}
	}
	return nil
}

func validateSpacing(input ThemeSpacingTokens) error {
	if !slices.Contains([]string{"compact", "comfortable", "spacious"}, input.Density) {
		return invalidManifest("spacing.density", "is unsupported")
	}
	checks := []struct {
		path  string
		value string
		min   float64
		max   float64
	}{
		{"base", input.Base, minimumBaseSpacingPixels, 64},
		{"controlHeight", input.ControlHeight, 36, 96},
		{"compactControlHeight", input.CompactControlHeight, 32, 96},
		{"touchTarget", input.TouchTarget, 44, 96},
		{"pageGutter", input.PageGutter, minimumPageGutterPixels, 256},
		{"sectionGap", input.SectionGap, minimumLayoutGapPixels, 256},
		{"componentGap", input.ComponentGap, minimumLayoutGapPixels, 256},
	}
	for _, check := range checks {
		if !boundedCSSLength(check.value, check.min, check.max) {
			return invalidManifest("spacing."+check.path, fmt.Sprintf("must be between %.0fpx and %.0fpx", check.min, check.max))
		}
	}
	return nil
}

func validateShape(input ThemeCornerTokens) error {
	radii := []struct {
		path  string
		value string
		max   float64
	}{
		{"radius", input.Radius, 256}, {"radiusSm", input.RadiusSM, 256},
		{"radiusMd", input.RadiusMD, 256}, {"radiusLg", input.RadiusLG, 256},
		{"radiusMedia", input.RadiusMedia, 256}, {"radiusPill", input.RadiusPill, 10_000},
	}
	for _, radius := range radii {
		if !boundedCSSLength(radius.value, 0, radius.max) {
			return invalidManifest("shape."+radius.path, fmt.Sprintf("must be a nonnegative CSS length no larger than %.0fpx", radius.max))
		}
	}
	if input.BorderStyle != "solid" && input.BorderStyle != "dashed" {
		return invalidManifest("shape.borderStyle", "must be solid or dashed")
	}
	borderWidth, ok := cssPixels(input.BorderWidth)
	if !ok || borderWidth < 1 || borderWidth > 4 {
		return invalidManifest("shape.borderWidth", "must be between 1px and 4px")
	}
	return nil
}

//nolint:gocyclo // Every finite motion recipe is independently bounded and reduced-motion remains mandatory.
func validateMotion(input ThemeMotionTokens) error {
	recipes := []struct {
		path       string
		value      ThemeMotionRecipe
		minOpacity float64
		maxPixels  float64
	}{
		{"press", input.Press, 0.5, 4}, {"hover", input.Hover, 0.5, 16},
		{"selection", input.Selection, 0.5, 16}, {"entry", input.Entry, 0, 64},
		{"exit", input.Exit, 0, 64}, {"loading", input.Loading, 0.1, 16},
		{"pageTransition", input.PageTransition, 0, 64},
	}
	for _, item := range recipes {
		if !cssTimePattern.MatchString(item.value.Duration) {
			return invalidManifest("motion."+item.path+".duration", "must be a CSS duration")
		}
		duration, ok := cssMilliseconds(item.value.Duration)
		if !ok || duration < 0 || duration > 2000 {
			return invalidManifest("motion."+item.path+".duration", "must not exceed 2 seconds")
		}
		if !validCSSEasing(item.value.Easing) {
			return invalidManifest("motion."+item.path+".easing", "is unsupported")
		}
		distance, ok := cssPixels(item.value.Distance)
		if !ok || distance < 0 || distance > item.maxPixels {
			return invalidManifest("motion."+item.path+".distance", "is outside the safe movement bound")
		}
		if math.IsNaN(item.value.Opacity) || math.IsInf(item.value.Opacity, 0) || item.value.Opacity < item.minOpacity || item.value.Opacity > 1 {
			return invalidManifest("motion."+item.path+".opacity", "is outside the safe range")
		}
	}
	if input.ReducedMotion != "instant" && input.ReducedMotion != "crossfade" {
		return invalidManifest("motion.reducedMotion", "must be instant or crossfade")
	}
	return nil
}

func validateShell(input ThemeShellTokens) error {
	dimensions := []struct {
		path  string
		value string
		min   float64
		max   float64
	}{
		{"contentMaxWidth", input.ContentMaxWidth, minimumContentMaxWidthPixels, 4096},
		{"sidebarWidth", input.SidebarWidth, minimumSidebarWidthPixels, 1024},
		{"headerHeight", input.HeaderHeight, minimumShellBarHeightPixels, 256},
		{"mobileNavigationHeight", input.MobileNavigationHeight, minimumShellBarHeightPixels, 256},
	}
	for _, dimension := range dimensions {
		if !boundedCSSLength(dimension.value, dimension.min, dimension.max) {
			return invalidManifest("shell."+dimension.path, fmt.Sprintf("must be between %.0fpx and %.0fpx", dimension.min, dimension.max))
		}
	}
	if !slices.Contains([]string{"plain", "paper", "playful", "garden", "study", "tactile", "precision"}, input.CanvasTreatment) {
		return invalidManifest("shell.canvasTreatment", "is unsupported")
	}
	return nil
}

func validateComponents(input ThemeComponentRecipes) error {
	checks := []struct {
		path    string
		value   string
		allowed []string
	}{
		{"button", input.Button, []string{"solid", "tonal", "outlined", "precise"}},
		{"link", input.Link, []string{"underlined", "subtle", "plain"}},
		{"tabs", input.Tabs, []string{"underline", "pill", "segmented"}},
		{"navigation", input.Navigation, []string{"quiet", "tonal", "outlined"}},
		{"input", input.Input, []string{"filled", "outlined", "underlined"}},
		{"select", input.Select, []string{"filled", "outlined", "underlined"}},
		{"card", input.Card, []string{"flat", "outlined", "paper", "lifted"}},
		{"container", input.Container, []string{"flat", "outlined", "tinted"}},
		{"table", input.Table, []string{"ruled", "striped", "plain"}},
		{"list", input.List, []string{"divided", "spaced", "plain"}},
		{"badge", input.Badge, []string{"solid", "tonal", "outlined"}},
		{"chip", input.Chip, []string{"solid", "tonal", "outlined"}},
		{"dialog", input.Dialog, []string{"flat", "outlined", "elevated"}},
		{"popover", input.Popover, []string{"flat", "outlined", "elevated"}},
		{"toast", input.Toast, []string{"flat", "outlined", "elevated"}},
		{"switch", input.Switch, []string{"solid", "tonal", "outlined"}},
		{"checkbox", input.Checkbox, []string{"solid", "tonal", "outlined"}},
		{"radio", input.Radio, []string{"solid", "tonal", "outlined"}},
		{"toolbar", input.Toolbar, []string{"flat", "outlined", "floating"}},
		{"pagination", input.Pagination, []string{"quiet", "outlined", "pill"}},
		{"emptyState", input.EmptyState, []string{"plain", "illustrated", "framed"}},
		{"loadingState", input.LoadingState, []string{"spinner", "pulse", "skeleton"}},
		{"editorChrome", input.EditorChrome, []string{"neutral", "compact", "precision"}},
		{"decoration", input.Decoration, []string{"none", "editorial", "playful", "botanical", "study", "tactile", "precision"}},
	}
	for _, check := range checks {
		if !slices.Contains(check.allowed, check.value) {
			return invalidManifest("components."+check.path, "contains an unsupported recipe")
		}
	}
	return nil
}

func validateStringFields(prefix string, input any, valid func(string) bool, skip ...string) error {
	value := reflect.ValueOf(input)
	typeOf := value.Type()
	for index := 0; index < value.NumField(); index++ {
		field := typeOf.Field(index)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if slices.Contains(skip, name) {
			continue
		}
		text := strings.TrimSpace(value.Field(index).String())
		if !valid(text) || unsafeCSSValue(text) {
			return invalidManifest(prefix+"."+name, "contains an unsafe or missing value")
		}
	}
	return nil
}

func validCSSShadow(value string) bool {
	if value == "none" {
		return true
	}
	if len(value) > 256 || unsafeCSSValue(value) {
		return false
	}
	parts := strings.Fields(value)
	if len(parts) < 5 {
		return false
	}
	x, okX := signedCSSPixels(parts[0])
	y, okY := signedCSSPixels(parts[1])
	blur, okBlur := signedCSSPixels(parts[2])
	spread, okSpread := signedCSSPixels(parts[3])
	if !okX || !okY || !okBlur || !okSpread || math.Abs(x) > 256 || math.Abs(y) > 256 || blur < 0 || blur > 256 || math.Abs(spread) > 256 {
		return false
	}
	color := strings.Join(parts[4:], " ")
	return validCSSColor(color) || color == "color-mix(in oklch, var(--action-focal) 72%, black)"
}

func unsafeCSSValue(value string) bool {
	lower := strings.ToLower(value)
	return value == "" || len(value) > 512 || strings.Contains(lower, "url(") || strings.ContainsAny(value, ";{}<>@\r\n")
}

func balancedParentheses(value string) bool {
	depth := 0
	for _, r := range value {
		switch r {
		case '(':
			depth++
		case ')':
			depth--
			if depth < 0 {
				return false
			}
		}
	}
	return depth == 0
}

func cssMilliseconds(value string) (float64, bool) {
	if strings.HasSuffix(value, "ms") {
		parsed, err := strconv.ParseFloat(strings.TrimSuffix(value, "ms"), 64)
		return parsed, err == nil
	}
	if strings.HasSuffix(value, "s") {
		parsed, err := strconv.ParseFloat(strings.TrimSuffix(value, "s"), 64)
		return parsed * 1000, err == nil
	}
	return 0, false
}

func cssPixels(value string) (float64, bool) {
	if value == "0" {
		return 0, true
	}
	for _, unit := range []struct {
		suffix string
		factor float64
	}{{"rem", 16}, {"px", 1}, {"em", 16}} {
		if strings.HasSuffix(value, unit.suffix) {
			parsed, err := strconv.ParseFloat(strings.TrimSuffix(value, unit.suffix), 64)
			return parsed * unit.factor, err == nil
		}
	}
	return 0, false
}

func signedCSSPixels(value string) (float64, bool) {
	if value == "0" {
		return 0, true
	}
	if !cssTrackingPattern.MatchString(value) {
		return 0, false
	}
	return cssPixels(value)
}

func boundedCSSLength(value string, minimum, maximum float64) bool {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "clamp(") && strings.HasSuffix(value, ")") {
		parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(value, "clamp("), ")"), ",")
		if len(parts) != 3 {
			return false
		}
		for index := range parts {
			parts[index] = strings.TrimSpace(parts[index])
			if !nonnegativeCSSLength(parts[index]) {
				return false
			}
		}
		lower, lowerOK := cssPixels(parts[0])
		upper, upperOK := cssPixels(parts[2])
		return lowerOK && upperOK && lower >= minimum && upper <= maximum && lower <= upper
	}
	if !nonnegativeCSSLength(value) {
		return false
	}
	pixels, ok := cssPixels(value)
	return ok && pixels >= minimum && pixels <= maximum
}

func nonnegativeCSSLength(value string) bool {
	if value == "0" {
		return true
	}
	match := cssLengthPattern.FindStringSubmatch(value)
	if len(match) != 3 {
		return false
	}
	parsed, err := strconv.ParseFloat(match[1], 64)
	return err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0) && parsed >= 0
}

func validCSSEasing(value string) bool {
	if slices.Contains([]string{"linear", "ease", "ease-in", "ease-out", "ease-in-out"}, value) {
		return true
	}
	if !strings.HasPrefix(value, "cubic-bezier(") || !strings.HasSuffix(value, ")") {
		return false
	}
	parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(value, "cubic-bezier("), ")"), ",")
	if len(parts) != 4 {
		return false
	}
	values := [4]float64{}
	for index, part := range parts {
		parsed, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return false
		}
		values[index] = parsed
	}
	return values[0] >= 0 && values[0] <= 1 && values[2] >= 0 && values[2] <= 1 && math.Abs(values[1]) <= 10 && math.Abs(values[3]) <= 10
}
