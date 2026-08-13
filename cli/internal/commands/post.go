package commands

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/accountpicker"
	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/config"
	"github.com/openpost/cli/internal/schedule"
)

type postFlags struct {
	content     string
	file        string
	accounts    string
	schedule    string
	media       []string
	mediaAlt    []string
	threadDraft string
	randomDelay int
	limit       int
	offset      int
	status      string
}

func newPostCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "post", Short: "Create, list, view, update, and delete posts"}
	cmd.AddCommand(newPostCreateCmd())
	cmd.AddCommand(newPostListCmd())
	cmd.AddCommand(newPostViewCmd())
	cmd.AddCommand(newPostUpdateCmd())
	cmd.AddCommand(newPostDeleteCmd())
	return cmd
}

func newPostCreateCmd() *cobra.Command {
	var flags postFlags
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a draft or scheduled post",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, client, workspaceID, settings, err := postRuntime(cmd)
			if err != nil {
				return err
			}
			content, err := contentFromFlags(flags.content, flags.file)
			if err != nil {
				return err
			}
			accountIDs, err := resolveAccounts(cmd, client, workspaceID, flags.accounts)
			if err != nil {
				return err
			}
			scheduledAt, label, err := parseScheduleFlag(cmd, client, workspaceID, flags.schedule, settings.Timezone)
			if err != nil {
				return err
			}
			if err := confirmNaturalSchedule(cfg.Yes, scheduledAt, label); err != nil {
				return err
			}
			mediaIDs, err := resolveMedia(cmd, client, workspaceID, flags.media, flags.mediaAlt)
			if err != nil {
				return err
			}
			var threadDraft *string
			if flags.threadDraft != "" {
				threadDraft = &flags.threadDraft
			}
			scheduledAtText := optionalScheduleText(scheduledAt)
			intent := "post"
			profile := "short_text"
			if threadDraft != nil {
				intent = "thread"
				profile = "thread"
			}
			result, err := client.CreateTextPostDraft(cmd.Context(), api.CreateTextPostDraftInput{
				WorkspaceID:        workspaceID,
				Content:            content,
				ScheduledAt:        scheduledAtText,
				SocialAccountIDs:   accountIDs,
				MediaIDs:           mediaIDs,
				RandomDelayMinutes: flags.randomDelay,
				ThreadDraft:        threadDraft,
				Publication: api.TextPostPublicationInput{
					Intent:         &intent,
					ContentProfile: &profile,
					SourceText:     &content,
					ScheduledAt:    scheduledAt,
				},
			})
			if err != nil {
				return err
			}
			if scheduledAt != nil {
				if _, err := client.SchedulePublication(cmd.Context(), result.PublicationID, result.Revision); err != nil {
					return err
				}
			}
			post, err := client.GetPost(cmd.Context(), result.PostID)
			if err != nil {
				return err
			}
			return printPostSummary(cfg, post)
		},
	}
	addCreatePostFlags(cmd, &flags)
	return cmd
}

func newPostListCmd() *cobra.Command {
	var flags postFlags
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List posts",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, client, workspaceID, _, err := postRuntime(cmd)
			if err != nil {
				return err
			}
			posts, err := client.ListPosts(cmd.Context(), api.ListPostsInput{WorkspaceID: workspaceID, Status: flags.status, Limit: flags.limit, Offset: flags.offset})
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(posts)
			}
			rows := make([][]string, 0, len(posts))
			for _, post := range posts {
				rows = append(rows, []string{
					post.ID,
					post.Status,
					scheduleLabel(post.ScheduledAt),
					preview(post.Content, 80),
					strconv.Itoa(len(post.Destinations)),
				})
			}
			p.Table([]string{"ID", "STATUS", "SCHEDULED", "CONTENT", "ACCOUNTS"}, rows)
			return nil
		},
	}
	cmd.Flags().StringVar(&flags.status, "status", "", "filter by status: draft, scheduled, published, failed")
	cmd.Flags().IntVar(&flags.limit, "limit", 0, "maximum number of posts to return")
	cmd.Flags().IntVar(&flags.offset, "offset", 0, "number of posts to skip")
	return cmd
}

func newPostViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "view <post-id>",
		Short: "View a post",
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
			post, err := client.GetPost(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(post)
			}
			p.Table([]string{"FIELD", "VALUE"}, [][]string{
				{"id", post.ID},
				{"workspace_id", post.WorkspaceID},
				{"created_by", post.CreatedBy},
				{"status", post.Status},
				{"scheduled_at", scheduleLabel(post.ScheduledAt)},
				{"actual_run_at", emptyDash(post.ActualRunAt)},
				{"created_at", emptyDash(post.CreatedAt)},
				{"random_delay_minutes", strconv.Itoa(post.RandomDelayMinutes)},
				{"content", post.Content},
				{"media_count", strconv.Itoa(len(post.Media) + len(post.MediaIDs))},
				{"destination_count", strconv.Itoa(len(post.Destinations))},
			})
			for _, d := range post.Destinations {
				p.Printf("destination %s\t%s\t%s\t%s", d.SocialAccountID, d.Platform, d.Status, emptyDash(d.ErrorMessage))
			}
			for _, rendition := range post.Renditions {
				p.Printf("rendition %s\tunsynced=%t\tmedia=%s\teffective_media=%s\t%s", rendition.SocialAccountID, rendition.IsUnsynced, rendition.MediaMode, strings.Join(rendition.EffectiveMediaIDs, ","), rendition.Content)
			}
			return nil
		},
	}
}

func newPostUpdateCmd() *cobra.Command {
	var flags postFlags
	cmd := &cobra.Command{
		Use:   "update <post-id>",
		Short: "Update a draft or scheduled post",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, client, workspaceID, settings, err := postRuntime(cmd)
			if err != nil {
				return err
			}
			current, err := client.GetPost(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			in := api.SaveTextPostDraftInput{
				ExpectedRevision:   current.Revision,
				Content:            current.Content,
				SocialAccountIDs:   postDestinationIDs(current),
				MediaIDs:           postMediaIDs(current),
				RandomDelayMinutes: current.RandomDelayMinutes,
				ThreadDraft:        current.ThreadDraft,
				Variants:           textPostVariants(current),
			}
			changed := false
			if cmd.Flags().Changed("content") {
				in.Content = flags.content
				in.Publication.SourceText = &flags.content
				changed = true
			}
			if cmd.Flags().Changed("accounts") {
				accountIDs, err := resolveAccounts(cmd, client, workspaceID, flags.accounts)
				if err != nil {
					return err
				}
				in.SocialAccountIDs = accountIDs
				changed = true
			}
			if cmd.Flags().Changed("schedule") {
				if flags.schedule == "" || strings.EqualFold(strings.TrimSpace(flags.schedule), "draft") {
					empty := ""
					in.ScheduledAt = &empty
					in.Publication.ClearSchedule = true
				} else {
					t, label, err := parseScheduleFlag(cmd, client, workspaceID, flags.schedule, settings.Timezone)
					if err != nil {
						return err
					}
					if t == nil {
						return fmt.Errorf("--schedule must resolve to a future time or draft")
					}
					if err := confirmNaturalSchedule(cfg.Yes, t, label); err != nil {
						return err
					}
					v := t.Format(time.RFC3339)
					in.ScheduledAt = &v
					in.Publication.ScheduledAt = t
				}
				changed = true
			}
			if cmd.Flags().Changed("random-delay") {
				in.RandomDelayMinutes = flags.randomDelay
				changed = true
			}
			if cmd.Flags().Changed("media") {
				mediaIDs, err := resolveMedia(cmd, client, workspaceID, flags.media, flags.mediaAlt)
				if err != nil {
					return err
				}
				in.MediaIDs = mediaIDs
				changed = true
			}
			if !changed {
				return fmt.Errorf("at least one update flag is required")
			}
			if _, err := client.SaveTextPostDraft(cmd.Context(), args[0], in); err != nil {
				return err
			}
			post, err := client.GetPost(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			return printPostSummary(cfg, post)
		},
	}
	cmd.Flags().StringVar(&flags.content, "content", "", "post content")
	cmd.Flags().StringVar(&flags.schedule, "schedule", "", "natural-language, RFC3339, next-slot, now, or draft; empty string unschedules")
	cmd.Flags().StringVar(&flags.accounts, "accounts", "", "comma-separated account selectors")
	cmd.Flags().IntVar(&flags.randomDelay, "random-delay", 0, "random delay in minutes")
	cmd.Flags().StringArrayVar(&flags.media, "media", nil, "replacement media id or local file path; repeatable; pass an empty value to clear")
	cmd.Flags().StringArrayVar(&flags.mediaAlt, "media-alt", nil, "alt text for the matching uploaded --media")
	return cmd
}

func newPostDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <post-id>",
		Short: "Delete a draft or scheduled post",
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
			ok, err := confirmMutation(cfg, fmt.Sprintf("Delete post %s?", args[0]))
			if err != nil {
				return err
			}
			if !ok {
				printerFrom(cfg).Printf("Canceled.")
				return nil
			}
			if err := client.DeletePost(cmd.Context(), args[0]); err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(map[string]string{"id": args[0], "status": "deleted"})
			}
			p.Printf("Deleted post %s.", args[0])
			return nil
		},
	}
}

