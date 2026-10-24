package instancebackup

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"
)

var installMedia = moveContents

type RestorePoint struct {
	Name      string
	CreatedAt time.Time
	Bytes     int64
}

func ApplyPending(paths Paths, now time.Time) (bool, error) {
	pending, err := ReadPending(paths)
	if err != nil {
		return false, fmt.Errorf("read staged restore: %w", err)
	}
	if pending == nil {
		if err := os.RemoveAll(paths.PendingDir()); err != nil {
			return false, err
		}
		return false, nil
	}

	restorePoint := filepath.Join(paths.dataDir(), restorePointPrefix+now.UTC().Format("20060102T150405Z"))
	if err := os.MkdirAll(restorePoint, 0o700); err != nil {
		return false, err
	}

	var undo undoStack
	err = setAsideCurrentData(paths, restorePoint, &undo)
	if err == nil {
		err = installStagedData(paths, &undo)
	}
	if err != nil {
		if rollbackErr := undo.run(); rollbackErr != nil {
			return false, fmt.Errorf("%w; rollback incomplete, the previous data may still be in %s: %w", err, restorePoint, rollbackErr)
		}
		removeEmptyRestorePoint(restorePoint)
		return false, err
	}

	if err := os.Remove(filepath.Join(paths.PendingDir(), pendingMarkerName)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return true, fmt.Errorf("restore applied but the staged marker could not be removed: %w", err)
	}
	if err := os.RemoveAll(paths.PendingDir()); err != nil {
		log.Printf("restore applied but staging cleanup failed: %v", err)
	}
	return true, nil
}

func removeEmptyRestorePoint(restorePoint string) {
	_ = os.Remove(filepath.Join(restorePoint, "media"))
	_ = os.Remove(restorePoint)
}

type undoStack []func() error

func (u *undoStack) push(step func() error) {
	*u = append(*u, step)
}

func (u undoStack) run() error {
	var failures []error
	for index := len(u) - 1; index >= 0; index-- {
		if err := u[index](); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func setAsideCurrentData(paths Paths, restorePoint string, undo *undoStack) error {
	for _, suffix := range []string{"", "-wal", "-shm"} {
		source := paths.DatabaseFile + suffix
		destination := filepath.Join(restorePoint, filepath.Base(paths.DatabaseFile)+suffix)
		moved, err := moveIfExists(source, destination)
		if err != nil {
			return fmt.Errorf("set aside current database: %w", err)
		}
		if moved {
			undo.push(func() error { return moveEntry(destination, source) })
		}
	}
	if paths.MediaDir == "" {
		return nil
	}
	moved, err := moveContents(paths.MediaDir, filepath.Join(restorePoint, "media"))
	if err != nil {
		return fmt.Errorf("set aside current media: %w", err)
	}
	if len(moved) > 0 {
		undo.push(func() error { return moveBack(moved) })
	}
	return nil
}

func installStagedData(paths Paths, undo *undoStack) error {
	stagedDatabase := filepath.Join(paths.PendingDir(), filepath.FromSlash(databaseEntry))
	if err := moveEntry(stagedDatabase, paths.DatabaseFile); err != nil {
		return fmt.Errorf("install restored database: %w", err)
	}
	undo.push(func() error { return moveEntry(paths.DatabaseFile, stagedDatabase) })
	if paths.MediaDir == "" {
		return nil
	}
	if err := os.MkdirAll(paths.MediaDir, 0o755); err != nil {
		return err
	}
	if _, err := installMedia(filepath.Join(paths.PendingDir(), "media"), paths.MediaDir); err != nil {
		return fmt.Errorf("install restored media: %w", err)
	}
	return nil
}

type movedEntry struct {
	from string
	to   string
}

func moveBack(entries []movedEntry) error {
	var firstErr error
	for _, entry := range entries {
		if err := moveEntry(entry.to, entry.from); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func moveContents(sourceDir, destinationDir string) ([]movedEntry, error) {
	entries, err := os.ReadDir(sourceDir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, nil
	}
	if err := os.MkdirAll(destinationDir, 0o755); err != nil {
		return nil, err
	}
	var moved []movedEntry
	for _, entry := range entries {
		from := filepath.Join(sourceDir, entry.Name())
		to := filepath.Join(destinationDir, entry.Name())
		if err := moveEntry(from, to); err != nil {
			_ = moveBack(moved)
			return nil, err
		}
		moved = append(moved, movedEntry{from: from, to: to})
	}
	return moved, nil
}

func moveIfExists(source, destination string) (bool, error) {
	if _, err := os.Lstat(source); errors.Is(err, fs.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	if err := moveEntry(source, destination); err != nil {
		return false, err
	}
	return true, nil
}

func moveEntry(source, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	if err := os.Rename(source, destination); err == nil {
		return nil
	}
	if err := copyTree(source, destination); err != nil {
		_ = os.RemoveAll(destination)
		return err
	}
	return os.RemoveAll(source)
}

func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			_ = out.Close()
			return err
		}
		return out.Close()
	})
}

func ListRestorePoints(paths Paths) ([]RestorePoint, error) {
	entries, err := os.ReadDir(paths.dataDir())
	if err != nil {
		return nil, err
	}
	var points []RestorePoint
	for _, entry := range entries {
		if !entry.IsDir() || !restorePointNamePattern.MatchString(entry.Name()) {
			continue
		}
		createdAt, err := time.Parse("20060102T150405Z", entry.Name()[len(restorePointPrefix):])
		if err != nil {
			continue
		}
		points = append(points, RestorePoint{
			Name:      entry.Name(),
			CreatedAt: createdAt,
			Bytes:     directorySize(filepath.Join(paths.dataDir(), entry.Name())),
		})
	}
	sort.Slice(points, func(i, j int) bool { return points[i].CreatedAt.After(points[j].CreatedAt) })
	return points, nil
}

func DeleteRestorePoint(paths Paths, name string) error {
	if !restorePointNamePattern.MatchString(name) {
		return fs.ErrNotExist
	}
	target := filepath.Join(paths.dataDir(), name)
	if _, err := os.Stat(target); err != nil {
		return err
	}
	return os.RemoveAll(target)
}

func directorySize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.Type().IsRegular() {
			return nil
		}
		if info, infoErr := entry.Info(); infoErr == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}
