package providerinbox

import (
	"context"
	"errors"
	"math/rand/v2"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type transportLease struct {
	bun.BaseModel `bun:"table:provider_inbox_transport_leases"`
	AccountID     string `bun:",pk"`
	Owner         string
	ExpiresAt     int64
}

// RunLeasedStream supervises one account transport. The worker scheduler calls
// it for eligible accounts; competing workers share a database lease. eligible
// must recheck feature opt-in, active account and authorization. connect should
// resolve current tokens and call MessageStreamAdapter.StreamMessageEvents;
// its connected callback repairs REST gaps before applying buffered live events.
// Cancellation or failed renewal cancels the stream before the lease expires.
func (s *Service) RunLeasedStream(ctx context.Context, accountID string, eligible func(context.Context) (bool, error), connect func(context.Context) error) error {
	if eligible == nil || connect == nil || accountID == "" {
		return errors.New("provider stream callbacks unavailable")
	}
	owner := uuid.NewString()
	delay := time.Second
	for ctx.Err() == nil {
		checkCtx, checkCancel := context.WithTimeout(ctx, 5*time.Second)
		allowed, err := eligible(checkCtx)
		checkCancel()
		if err != nil {
			return err
		}
		if !allowed {
			return nil
		}
		lease, err := s.acquireTransportLease(ctx, accountID, owner)
		if err != nil {
			return err
		}
		if lease == nil {
			return nil
		}
		started := s.now()
		if err = s.runTransportLease(ctx, *lease, eligible, connect); err != nil {
			return err
		}
		if s.now().Sub(started) > time.Minute {
			delay = time.Second
		}
		timer := time.NewTimer(delay + time.Duration(rand.Int64N(int64(delay/2+1))))
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		delay = min(delay*2, time.Minute)
	}
	return ctx.Err()
}

func (s *Service) acquireTransportLease(ctx context.Context, accountID, owner string) (*transportLease, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	now := s.now()
	lease := transportLease{AccountID: accountID, Owner: owner, ExpiresAt: now.Add(time.Minute).UnixMilli()}
	result, err := s.db.NewInsert().Model(&lease).On("CONFLICT (account_id) DO UPDATE").Set("owner = EXCLUDED.owner").Set("expires_at = EXCLUDED.expires_at").Where("transport_lease.expires_at <= ?", now.UnixMilli()).Exec(ctx)
	if err != nil {
		return nil, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, nil
	}
	return &lease, nil
}

func (s *Service) renewTransportLease(ctx context.Context, accountID, owner string) (time.Time, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	now := s.now()
	result, err := s.db.NewUpdate().Model((*transportLease)(nil)).Set("expires_at = ?", now.Add(time.Minute).UnixMilli()).Where("account_id = ? AND owner = ? AND expires_at > ?", accountID, owner, now.UnixMilli()).Exec(ctx)
	if err != nil {
		return time.Time{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return time.Time{}, err
	}
	if count == 0 {
		return time.Time{}, errors.New("provider stream lease lost")
	}
	return now.Add(time.Minute), nil
}

func (s *Service) runTransportLease(ctx context.Context, lease transportLease, eligible func(context.Context) (bool, error), connect func(context.Context) error) error {
	streamCtx, cancel, renewDeadline := transportLeaseContext(ctx, time.UnixMilli(lease.ExpiresAt).Add(-5*time.Second))
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- connect(streamCtx) }()
	finished, err := s.monitorTransportLease(streamCtx, lease.AccountID, lease.Owner, eligible, done, renewDeadline)
	cancel()
	if !finished {
		select {
		case <-done: //nolint:errcheck // cancellation already decided the outcome
		case <-time.After(5 * time.Second):
			return errors.New("provider stream did not stop after cancellation")
		}
	}
	cleanupCtx, cleanupCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cleanupCancel()
	_, releaseErr := s.db.NewDelete().Model((*transportLease)(nil)).Where("account_id = ? AND owner = ?", lease.AccountID, lease.Owner).Exec(cleanupCtx)
	if releaseErr != nil {
		return releaseErr
	}
	return err
}

func (s *Service) monitorTransportLease(ctx context.Context, accountID, owner string, eligible func(context.Context) (bool, error), done <-chan error, renewDeadline func(time.Time)) (bool, error) {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done: //nolint:errcheck // disconnects are retried by the outer supervisor
			// Provider disconnects are retried with jitter by the outer supervisor.
			// The connect callback may record a safe provider failure for account health.
			return true, nil
		case <-ctx.Done():
			return false, ctx.Err()
		case <-ticker.C:
			checkCtx, checkCancel := context.WithTimeout(ctx, 5*time.Second)
			allowed, err := eligible(checkCtx)
			checkCancel()
			if err != nil {
				return false, err
			}
			if !allowed {
				return false, nil
			}
			expires, err := s.renewTransportLease(ctx, accountID, owner)
			if err != nil {
				return false, err
			}
			renewDeadline(expires.Add(-5 * time.Second))
		}
	}
}

// transportLeaseContext cancels independently of a stalled monitor or database
// operation. Only a confirmed renewal may extend the upstream consumer's life.
func transportLeaseContext(parent context.Context, deadline time.Time) (context.Context, context.CancelFunc, func(time.Time)) {
	ctx, cancel := context.WithCancel(parent)
	timer := time.AfterFunc(time.Until(deadline), cancel)
	stop := func() { timer.Stop(); cancel() }
	renew := func(deadline time.Time) { timer.Reset(time.Until(deadline)) }
	return ctx, stop, renew
}
