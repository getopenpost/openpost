package memes

import (
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

func normalizeSearchValue(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	decomposed := norm.NFD.String(value)
	var builder strings.Builder
	builder.Grow(len(decomposed))
	space := false
	for _, current := range decomposed {
		if unicode.Is(unicode.Mn, current) {
			continue
		}
		if unicode.IsLetter(current) || unicode.IsNumber(current) {
			builder.WriteRune(current)
			space = false
			continue
		}
		if !space && builder.Len() > 0 {
			builder.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(builder.String())
}

func buildSearchMetadata(template Template) ([]string, string) {
	values := make([]string, 0, 2+len(template.Keywords)+len(template.Example.Text))
	values = append(values, template.ID, template.Name)
	values = append(values, template.Keywords...)
	values = append(values, template.Example.Text...)

	seen := make(map[string]struct{})
	terms := make([]string, 0, len(values)*2)
	for _, value := range values {
		normalized := normalizeSearchValue(value)
		if normalized == "" {
			continue
		}
		addUniqueTerm(&terms, seen, normalized)
		for _, token := range strings.Fields(normalized) {
			addUniqueTerm(&terms, seen, token)
		}
	}
	sort.Strings(terms)
	return terms, strings.Join(terms, " ")
}

func addUniqueTerm(terms *[]string, seen map[string]struct{}, term string) {
	if _, exists := seen[term]; exists {
		return
	}
	seen[term] = struct{}{}
	*terms = append(*terms, term)
}

type rankedTemplate struct {
	template Template
	score    int
}

func rankTemplate(template Template, query string) int {
	if query == "" {
		return 1
	}
	id := normalizeSearchValue(template.ID)
	name := normalizeSearchValue(template.Name)
	switch {
	case query == id:
		return 1000
	case query == name:
		return 900
	case strings.HasPrefix(id, query):
		return 850
	case strings.HasPrefix(name, query):
		return 800
	case strings.Contains(name, query):
		return 700
	case strings.Contains(template.searchText, query):
		return 500
	}
	for _, token := range strings.Fields(query) {
		if !strings.Contains(template.searchText, token) {
			return 0
		}
	}
	return 300
}

func searchTemplates(templates []Template, query string, limit int) []Template {
	query = normalizeSearchValue(query)
	ranked := make([]rankedTemplate, 0, len(templates))
	for _, template := range templates {
		score := rankTemplate(template, query)
		if score > 0 {
			ranked = append(ranked, rankedTemplate{template: template, score: score})
		}
	}
	sort.SliceStable(ranked, func(left, right int) bool {
		if ranked[left].score != ranked[right].score {
			return ranked[left].score > ranked[right].score
		}
		leftName := normalizeSearchValue(ranked[left].template.Name)
		rightName := normalizeSearchValue(ranked[right].template.Name)
		if leftName != rightName {
			return leftName < rightName
		}
		return ranked[left].template.ID < ranked[right].template.ID
	})
	if limit > len(ranked) {
		limit = len(ranked)
	}
	result := make([]Template, 0, limit)
	for _, item := range ranked[:limit] {
		result = append(result, cloneTemplate(item.template))
	}
	return result
}