func addCreatePostFlags(cmd *cobra.Command, flags *postFlags) {
	cmd.Flags().StringVar(&flags.content, "content", "", "post content")
	cmd.Flags().StringVar(&flags.file, "file", "", "read post content from a file")
	cmd.Flags().StringVar(&flags.accounts, "accounts", "", "comma-separated account selectors")
	cmd.Flags().StringVar(&flags.schedule, "schedule", "", "natural-language, RFC3339, next-slot, now, or draft")
	cmd.Flags().StringArrayVar(&flags.media, "media", nil, "media id or local file path; repeatable")
	cmd.Flags().StringArrayVar(&flags.mediaAlt, "media-alt", nil, "alt text for the matching uploaded --media")
	cmd.Flags().StringVar(&flags.threadDraft, "thread-draft", "", "encoded thread draft to attach")
	cmd.Flags().IntVar(&flags.randomDelay, "random-delay", 0, "random delay in minutes")
}

func postRuntime(cmd *cobra.Command) (*config.Runtime, *api.Client, string, *api.WorkspaceSettings, error) {
	cfg, err := runtimeFrom(cmd)
	if err != nil {
		return nil, nil, "", nil, err
	}
	client, err := clientFrom(cfg)
	if err != nil {
		return nil, nil, "", nil, err
	}
	workspaceID, err := activeWorkspaceID(cmd, client)
	if err != nil {
		return nil, nil, "", nil, err
	}
	settings, err := client.GetWorkspaceSettings(cmd.Context(), workspaceID)
	if err != nil {
		return nil, nil, "", nil, err
	}
	return cfg, client, workspaceID, settings, nil
}

func contentFromFlags(content, file string) (string, error) {
	if file == "" {
		return content, nil
	}
	if file == "-" {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", err
		}
		return strings.TrimSuffix(strings.TrimSuffix(string(data), "\n"), "\r"), nil
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(strings.TrimSuffix(string(data), "\n"), "\r"), nil
}

func parseScheduleFlag(cmd *cobra.Command, client *api.Client, workspaceID, raw, workspaceTZ string) (*time.Time, string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, "", nil
	}
	if isNextSlotSchedule(raw) {
		out, err := client.NextAvailableSlot(cmd.Context(), api.NextAvailableSlotInput{WorkspaceID: workspaceID})
		if err != nil {
			return nil, "", err
		}
		if strings.TrimSpace(out.SlotTime) == "" {
			return nil, "", fmt.Errorf("no next posting slot available: %s", out.Message)
		}
		t, err := time.Parse(time.RFC3339, out.SlotTime)
		if err != nil {
			return nil, "", fmt.Errorf("server returned invalid next slot %q: %w", out.SlotTime, err)
		}
		return &t, "slot", nil
	}
	cfg, err := runtimeFrom(cmd)
	if err != nil {
		return nil, "", err
	}
	loc := schedule.MustLoadLocation(cfg.Profile.Timezone)
	res, err := schedule.Parse(raw, schedule.Options{Now: time.Now(), DefaultLocation: loc, WorkspaceTimezone: workspaceTZ})
	if err != nil {
		return nil, "", err
	}
	if res.Time.IsZero() {
		return nil, "", nil
	}
	return &res.Time, res.Source, nil
}

func isNextSlotSchedule(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "next-slot", "next slot", "slot":
		return true
	default:
		return false
	}
}

func optionalScheduleText(value *time.Time) *string {
	if value == nil {
		return nil
	}
	text := value.Format(time.RFC3339)
	return &text
}

func postDestinationIDs(post *api.Post) []string {
	ids := make([]string, 0, len(post.Destinations))
	for _, destination := range post.Destinations {
		ids = append(ids, destination.SocialAccountID)
	}
	return ids
}

func postMediaIDs(post *api.Post) []string {
	if len(post.MediaIDs) > 0 {
		return append([]string(nil), post.MediaIDs...)
	}
	ids := make([]string, 0, len(post.Media))
	for _, media := range post.Media {
		ids = append(ids, media.MediaID)
	}
	return ids
}

