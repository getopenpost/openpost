//go:build !windows

package database

import (
	"context"
	"errors"
	"os"
	"syscall"
	"time"
)

func acquireMigrationFileLock(ctx context.Context, path string) (func() error, error) {
	lockFile, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	for {
		err = syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return func() error {
				unlockErr := syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN)
				closeErr := lockFile.Close()
				if unlockErr != nil {
					return unlockErr
				}
				return closeErr
			}, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) {
			_ = lockFile.Close()
			return nil, err
		}
		select {
		case <-ctx.Done():
			_ = lockFile.Close()
			return nil, ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
}
