package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

const maxDataBytes = 256 * 1024
const maxListItems = 1000

func isTransform(kind string) bool {
	return slices.Contains([]string{KindFields, KindText, KindJSON, KindFilter, KindSort, KindLimit, KindMerge, KindDate, KindURL, KindCode}, kind)
}

func textInput(inputs map[string]any, key string) string {
	value, _ := inputs[key].(string)
	return value
}

func transform(ctx context.Context, kind string, inputs map[string]any) (map[string]any, error) {
	if kind == KindCode {
		return executeCode(ctx, textInput(inputs, "code"), inputs["data"])
	}
	var output map[string]any
	var err error
	switch kind {
	case KindFields:
		output, err = transformFields(inputs)
	case KindJSON:
		output, err = transformJSON(inputs)
	case KindText:
		output, err = transformText(inputs)
	case KindFilter, KindSort, KindLimit:
		output, err = transformList(kind, inputs)
	case KindMerge:
		output, err = transformMerge(inputs)
	case KindDate:
		output, err = transformDate(inputs)
	case KindURL:
		output, err = transformURL(inputs)
	default:
		return nil, errors.New("unsupported transform")
	}
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(output)
	if err != nil || len(encoded) > maxDataBytes {
		return nil, errors.New("step output exceeds 256 KB")
	}
	return output, nil
}

func transformFields(inputs map[string]any) (map[string]any, error) {
	var output map[string]any
	output, _ = inputs["fields"].(map[string]any)
	if output == nil {
		_ = json.Unmarshal([]byte(textInput(inputs, "fields")), &output)
	}
	if output == nil {
		return nil, errors.New("fields must be a JSON object")
	}
	return output, nil
}

func transformJSON(inputs map[string]any) (map[string]any, error) {
	var output map[string]any
	var data any
	if err := json.Unmarshal([]byte(textInput(inputs, "text")), &data); err != nil {
		return nil, errors.New("text is not valid JSON")
	}
	output = map[string]any{"data": data}
	return output, nil
}

func transformText(inputs map[string]any) (map[string]any, error) {
	var output map[string]any
	text := textInput(inputs, "text")
	switch textInput(inputs, "operation") {
	case "trim":
		text = strings.TrimSpace(text)
	case "lowercase":
		text = strings.ToLower(text)
	case "uppercase":
		text = strings.ToUpper(text)
	case "replace":
		text = strings.ReplaceAll(text, textInput(inputs, "find"), textInput(inputs, "replacement"))
	case "strip_html":
		doc, err := goquery.NewDocumentFromReader(strings.NewReader(text))
		if err != nil {
			return nil, err
		}
		doc.Find("script,style").Remove()
		text = strings.TrimSpace(doc.Text())
	case "truncate":
		limit, err := number(inputs["limit"])
		if err != nil || limit < 1 || limit > MaxTextBytes || limit != float64(int(limit)) {
			return nil, errors.New("choose a whole character limit between 1 and 20000")
		}
		runes := []rune(text)
		text = string(runes[:min(len(runes), int(limit))])
	default:
		return nil, errors.New("choose a supported text operation")
	}
	output = map[string]any{"text": text, "length": len([]rune(text))}
	return output, nil
}

func transformMerge(inputs map[string]any) (map[string]any, error) {
	var output map[string]any
	first, firstList := inputs["first"].([]any)
	second, secondList := inputs["second"].([]any)
	if firstList && secondList {
		if len(first)+len(second) > maxListItems {
			return nil, errors.New("merged list exceeds 1000 items")
		}
		output = map[string]any{"data": append(slices.Clone(first), second...)}
	} else {
		first, a := inputs["first"].(map[string]any)
		second, b := inputs["second"].(map[string]any)
		if !a || !b {
			return nil, errors.New("merge requires two lists or two objects")
		}
		merged := map[string]any{}
		for k, v := range first {
			merged[k] = v
		}
		for k, v := range second {
			merged[k] = v
		}
		output = map[string]any{"data": merged}
	}
	return output, nil
}

