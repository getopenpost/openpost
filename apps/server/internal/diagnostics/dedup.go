package diagnostics

import (
	"sync"
	"time"
)

// Deduplication keeps repeated background failures from producing one report
// per retry. The first occurrence sends immediately; repeats within the
// window aggregate into occurrence counts, and a summary is emitted when the
// window closes or a sample threshold is crossed.

const (
	dedupeWindow      = 10 * time.Minute
	dedupeSampleEvery = 100
	maxDedupeKeys     = 1024
)

// DedupeKey identifies one repeatable failure. Version is part of the key so
// a fixed bug stops matching the old aggregate after an upgrade.
type DedupeKey struct {
	ErrorCode  string
	ErrorKind  string
	HTTPMethod string
	Operation  string
	Version    string
	Surface    string
}

func dedupeKeyFor(report Report) DedupeKey {
	return DedupeKey{
		ErrorCode:  report.ErrorCode,
		ErrorKind:  report.ErrorKind,
		HTTPMethod: report.HTTPMethod,
		Operation:  report.Operation,
		Version:    report.Version,
		Surface:    report.Surface,
	}
}

type dedupeEntry struct {
	count     int
	firstSeen time.Time
	lastSeen  time.Time
	report    Report
}

// DedupeDecision tells the reporter what to do with an incoming report.
type DedupeDecision int

const (
	// DedupeSend delivers the report immediately (first occurrence, or a
	// periodic sample of a hot failure).
	DedupeSend DedupeDecision = iota
	// DedupeAggregate folds the occurrence into the open window's count.
	DedupeAggregate
	// DedupeWindowSummary delivers one summary for a closed window whose
	// count exceeds the first occurrence already sent.
	DedupeWindowSummary
)

// Deduplicator aggregates repeated failures. It is safe for concurrent use.
type Deduplicator struct {
	mu      sync.Mutex
	entries map[DedupeKey]*dedupeEntry
	now     func() time.Time
}

// NewDeduplicator creates an empty deduplicator using wall-clock time.
func NewDeduplicator() *Deduplicator {
	return &Deduplicator{
		entries: make(map[DedupeKey]*dedupeEntry),
		now:     time.Now,
	}
}

// Observe records report and returns the delivery decision plus the report to
// deliver (with occurrence counts and first/last seen filled in). Callers
// must deliver the returned report when the decision is DedupeSend or
// DedupeWindowSummary.
func (d *Deduplicator) Observe(report Report) (DedupeDecision, Report) {
	now := d.now().UTC()
	key := dedupeKeyFor(report)
	d.mu.Lock()
	defer d.mu.Unlock()

	entry, ok := d.entries[key]
	if !ok {
		if len(d.entries) >= maxDedupeKeys {
			d.evictLocked()
		}
		report.FirstSeen = now
		report.LastSeen = now
		report.OccurrenceCount = 1
		d.entries[key] = &dedupeEntry{count: 1, firstSeen: now, lastSeen: now, report: report}
		return DedupeSend, report
	}
	if now.Sub(entry.firstSeen) >= dedupeWindow {
		summary := entry.report
		summary.OccurrenceCount = entry.count
		summary.LastSeen = entry.lastSeen
		report.FirstSeen = now
		report.LastSeen = now
		report.OccurrenceCount = 1
		d.entries[key] = &dedupeEntry{count: 1, firstSeen: now, lastSeen: now, report: report}
		if summary.OccurrenceCount > 1 {
			return DedupeWindowSummary, summary
		}
		return DedupeSend, report
	}
	entry.count++
	entry.lastSeen = now
	if entry.count%dedupeSampleEvery == 0 {
		sample := report
		sample.FirstSeen = entry.firstSeen
		sample.LastSeen = now
		sample.OccurrenceCount = entry.count
		return DedupeSend, sample
	}
	return DedupeAggregate, Report{}
}

// PendingSummaries closes windows that expired without new occurrences and
// returns one summary per window with more than the already-sent first
// occurrence. Callers should invoke this on a slow tick before flushing.
func (d *Deduplicator) PendingSummaries() []Report {
	now := d.now().UTC()
	d.mu.Lock()
	defer d.mu.Unlock()
	var summaries []Report
	for key, entry := range d.entries {
		if now.Sub(entry.firstSeen) < dedupeWindow {
			continue
		}
		if entry.count > 1 {
			summary := entry.report
			summary.OccurrenceCount = entry.count
			summary.LastSeen = entry.lastSeen
			summaries = append(summaries, summary)
		}
		delete(d.entries, key)
	}
	return summaries
}

// Reset drops all aggregation state. It is used when reporting is disabled so
// no stale counts survive a preference change.
func (d *Deduplicator) Reset() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.entries = make(map[DedupeKey]*dedupeEntry)
}

func (d *Deduplicator) evictLocked() {
	var oldest DedupeKey
	var oldestTime time.Time
	first := true
	for key, entry := range d.entries {
		if first || entry.firstSeen.Before(oldestTime) {
			oldest, oldestTime, first = key, entry.firstSeen, false
		}
	}
	delete(d.entries, oldest)
}
