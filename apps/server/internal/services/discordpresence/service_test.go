package discordpresence

import (
	"context"
	"sync"
	"testing"
	"testing/synctest"
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

func TestRunSessionKeepsBotOnlineAndRotatesWatchingActivity(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		session := &fakeGatewaySession{updated: make(chan struct{}, 4)}
		service, err := newService("bot-token", Options{RotationInterval: time.Millisecond}, func(string) (gatewaySession, error) {
			return session, nil
		})
		require.NoError(t, err)

		ctx, cancel := context.WithCancel(t.Context())
		done := make(chan error, 1)
		go func() { done <- service.runSession(ctx) }()
		for range 3 {
			select {
			case <-session.updated:
			case <-time.After(time.Second):
				t.Fatal("timed out waiting for Discord presence update")
			}
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
		require.Equal(t, 1, session.opened)
		require.Equal(t, 1, session.closed)
		require.Len(t, session.statuses, 3)
		require.Equal(t, "online", session.statuses[0].Status)
		require.Equal(t, discordgo.ActivityTypeWatching, session.statuses[0].Activities[0].Type)
		require.Equal(t, []string{"your next post", "content on autopilot", "across your socials"}, []string{
			session.statuses[0].Activities[0].Name,
			session.statuses[1].Activities[0].Name,
			session.statuses[2].Activities[0].Name,
		})
	})
}

func TestStreamingPresenceRequiresAndUsesTwitchOrYouTubeURL(t *testing.T) {
	service, err := NewService("bot-token", Options{StreamURL: "https://www.youtube.com/watch?v=openpost"})
	require.NoError(t, err)

	session := &fakeGatewaySession{updated: make(chan struct{}, 1)}
	err = updatePresence(session, 0, service.streamURL)
	require.NoError(t, err)

	session.mu.Lock()
	defer session.mu.Unlock()
	require.Equal(t, discordgo.ActivityTypeStreaming, session.statuses[0].Activities[0].Type)
	require.Equal(t, "https://www.youtube.com/watch?v=openpost", session.statuses[0].Activities[0].URL)
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
