package commands

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
)

type threadFrontMatter struct {
	Workspace   string
	Accounts    string
	Schedule    string
	RandomDelay int
}

func newThreadCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "thread", Short: "Create multi-post threads"}
	cmd.AddCommand(newThreadCreateCmd())
	return cmd
}

func newThreadCreateCmd() *cobra.Command {
	var flags postFlags
	cmd := &cobra.Command{
		Use:   "create <file>",
		Short: "Create a thread from a markdown file",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			data, err := os.ReadFile(args[0])
			if err != nil {
				return err
			}
			fm, segments, err := parseThreadMarkdown(string(data))
			if err != nil {
				return err
			}
			workspaceFlagChanged := false
			if f := cmd.Flag("workspace"); f != nil {
				workspaceFlagChanged = f.Changed
			}
			if fm.Workspace != "" && !workspaceFlagChanged {
				workspaceID, err := resolveWorkspaceID(cmd.Context(), client, fm.Workspace)
				if err != nil {
					return err
				}
				cfg.Workspace = workspaceID
			}
			workspaceID, err := activeWorkspaceID(cmd, client)
			if err != nil {
				return err
			}
			settings, err := client.GetWorkspaceSettings(cmd.Context(), workspaceID)
			if err != nil {
				return err
			}
			accountCSV := firstSet(flags.accounts, fm.Accounts)
			scheduleRaw := firstSet(flags.schedule, fm.Schedule)
			var randomDelay *int
			if cmd.Flags().Changed("random-delay") {
				randomDelay = &flags.randomDelay
			} else if fm.RandomDelay != 0 {
				randomDelay = &fm.RandomDelay
			}
			accountIDs, err := resolveAccounts(cmd, client, workspaceID, accountCSV)
			if err != nil {
				return err
			}
			scheduledAt, label, err := parseScheduleFlag(cmd, client, workspaceID, scheduleRaw, settings.Timezone)
			if err != nil {
				return err
			}
			if err := confirmNaturalSchedule(cfg.Yes, scheduledAt, label); err != nil {
				return err
			}
			publicationSegments := make([]api.PublicationSegmentInput, 0, len(segments))
			for index, segment := range segments {
				publicationSegments = append(publicationSegments, api.PublicationSegmentInput{ID: fmt.Sprintf("segment-%d", index+1), Body: segment})
			}
			publication, err := client.CreatePublication(cmd.Context(), api.CreatePublicationInput{
				WorkspaceID:        workspaceID,
				Title:              defaultString(firstLineCLI(segments[0]), "Untitled thread"),
				Intent:             "thread",
				CreationPreset:     "thread",
				ContentProfile:     "thread",
				SourceText:         strings.Join(segments, "\n\n"),
				ScheduledAt:        scheduledAt,
				RandomDelayMinutes: randomDelay,
				SocialAccountIDs:   accountIDs,
				Segments:           publicationSegments,
			})
			if err != nil {
				return err
			}
			if scheduledAt != nil {
				if _, err := client.SchedulePublication(cmd.Context(), publication.ID, publication.Revision); err != nil {
					return err
				}
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(publication)
			}
			p.Table([]string{"SEGMENTS", "PUBLICATION_ID", "SCHEDULED"}, [][]string{{
				strconv.Itoa(len(publicationSegments)),
				publication.ID,
				scheduleTimeLabel(scheduledAt),
			}})
			return nil
		},
	}
	cmd.Flags().StringVar(&flags.accounts, "accounts", "", "comma-separated account selectors")
	cmd.Flags().StringVar(&flags.schedule, "schedule", "", "natural-language, RFC3339, next-slot, now, or draft")
	cmd.Flags().IntVar(&flags.randomDelay, "random-delay", 0, "random delay in minutes")
	return cmd
}

func parseThreadMarkdown(input string) (threadFrontMatter, []string, error) {
	input = strings.ReplaceAll(input, "\r\n", "\n")
	lines := strings.Split(input, "\n")
	var fm threadFrontMatter
	start := 0
	if len(lines) > 0 && isRuleLine(lines[0]) {
		end := -1
		for i := 1; i < len(lines); i++ {
			if isRuleLine(lines[i]) {
				end = i
				break
			}
		}
		if end > 0 {
			fm = parseFrontMatter(strings.Join(lines[1:end], "\n"))
			start = end + 1
		}
	}
	var segments []string
	var current []string
	for _, line := range lines[start:] {
		if isRuleLine(line) {
			segments = append(segments, strings.TrimSpace(strings.Join(current, "\n")))
			current = nil
			continue
		}
		current = append(current, line)
	}
	segments = append(segments, strings.TrimSpace(strings.Join(current, "\n")))
	for i, segment := range segments {
		if strings.TrimSpace(segment) == "" {
			return fm, nil, fmt.Errorf("thread segment %d is empty", i+1)
		}
	}
	if len(segments) < 2 {
		return fm, nil, fmt.Errorf("a thread needs at least 2 posts")
	}
	return fm, segments, nil
}

func parseFrontMatter(raw string) threadFrontMatter {
	var fm threadFrontMatter
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		switch strings.TrimSpace(key) {
		case "workspace":
			fm.Workspace = val
		case "accounts":
			fm.Accounts = val
		case "schedule":
			fm.Schedule = val
		case "random_delay":
			fm.RandomDelay, _ = strconv.Atoi(val)
		}
	}
	return fm
}

func isRuleLine(line string) bool {
	return strings.TrimSpace(line) == "---"
}

func firstSet(primary, fallback string) string {
	if strings.TrimSpace(primary) != "" {
		return primary
	}
	return fallback
}

func scheduleTimeLabel(t *time.Time) string {
	if t == nil || t.IsZero() {
		return "draft"
	}
	return t.Format(time.RFC3339)
}
