package platform

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/synctest"
	"time"
)

func TestMetaPublishPropagation(t *testing.T) {
	for _, target := range []struct {
		name        string
		host        string
		createPath  string
		publishPath string
		code        int
		subcode     int
		carousel    bool
		adapter     Adapter
	}{
		{"threads carousel", "graph.threads.net", "/v1.0/user-1/threads", "/v1.0/user-1/threads_publish", 100, 4279004, true, NewThreadsAdapter("", "", "")},
		{"threads publish", "graph.threads.net", "/v1.0/user-1/threads", "/v1.0/user-1/threads_publish", 24, 4279009, false, NewThreadsAdapter("", "", "")},
		{"instagram publish", "graph.facebook.com", "/v25.0/user-1/media", "/v25.0/user-1/media_publish", 9007, 2207027, false, NewInstagramAdapter("", "", "")},
	} {
		t.Run(target.name, func(t *testing.T) {
			t.Setenv("META_GRAPH_API_VERSION", "v25.0")
			for _, scenario := range []struct {
				name      string
				failures  int
				status    int
				subcode   int
				cancel    bool
				transport bool
				attempts  int
				succeeds  bool
			}{
				{name: "propagation recovers", failures: 2, status: 400, subcode: target.subcode, attempts: 3, succeeds: true},
				{name: "bounded exhaustion", failures: 10, status: 400, subcode: target.subcode, attempts: 5},
				{name: "unrelated rejection", failures: 1, status: 400, subcode: 123, attempts: 1},
				{name: "uncertain server outcome", failures: 1, status: 503, subcode: target.subcode, attempts: 1},
				{name: "uncertain transport outcome", failures: 1, transport: true, attempts: 1},
				{name: "canceled backoff", failures: 1, status: 400, subcode: target.subcode, cancel: true, attempts: 1},
			} {
				t.Run(scenario.name, func(t *testing.T) {
					synctest.Test(t, func(t *testing.T) {
						originalClient := httpClient
						defer func() { httpClient = originalClient }()
						ctx, cancel := context.WithCancel(t.Context())
						defer cancel()
						creates, children, attempts, publishes := 0, 0, 0, 0
						var firstBody string
						httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
							if req.URL.Host != target.host {
								t.Fatalf("unexpected host %s", req.URL.Host)
							}
							if req.Method == http.MethodGet {
								return jsonResponse(req, `{"status":"FINISHED","status_code":"FINISHED"}`), nil
							}
							if err := req.ParseForm(); err != nil {
								t.Fatal(err)
							}
							isParent := req.URL.Path == target.createPath && req.Form.Get("media_type") == "CAROUSEL"
							isPublish := req.URL.Path == target.publishPath
							if isPublish {
								publishes++
							}
							if (target.carousel && isParent) || (!target.carousel && isPublish) {
								attempts++
								body := req.Form.Encode()
								if attempts == 1 {
									firstBody = body
								} else if body != firstBody {
									t.Fatal("retry changed the container references or payload")
								}
								if target.carousel && req.Form.Get("children") != "child-1,child-2" {
									t.Fatalf("unexpected children %s", req.Form.Get("children"))
								}
								if isPublish && req.Form.Get("creation_id") != "container-1" {
									t.Fatal("publish must reuse the prepared container")
								}
								if attempts <= scenario.failures {
									if scenario.cancel {
										time.AfterFunc(time.Second, cancel)
									}
									if scenario.transport {
										return nil, errors.New("connection lost")
									}
									return &http.Response{StatusCode: scenario.status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(fmt.Sprintf(`{"error":{"code":%d,"error_subcode":%d,"fbtrace_id":"trace-1"}}`, target.code, scenario.subcode))), Request: req}, nil
								}
							}
							if req.URL.Path == target.createPath {
								if req.Form.Get("is_carousel_item") == "true" {
									children++
									return jsonResponse(req, fmt.Sprintf(`{"id":"child-%d"}`, children)), nil
								}
								creates++
								return jsonResponse(req, `{"id":"container-1"}`), nil
							}
							if isPublish {
								return jsonResponse(req, `{"id":"post-1"}`), nil
							}
							t.Fatalf("unexpected request %s %s", req.Method, req.URL.Path)
							return nil, nil
						})}
						request := &PublishRequest{Content: "Launch", PlatformMediaIDs: []string{"https://media.example/image.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}}}
						if target.carousel {
							request.PlatformMediaIDs = append(request.PlatformMediaIDs, "https://media.example/video.mp4")
							request.Media = append(request.Media, MediaItem{MimeType: "video/mp4"})
						}
						started := time.Now()
						result, err := target.adapter.Publish(ctx, "token", "user-1", request)
						if attempts != scenario.attempts {
							t.Fatalf("attempts=%d, want %d; err=%v", attempts, scenario.attempts, err)
						}
						if scenario.succeeds {
							if err != nil || result.ExternalID != "post-1" {
								t.Fatalf("publish result=%+v err=%v", result, err)
							}
							if time.Since(started) < 4*time.Second {
								t.Fatal("propagation retries must back off")
							}
						} else if err == nil {
							t.Fatal("expected publish failure")
						}
						if scenario.cancel && (!errors.Is(err, context.Canceled) || time.Since(started) != time.Second) {
							t.Fatalf("expected cancellation, got %v", err)
						}
						if !scenario.succeeds && !scenario.cancel && !scenario.transport {
							var providerErr *HTTPError
							if !errors.As(err, &providerErr) || providerErr.Subcode != fmt.Sprint(scenario.subcode) || providerErr.TraceID != "trace-1" {
								t.Fatalf("lost provider diagnostics: %v", err)
							}
						}
						expectedCreates, expectedChildren := 1, 0
						if target.carousel {
							expectedChildren = 2
							if !scenario.succeeds {
								expectedCreates = 0
							}
						}
						if creates != expectedCreates || children != expectedChildren {
							t.Fatalf("recreated media: creates=%d children=%d", creates, children)
						}
						if target.carousel && ((!scenario.succeeds && publishes != 0) || (scenario.succeeds && publishes != 1)) {
							t.Fatalf("unexpected final publications: %d", publishes)
						}
					})
				})
			}
		})
	}
}
