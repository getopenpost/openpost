package discordpresence

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/stretchr/testify/require"
)

type fakeGatewaySession struct {
	mu       sync.Mutex
	opened   int
	closed   int
	statuses []discordgo.UpdateStatusData
	updated  chan struct{}
	connect  func(*discordgo.Session, *discordgo.Connect)
}

func (f *fakeGatewaySession) AddHandler(handler interface{}) func() {
	f.mu.Lock()
	if connect, ok := handler.(func(*discordgo.Session, *discordgo.Connect)); ok {
		f.connect = connect
	}
	f.mu.Unlock()
	return func() {}
}

func (f *fakeGatewaySession) Open() error {
	f.mu.Lock()
	f.opened++
	f.mu.Unlock()
	return nil
}

func (f *fakeGatewaySession) Close() error {
	f.mu.Lock()
	f.closed++
	f.mu.Unlock()
	return nil
}

func (f *fakeGatewaySession) UpdateStatusComplex(status discordgo.UpdateStatusData) error {
	f.mu.Lock()
	f.statuses = append(f.statuses, status)
	f.mu.Unlock()
	f.updated <- struct{}{}
	return nil
}

func (f *fakeGatewaySession) fireConnect() {
	f.mu.Lock()
	connect := f.connect
	f.mu.Unlock()
	if connect != nil {
		connect(nil, nil)
	}
}

func TestRunSessionRestoresPresenceAfterGatewayReconnect(t *testing.T) {
	session := &fakeGatewaySession{updated: make(chan struct{}, 4)}
	service, err := newService("bot-token", Options{RotationInterval: time.Hour}, func(string) (gatewaySession, error) {
		return session, nil
	})
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- service.runSession(ctx) }()
	select {
	case <-session.updated:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for initial Discord presence update")
	}

	session.fireConnect()
	select {
	case <-session.updated:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for reconnect presence update")
	}
	cancel()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("Discord presence session did not stop")
	}

	session.mu.Lock()
	defer session.mu.Unlock()
	require.Len(t, session.statuses, 2)
	require.Equal(t, "your next post", session.statuses[1].Activities[0].Name)
}

func TestNewServiceRejectsInvalidStreamingURL(t *testing.T) {
	_, err := NewService("bot-token", Options{StreamURL: "https://openpo.st/live"})

	require.ErrorContains(t, err, "Twitch or YouTube")
}
