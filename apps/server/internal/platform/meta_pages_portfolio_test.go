package platform

import (
	"context"
	"net/http"
	"testing"
)

// Meta refuses an agency portfolio's client_pages edge when the user did not
// grant every client Page on the consent screen (#522).
const metaClientPagesRefusal = `{"error":{"message":"(#100) Object does not exist, cannot be loaded due to missing permission or reviewable feature, or does not support this operation.","type":"GraphMethodException","code":100}}`

func metaPortfolioGraphURL(path string) string {
	return "https://graph.facebook.com/v25.0/" + path
}

func metaPortfolioToken() *TokenResult {
	return &TokenResult{
		AccessToken: "user-token",
		Extra:       map[string]string{"scope": "pages_show_list " + metaBusinessManagementScope},
	}
}

func withMetaPortfolioGraph(t *testing.T, responses map[string]func(*http.Request) *http.Response) {
	t.Helper()
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		respond, ok := responses[req.URL.Path]
		if !ok {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.Path)
		}
		return respond(req), nil
	})}
}

func metaPageIDs(pages []metaPage) map[string]bool {
	ids := make(map[string]bool, len(pages))
	for _, page := range pages {
		ids[page.ID] = true
	}
	return ids
}

func TestListMetaManagedPagesSkipsARefusedPortfolioEdge(t *testing.T) {
	withMetaPortfolioGraph(t, map[string]func(*http.Request) *http.Response{
		"/v25.0/me/accounts": func(req *http.Request) *http.Response {
			return jsonResponse(req, `{"data":[{"id":"page-1","name":"Granted Page","access_token":"page-1-token"}]}`)
		},
		"/v25.0/me/businesses": func(req *http.Request) *http.Response {
			return jsonResponse(req, `{"data":[{"id":"portfolio-a"},{"id":"portfolio-b"}]}`)
		},
		"/v25.0/portfolio-a/owned_pages":  func(req *http.Request) *http.Response { return jsonResponse(req, `{"data":[]}`) },
		"/v25.0/portfolio-a/client_pages": func(req *http.Request) *http.Response { return jsonResponse(req, `{"data":[]}`) },
		"/v25.0/portfolio-b/owned_pages": func(req *http.Request) *http.Response {
			return jsonResponse(req, `{"data":[{"id":"page-2","name":"Agency Page","access_token":"page-2-token"}]}`)
		},
		"/v25.0/portfolio-b/client_pages": func(req *http.Request) *http.Response {
			return jsonResponseWithStatus(req, http.StatusBadRequest, metaClientPagesRefusal)
		},
	})

	pages, err := listMetaManagedPages(context.Background(), metaPortfolioGraphURL, metaPortfolioToken(), "id,name,access_token", "instagram")
	if err != nil {
		t.Fatalf("a refused client_pages edge must not fail account selection: %v", err)
	}
	ids := metaPageIDs(pages)
	if len(pages) != 2 || !ids["page-1"] || !ids["page-2"] {
		t.Fatalf("expected the granted Page and the portfolio's owned Page, got %#v", pages)
	}
}

func TestListMetaManagedPagesKeepsAccountsWhenPortfolioListingIsRefused(t *testing.T) {
	withMetaPortfolioGraph(t, map[string]func(*http.Request) *http.Response{
		"/v25.0/me/accounts": func(req *http.Request) *http.Response {
			return jsonResponse(req, `{"data":[{"id":"page-1","name":"Granted Page","access_token":"page-1-token"}]}`)
		},
		"/v25.0/me/businesses": func(req *http.Request) *http.Response {
			return jsonResponseWithStatus(req, http.StatusBadRequest, metaClientPagesRefusal)
		},
	})

	pages, err := listMetaManagedPages(context.Background(), metaPortfolioGraphURL, metaPortfolioToken(), "id,name,access_token", "facebook")
	if err != nil {
		t.Fatalf("a refused me/businesses request must not fail account selection: %v", err)
	}
	if len(pages) != 1 || pages[0].ID != "page-1" {
		t.Fatalf("expected the granted Page, got %#v", pages)
	}
}

func TestListMetaManagedPagesFailsWhenNoPageCouldBeLoaded(t *testing.T) {
	withMetaPortfolioGraph(t, map[string]func(*http.Request) *http.Response{
		"/v25.0/me/accounts":   func(req *http.Request) *http.Response { return jsonResponse(req, `{"data":[]}`) },
		"/v25.0/me/businesses": func(req *http.Request) *http.Response { return jsonResponse(req, `{"data":[{"id":"portfolio-b"}]}`) },
		"/v25.0/portfolio-b/owned_pages": func(req *http.Request) *http.Response {
			return jsonResponse(req, `{"data":[]}`)
		},
		"/v25.0/portfolio-b/client_pages": func(req *http.Request) *http.Response {
			return jsonResponseWithStatus(req, http.StatusBadRequest, metaClientPagesRefusal)
		},
	})

	pages, err := listMetaManagedPages(context.Background(), metaPortfolioGraphURL, metaPortfolioToken(), "id,name,access_token", "instagram")
	if err == nil {
		t.Fatalf("expected the portfolio error when no Page could be loaded, got %#v", pages)
	}
}
