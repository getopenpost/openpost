package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/stockmedia"
	"github.com/stretchr/testify/require"
)

type stockAdapterStub struct {
	searches int
}

func (s *stockAdapterStub) Key() string { return "stub" }
func (s *stockAdapterStub) Capabilities() stockmedia.Capabilities {
	return stockmedia.Capabilities{Photos: true}
}
func (s *stockAdapterStub) Search(context.Context, stockmedia.SearchQuery) (stockmedia.SearchPage, error) {
	s.searches++
	return stockmedia.SearchPage{
		Provider: "stub",
		Items: []stockmedia.Asset{{
			ExternalID: "photo:1", Kind: "photo", Title: "Title\x00 with control",
			ThumbnailURL: "https://images.example.test/thumb.jpg",
			SourceURL:    "https://example.test/photo/1",
			CreatorName:  "Creator", Provider: "stub",
		}},
	}, nil
}
func (s *stockAdapterStub) Resolve(context.Context, string) (stockmedia.ResolvedAsset, error) {
	return stockmedia.ResolvedAsset{}, nil
}
func (s *stockAdapterStub) TrackSelection(context.Context, string) error { return nil }

func TestStockSearchCacheReusesNormalizedResponse(t *testing.T) {
	db := createHandlerTestDB(t, (*models.StockSearchCache)(nil))
	adapter := &stockAdapterStub{}
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	handler := &StockMediaHandler{db: db, enabled: true, adapters: map[string]stockmedia.Adapter{"stub": adapter}, now: func() time.Time { return now }}
	query := stockmedia.SearchQuery{Query: "desk", Kind: "photo", Page: 1, PerPage: 24}

	first, hit, err := handler.cachedSearch(context.Background(), adapter, query)
	require.NoError(t, err)
	require.False(t, hit)
	require.Equal(t, 1, adapter.searches)
	require.Equal(t, "Title with control", first.Items[0].Title)

	second, hit, err := handler.cachedSearch(context.Background(), adapter, query)
	require.NoError(t, err)
	require.True(t, hit)
	require.Equal(t, 1, adapter.searches)
	require.Equal(t, first, second)
}

func TestStockSearchCacheRefreshesExpiredEntry(t *testing.T) {
	db := createHandlerTestDB(t, (*models.StockSearchCache)(nil))
	adapter := &stockAdapterStub{}
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	handler := &StockMediaHandler{db: db, enabled: true, adapters: map[string]stockmedia.Adapter{"stub": adapter}, now: func() time.Time { return now }}
	query := stockmedia.SearchQuery{Query: "desk", Kind: "photo", Page: 1, PerPage: 24}

	_, _, err := handler.cachedSearch(context.Background(), adapter, query)
	require.NoError(t, err)
	now = now.Add(20 * time.Minute)
	_, hit, err := handler.cachedSearch(context.Background(), adapter, query)
	require.NoError(t, err)
	require.False(t, hit)
	require.Equal(t, 2, adapter.searches)
}