func textPostVariants(post *api.Post) []api.TextPostVariantInput {
	variants := make([]api.TextPostVariantInput, 0, len(post.Renditions))
	for _, rendition := range post.Renditions {
		content := rendition.Content
		var mediaIDs *string
		switch rendition.MediaMode {
		case "clear", "override":
			encoded, err := json.Marshal(rendition.MediaIDs)
			if err == nil {
				value := string(encoded)
				mediaIDs = &value
			}
		}
		variants = append(variants, api.TextPostVariantInput{
			SocialAccountID: rendition.SocialAccountID,
			Content:         &content,
			MediaIDs:        mediaIDs,
			IsUnsynced:      rendition.IsUnsynced,
		})
	}
	return variants
}

func confirmNaturalSchedule(skip bool, t *time.Time, source string) error {
	if skip || t == nil || source != "natural" {
		return nil
	}
	ok, err := askYesNo(fmt.Sprintf("Schedule for %s? [Y/n] ", t.Format("Jan 02 2006 15:04 MST")), true)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("cancelled")
	}
	return nil
}

func askYesNo(prompt string, def bool) (bool, error) {
	fmt.Fprint(os.Stderr, prompt)
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil && strings.TrimSpace(line) == "" {
		return false, err
	}
	line = strings.ToLower(strings.TrimSpace(line))
	if line == "" {
		return def, nil
	}
	return line == "y" || line == "yes", nil
}

func resolveAccounts(cmd *cobra.Command, client *api.Client, workspaceID, csv string) ([]string, error) {
	selectors := splitCSV(csv)
	if len(selectors) == 0 {
		return nil, nil
	}
	accounts, err := client.ListAccounts(cmd.Context(), workspaceID)
	if err != nil {
		return nil, err
	}
	return accountpicker.Resolve(workspaceID, selectors, accounts)
}

func resolveMedia(cmd *cobra.Command, client *api.Client, workspaceID string, mediaValues, altValues []string) ([]string, error) {
	inputs := resolveMediaInputs(mediaValues, altValues)
	existing := map[string]bool{}
	list, _ := client.ListMedia(cmd.Context(), workspaceID, 200)
	for _, item := range list {
		existing[item.ID] = true
	}
	out := make([]string, 0, len(inputs))
	for _, input := range inputs {
		value := input.value
		if strings.HasPrefix(value, "med_") || existing[value] {
			out = append(out, value)
			continue
		}
		if input.localFile {
			media, err := client.UploadMedia(cmd.Context(), workspaceID, value, input.alt)
			if err != nil {
				return nil, err
			}
			out = append(out, media.ID)
			continue
		}
		return nil, fmt.Errorf("media %q is not an existing file or known media id", value)
	}
	return out, nil
}

type mediaInput struct {
	value     string
	alt       string
	localFile bool
}

func resolveMediaInputs(mediaValues, altValues []string) []mediaInput {
	inputs := make([]mediaInput, 0, len(mediaValues))
	for i, value := range mediaValues {
		if st, err := os.Stat(value); err == nil && !st.IsDir() {
			alt := ""
			if i < len(altValues) {
				alt = altValues[i]
			}
			inputs = append(inputs, mediaInput{value: value, alt: alt, localFile: true})
			continue
		}
		for _, item := range splitCSV(value) {
			st, err := os.Stat(item)
			inputs = append(inputs, mediaInput{
				value:     item,
				localFile: err == nil && !st.IsDir(),
			})
		}
	}
	return inputs
}

func splitCSV(csv string) []string {
	if strings.TrimSpace(csv) == "" {
		return nil
	}
	raw := strings.Split(csv, ",")
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if s := strings.TrimSpace(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func printPostSummary(cfg *config.Runtime, post *api.Post) error {
	p := printerFrom(cfg)
	if cfg.AsJSON {
		return p.PrintJSON(post)
	}
	p.Table([]string{"ID", "STATUS", "SCHEDULED", "ACCOUNTS", "MEDIA"}, [][]string{{
		post.ID,
		post.Status,
		scheduleLabel(post.ScheduledAt),
		strconv.Itoa(len(post.Destinations)),
		strconv.Itoa(len(post.MediaIDs) + len(post.Media)),
	}})
	return nil
}

func scheduleLabel(s string) string {
	if strings.TrimSpace(s) == "" || strings.HasPrefix(s, "0001-01-01") {
		return "draft"
	}
	return s
}

func preview(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}
	if n <= 3 {
		return s[:n]
	}
	return s[:n-3] + "..."
}