func transformDate(inputs map[string]any) (map[string]any, error) {
	var output map[string]any
	date, err := time.Parse(time.RFC3339, textInput(inputs, "date"))
	if err != nil {
		return nil, errors.New("date must use ISO 8601, such as 2026-09-28T10:00:00Z")
	}
	zone := textInput(inputs, "timezone")
	if zone == "" {
		zone = "UTC"
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		return nil, errors.New("choose a valid timezone")
	}
	format, ok := map[string]string{"iso": time.RFC3339, "date": "2006-01-02", "time": "15:04", "readable": "2 January 2006"}[textInput(inputs, "format")]
	if !ok {
		return nil, errors.New("choose a supported date format")
	}
	output = map[string]any{"text": date.In(location).Format(format), "timestamp": date.Unix()}
	return output, nil
}

func transformURL(inputs map[string]any) (map[string]any, error) {
	var output map[string]any
	address, err := url.Parse(textInput(inputs, "url"))
	if err != nil || address.Host == "" || (address.Scheme != "https" && address.Scheme != "http") || address.User != nil {
		return nil, errors.New("enter an HTTP or HTTPS link")
	}
	query := address.Query()
	for _, field := range []string{"source", "medium", "campaign", "content", "term"} {
		if value := textInput(inputs, field); value != "" {
			query.Set("utm_"+field, value)
		}
	}
	address.RawQuery = query.Encode()
	output = map[string]any{"url": address.String()}
	return output, nil
}

func transformList(kind string, inputs map[string]any) (map[string]any, error) {
	items, ok := inputs["items"].([]any)
	if !ok || len(items) > maxListItems {
		return nil, errors.New("choose a list with at most 1000 items")
	}
	items = slices.Clone(items)
	var err error
	switch kind {
	case KindLimit:
		items, err = limitItems(items, inputs)
	case KindFilter:
		items, err = filterItems(items, inputs)
	case KindSort:
		items, err = sortItems(items, inputs)
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "count": len(items)}, nil
}

func limitItems(items []any, inputs map[string]any) ([]any, error) {
	limit, err := number(inputs["limit"])
	if err != nil || limit < 0 || limit > maxListItems || limit != float64(int(limit)) {
		return nil, errors.New("choose a whole item limit between 0 and 1000")
	}
	items = items[:min(len(items), int(limit))]
	return items, nil
}

func filterItems(items []any, inputs map[string]any) ([]any, error) {
	filtered := []any{}
	for _, item := range items {
		value, err := resolveReference("item."+textInput(inputs, "field"), map[string]any{"item": item})
		if err != nil {
			return nil, err
		}
		matched, err := compare(map[string]any{"left": value, "operator": inputs["operator"], "right": inputs["right"]})
		if err != nil {
			return nil, err
		}
		if matched {
			filtered = append(filtered, item)
		}
	}
	items = filtered
	return items, nil
}

func sortItems(items []any, inputs map[string]any) ([]any, error) {
	values := make([]any, len(items))
	for i, item := range items {
		value, err := resolveReference("item."+textInput(inputs, "field"), map[string]any{"item": item})
		if err != nil {
			return nil, err
		}
		values[i] = value
	}
	indices := make([]int, len(items))
	for i := range indices {
		indices[i] = i
	}
	slices.SortStableFunc(indices, func(a, b int) int {
		left, right := values[a], values[b]
		order := strings.Compare(fmt.Sprint(left), fmt.Sprint(right))
		if l, ok := left.(float64); ok {
			if r, ok := right.(float64); ok {
				order = 0
				if l < r {
					order = -1
				}
				if l > r {
					order = 1
				}
			}
		}
		if textInput(inputs, "direction") == "descending" {
			order = -order
		}
		return order
	})
	sorted := make([]any, len(items))
	for i, index := range indices {
		sorted[i] = items[index]
	}
	items = sorted
	return items, nil
}
