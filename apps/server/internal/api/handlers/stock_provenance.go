package handlers

import (
	"fmt"
	"net/url"
	"strings"
)

// StockMediaProvenance records the license and creator facts for media
// imported from a stock provider. It survives independently of the retired
// video project document because stock uploads still carry it.
type StockMediaProvenance struct {
	Provider        string `json:"provider"`
	ExternalID      string `json:"external_id"`
	SourceURL       string `json:"source_url"`
	CreatorName     string `json:"creator_name"`
	CreatorURL      string `json:"creator_url"`
	LicenseName     string `json:"license_name"`
	LicenseURL      string `json:"license_url"`
	AttributionText string `json:"attribution_text"`
}

func validateProvenance(sourceID string, provenance StockMediaProvenance) error {
	if strings.TrimSpace(provenance.Provider) == "" || len(provenance.Provider) > 40 ||
		strings.TrimSpace(provenance.ExternalID) == "" || len(provenance.ExternalID) > 160 ||
		len(provenance.CreatorName) > 300 || len(provenance.AttributionText) > 1_000 ||
		len(provenance.LicenseName) > 200 {
		return fmt.Errorf("source %q stock provenance is invalid", sourceID)
	}
	for _, value := range []string{
		provenance.SourceURL,
		provenance.CreatorURL,
		provenance.LicenseURL,
	} {
		parsed, err := url.Parse(strings.TrimSpace(value))
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return fmt.Errorf("source %q stock provenance URLs must use HTTPS", sourceID)
		}
	}
	return nil
}

// ValidateStockMediaProvenance validates provenance supplied independently of a
// complete project document, such as during a stock-media upload.
func ValidateStockMediaProvenance(provenance StockMediaProvenance) error {
	return validateProvenance("stock import", provenance)
}
