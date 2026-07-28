// Package output renders command results as either a friendly table
// or machine-readable JSON, depending on the global --json flag.
package output

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"text/tabwriter"
)

// Printer is the per-invocation output sink. It knows whether the
// caller asked for JSON, and which writer to use.
type Printer struct {
	JSON  bool
	Quiet bool
	Out   io.Writer
	Err   io.Writer
}

func New(asJSON, quiet bool) *Printer {
	return &Printer{JSON: asJSON, Quiet: quiet, Out: os.Stdout, Err: os.Stderr}
}

// PrintJSON marshals v as indented JSON to Out. Any marshal error is
// returned to the caller.
func (p *Printer) PrintJSON(v any) error {
	enc := json.NewEncoder(p.Out)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// Printf writes a line to Out unless quiet. Use for human-friendly
// success messages and headers. For machine-readable output, use
// PrintJSON and skip the prose.
func (p *Printer) Printf(format string, args ...any) {
	if p.Quiet {
		return
	}
	_, _ = fmt.Fprintf(p.Out, format+"\n", args...)
}

// Errorf writes a single line to Err.
func (p *Printer) Errorf(format string, args ...any) {
	_, _ = fmt.Fprintf(p.Err, format+"\n", args...)
}

// Table writes a tabwriter-aligned block of rows. Each row is a slice
// of strings. header is the column titles.
func (p *Printer) Table(header []string, rows [][]string) {
	if p.Quiet {
		return
	}
	if p.JSON {
		// When --json is set, prefer machine-readable output even
		// from a Table call. Convert rows into []map[string]string
		// keyed by header for stable output.
		out := make([]map[string]string, 0, len(rows))
		for _, r := range rows {
			m := make(map[string]string, len(header))
			for i, h := range header {
				if i < len(r) {
					m[h] = r[i]
				} else {
					m[h] = ""
				}
			}
			out = append(out, m)
		}
		_ = p.PrintJSON(out)
		return
	}
	tw := tabwriter.NewWriter(p.Out, 0, 0, 2, ' ', 0)
	if len(header) > 0 {
		_, _ = fmt.Fprintln(tw, joinTabs(header))
	}
	for _, r := range rows {
		_, _ = fmt.Fprintln(tw, joinTabs(r))
	}
	_ = tw.Flush()
}

func joinTabs(cols []string) string {
	out := ""
	for i, c := range cols {
		if i > 0 {
			out += "\t"
		}
		out += c
	}
	return out
}
