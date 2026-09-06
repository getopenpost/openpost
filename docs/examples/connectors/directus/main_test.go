package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
)

func TestPublishIsIdempotentThroughDirectusOperationField(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	items := map[string]string{}
	created := 0
	initialLookups := 0
	initialLookupsDone := make(chan struct{})
	directus := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/items/posts":
			operationID := request.URL.Query().Get("filter[openpost_operation_id][_eq]")
			mu.Lock()
			itemID := items[operationID]
			initialLookups++
			lookupNumber := initialLookups
			if initialLookups == 2 {
				close(initialLookupsDone)
			}
			mu.Unlock()
			if lookupNumber <= 2 {
				<-initialLookupsDone
			}
			data := []map[string]any{}
			if itemID != "" {
				data = append(data, map[string]any{"id": itemID})
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"data": data})
		case request.Method == http.MethodPost && request.URL.Path == "/items/posts":
			var payload map[string]any
			_ = json.NewDecoder(request.Body).Decode(&payload)
			mu.Lock()
			operationID := payload["openpost_operation_id"].(string)
			if items[operationID] != "" {
				mu.Unlock()
				response.WriteHeader(http.StatusConflict)
				return
			}
			created++
			itemID := "42"
			items[operationID] = itemID
			mu.Unlock()
			_ = json.NewEncoder(response).Encode(map[string]any{"data": map[string]any{"id": itemID}})
		default:
			http.NotFound(response, request)
		}
	}))
	defer directus.Close()
	directusURL, err := url.Parse(directus.URL)
	if err != nil {
		t.Fatal(err)
	}
	srv := &server{config: config{
		connectorToken: "connector-secret", directusURL: directusURL, directusToken: "directus-secret",
		collection: "posts", contentField: "content", titleField: "title",
		descriptionField: "description", statusField: "status", operationField: "openpost_operation_id",
	}, client: directus.Client()}
	connector := httptest.NewServer(srv.routes())
	defer connector.Close()

	payload := publishRequest{
		OperationID: "authorization:one:rendition:publish", ConnectionRef: "directus/posts",
		CapabilityRevision: capabilityRevision, OutputProfile: "directus.item",
		Content: "Hello Directus", Settings: map[string]any{"status": "published"},
	}
	var group sync.WaitGroup
	group.Add(2)
	for range 2 {
		go func() {
			defer group.Done()
			body, _ := json.Marshal(payload)
			request, _ := http.NewRequest(http.MethodPost, connector.URL+"/v1/publishes", bytes.NewReader(body))
			request.Header.Set("Authorization", "Bearer connector-secret")
			request.Header.Set("Content-Type", "application/json")
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Error(err)
				return
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Errorf("status = %d", response.StatusCode)
			}
		}()
	}
	group.Wait()
	mu.Lock()
	defer mu.Unlock()
	if created != 1 {
		t.Fatalf("created %d Directus items, want 1", created)
	}
}
