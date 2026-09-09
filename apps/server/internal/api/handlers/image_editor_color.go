package handlers

import (
	"encoding/json"
	"fmt"
)

type ImageEditorColorWheels struct {
	ShadowsHue       float64 `json:"shadowsHue" minimum:"0" maximum:"360"`
	ShadowsAmount    float64 `json:"shadowsAmount" minimum:"0" maximum:"1"`
	MidtonesHue      float64 `json:"midtonesHue" minimum:"0" maximum:"360"`
	MidtonesAmount   float64 `json:"midtonesAmount" minimum:"0" maximum:"1"`
	HighlightsHue    float64 `json:"highlightsHue" minimum:"0" maximum:"360"`
	HighlightsAmount float64 `json:"highlightsAmount" minimum:"0" maximum:"1"`
	OffsetHue        float64 `json:"offsetHue" minimum:"0" maximum:"360"`
	OffsetAmount     float64 `json:"offsetAmount" minimum:"0" maximum:"1"`
	Lift             float64 `json:"lift" minimum:"-2" maximum:"2"`
	Gamma            float64 `json:"gamma" minimum:"0" maximum:"4"`
	Gain             float64 `json:"gain" minimum:"0" maximum:"16"`
	Offset           float64 `json:"offset" minimum:"-2" maximum:"2"`
}

type ImageEditorColorCurves struct {
	MasterPoints string `json:"masterPoints,omitempty" maxLength:"1024"`
	RedPoints    string `json:"redPoints,omitempty" maxLength:"1024"`
	GreenPoints  string `json:"greenPoints,omitempty" maxLength:"1024"`
	BluePoints   string `json:"bluePoints,omitempty" maxLength:"1024"`
}

func validateImageEditorColorTools(wheels *ImageEditorColorWheels, curves *ImageEditorColorCurves) error {
	if err := validateImageEditorColorWheels(wheels); err != nil {
		return err
	}
	if curves == nil {
		return nil
	}
	for _, encoded := range []string{curves.MasterPoints, curves.RedPoints, curves.GreenPoints, curves.BluePoints} {
		if err := validateImageEditorColorCurve(encoded); err != nil {
			return err
		}
	}
	return nil
}

func validateImageEditorColorWheels(wheels *ImageEditorColorWheels) error {
	if wheels == nil {
		return nil
	}
	for _, value := range []struct{ value, min, max float64 }{
		{wheels.ShadowsHue, 0, 360},
		{wheels.ShadowsAmount, 0, 1},
		{wheels.MidtonesHue, 0, 360},
		{wheels.MidtonesAmount, 0, 1},
		{wheels.HighlightsHue, 0, 360},
		{wheels.HighlightsAmount, 0, 1},
		{wheels.OffsetHue, 0, 360},
		{wheels.OffsetAmount, 0, 1},
		{wheels.Lift, -2, 2},
		{wheels.Gamma, 0, 4},
		{wheels.Gain, 0, 16},
		{wheels.Offset, -2, 2},
	} {
		if !finiteImageEditorNumber(value.value) || value.value < value.min || value.value > value.max {
			return fmt.Errorf("image color wheel value is out of range")
		}
	}
	return nil
}

func validateImageEditorColorCurve(encoded string) error {
	if encoded == "" {
		return nil
	}
	var points [][]float64
	if len(encoded) > 1024 || json.Unmarshal([]byte(encoded), &points) != nil || len(points) < 2 || len(points) > 16 {
		return fmt.Errorf("image color curve must contain 2 to 16 points")
	}
	if len(points[0]) != 2 || len(points[len(points)-1]) != 2 || points[0][0] != 0 || points[len(points)-1][0] != 1 {
		return fmt.Errorf("image color curve must span the full input range")
	}
	for index, point := range points {
		if !validImageEditorColorPoint(point) || (index > 0 && point[0]-points[index-1][0] < 0.039999) {
			return fmt.Errorf("image color curve points are invalid")
		}
	}
	return nil
}

func validImageEditorColorPoint(point []float64) bool {
	return len(point) == 2 && finiteImageEditorNumber(point[0]) && finiteImageEditorNumber(point[1]) && point[0] >= 0 && point[0] <= 1 && point[1] >= 0 && point[1] <= 1
}
