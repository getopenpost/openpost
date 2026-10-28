package publicationcards

import (
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/textcards"
	"github.com/stretchr/testify/require"
)

type blockingAvatarStorage struct {
	started chan struct{}
	release chan struct{}
}

func (*blockingAvatarStorage) Driver() string { return "local" }
func (*blockingAvatarStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (*blockingAvatarStorage) Delete(context.Context, string) error { return nil }
func (*blockingAvatarStorage) GetURL(string) string                 { return "" }
func (s *blockingAvatarStorage) Open(context.Context, string) (io.ReadCloser, error) {
	s.started <- struct{}{}
	<-s.release
	return io.NopCloser(strings.NewReader("not an avatar")), nil
}

func TestPreviewBoundsRenderingAcrossServiceInstances(t *testing.T) {
	storage := &blockingAvatarStorage{started: make(chan struct{}, 3), release: make(chan struct{})}
	account := models.SocialAccount{AccountAvatarURL: "/avatars/busy"}
	style := textcards.Style{Color: "#ffffff", ColorEnd: "#ffffff"}
	var renders sync.WaitGroup
	// Join every preview on release so blocked work cannot hold a process-wide
	// slot into the next case.
	defer func() {
		close(storage.release)
		renders.Wait()
	}()
	for range 2 {
		renders.Add(1)
		go func() {
			defer renders.Done()
			_, _ = New(nil, storage, nil).Preview(t.Context(), account, "Preview", "", style, 0)
		}()
		<-storage.started
	}
	renders.Add(1)
	busy := make(chan error, 1)
	go func() {
		defer renders.Done()
		_, err := New(nil, storage, nil).Preview(t.Context(), account, "Preview", "", style, 0)
		busy <- err
	}()
	select {
	case err := <-busy:
		require.ErrorIs(t, err, ErrRenderBusy, "a busy renderer must reject excess work")
		require.Empty(t, storage.started, "a rejected preview must not start avatar I/O")
	case <-time.After(time.Second):
		t.Fatal("third preview entered expensive work instead of rejecting it")
	}
}
