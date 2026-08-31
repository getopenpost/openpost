package main

import (
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/config"
)

const (
	contentAIRequestTimeout = 60 * time.Second
	contentAIMaxRetries     = 12
)

func openRouterConfigs(cfg *config.Config) (ai.OpenRouterConfig, ai.OpenRouterConfig) {
	base := ai.OpenRouterConfig{
		APIKey:      cfg.OpenRouterAPIKey,
		HTTPReferer: cfg.PublicURL,
		XTitle:      "OpenPost",
	}
	imageConfig := base
	imageConfig.Provider = cfg.ImageCaptionProvider
	imageConfig.RequireZDR = cfg.ImageCaptionRequireZDR
	contentConfig := base
	contentConfig.Timeout = contentAIRequestTimeout
	contentConfig.MaxRetries = contentAIMaxRetries
	contentConfig.Provider = cfg.ContentAIProvider
	contentConfig.RequireZDR = cfg.ContentAIRequireZDR
	return imageConfig, contentConfig
}
