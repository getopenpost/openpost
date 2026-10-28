package settingx

import (
	"testing"
)

// Pins the tolerant adapter coercion rule from issue #414: "true", "1",
// and "yes" read true, "" reads false, and null/unset stays distinguishable
// from false via BoolPtr.
func TestBoolCoercion(t *testing.T) {
	cases := []struct {
		name     string
		settings map[string]any
		want     bool
	}{
		{"true string", map[string]any{"flag": "true"}, true},
		{"TRUE string", map[string]any{"flag": "TRUE"}, true},
		{"padded true", map[string]any{"flag": "  true  "}, true},
		{"one string", map[string]any{"flag": "1"}, true},
		{"yes string", map[string]any{"flag": "yes"}, true},
		{"YES string", map[string]any{"flag": "YES"}, true},
		{"on string", map[string]any{"flag": "on"}, true},
		{"On string", map[string]any{"flag": "On"}, true},
		{"empty string", map[string]any{"flag": ""}, false},
		{"false string", map[string]any{"flag": "false"}, false},
		{"zero string", map[string]any{"flag": "0"}, false},
		// strconv.ParseBool accepts "t" but the adapter rule does not;
		// the preview must agree with what the adapter sends.
		{"t string reads false", map[string]any{"flag": "t"}, false},
		{"bool true", map[string]any{"flag": true}, true},
		{"bool false", map[string]any{"flag": false}, false},
		{"missing key", map[string]any{}, false},
		{"nil map", nil, false},
		{"null value", map[string]any{"flag": nil}, false},
		{"numeric one is not string one", map[string]any{"flag": 1}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Bool(tc.settings, "flag"); got != tc.want {
				t.Fatalf("Bool(%v) = %v, want %v", tc.settings, got, tc.want)
			}
		})
	}
}

func TestBoolPtrDistinguishesUnsetFromFalse(t *testing.T) {
	if got := BoolPtr(nil, "flag"); got != nil {
		t.Fatalf("BoolPtr(nil) = %v, want nil", *got)
	}
	if got := BoolPtr(map[string]any{}, "flag"); got != nil {
		t.Fatalf("BoolPtr(missing) = %v, want nil", *got)
	}
	if got := BoolPtr(map[string]any{"flag": nil}, "flag"); got != nil {
		t.Fatalf("BoolPtr(null) = %v, want nil", *got)
	}
	for _, tc := range []struct {
		value any
		want  bool
	}{{false, false}, {"false", false}, {"yes", true}, {true, true}} {
		got := BoolPtr(map[string]any{"flag": tc.value}, "flag")
		if got == nil {
			t.Fatalf("BoolPtr(%v) = nil, want non-nil", tc.value)
		}
		if *got != tc.want {
			t.Fatalf("BoolPtr(%v) = %v, want %v", tc.value, *got, tc.want)
		}
	}
}

func TestBoolDefault(t *testing.T) {
	if got := BoolDefault(nil, "flag", true); got != true {
		t.Fatalf("BoolDefault(nil, fallback=true) = %v, want true", got)
	}
	if got := BoolDefault(map[string]any{}, "flag", true); got != true {
		t.Fatalf("BoolDefault(missing, fallback=true) = %v, want true", got)
	}
	if got := BoolDefault(map[string]any{"flag": "yes"}, "flag", false); got != true {
		t.Fatalf("BoolDefault(yes, fallback=false) = %v, want true", got)
	}
	if got := BoolDefault(map[string]any{"flag": nil}, "flag", true); got != false {
		t.Fatalf("BoolDefault(null, fallback=true) = %v, want false", got)
	}
}

func TestStringCoercion(t *testing.T) {
	cases := []struct {
		name     string
		settings map[string]any
		want     string
	}{
		{"missing", map[string]any{}, ""},
		{"nil map", nil, ""},
		{"null", map[string]any{"k": nil}, ""},
		{"trims", map[string]any{"k": "  hello  "}, "hello"},
		{"number coerces", map[string]any{"k": 1080}, "1080"},
		{"bool coerces", map[string]any{"k": true}, "true"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := String(tc.settings, "k"); got != tc.want {
				t.Fatalf("String(%v) = %q, want %q", tc.settings, got, tc.want)
			}
		})
	}
}

func TestIntCoercion(t *testing.T) {
	cases := []struct {
		name     string
		settings map[string]any
		want     int
	}{
		{"missing", map[string]any{}, 0},
		{"nil map", nil, 0},
		{"null", map[string]any{"k": nil}, 0},
		{"int", map[string]any{"k": 1080}, 1080},
		{"int64", map[string]any{"k": int64(1080)}, 1080},
		{"float64 truncates", map[string]any{"k": float64(1080.9)}, 1080},
		{"numeric string", map[string]any{"k": "1080"}, 1080},
		{"padded numeric string", map[string]any{"k": "  1080  "}, 1080},
		{"non-numeric string", map[string]any{"k": "wide"}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Int(tc.settings, "k"); got != tc.want {
				t.Fatalf("Int(%v) = %d, want %d", tc.settings, got, tc.want)
			}
		})
	}
}
