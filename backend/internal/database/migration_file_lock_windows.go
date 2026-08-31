package database

import (
	"context"
	"errors"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

func acquireMigrationFileLock(ctx context.Context, path string) (func() error, error) {
	lockFile, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	overlapped := new(windows.Overlapped)
	for {
		err = windows.LockFileEx(
			windows.Handle(lockFile.Fd()),
			windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
			0,
			1,
			0,
			overlapped,
		)
		if err == nil {
			return func() error {
				unlockErr := windows.UnlockFileEx(windows.Handle(lockFile.Fd()), 0, 1, 0, overlapped)
				closeErr := lockFile.Close()
				if unlockErr != nil {
					return unlockErr
				}
				return closeErr
			}, nil
		}
		if !errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
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
