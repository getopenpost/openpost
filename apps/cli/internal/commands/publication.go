package commands

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/config"
)

type publicationFlags struct {
	profile          string
	title            string
	content          string
	file             string
	url              string
	description      string
	caption          string
	videoTitle       string
	videoDescription string
	privacy          string
	tiktokMethod     string
	tiktokPrivacy    string
	accounts         string
	schedule         string
	media            []string
	mediaAlt         []string
	status           string
	limit            int
	offset           int
	force            bool
}

func newPublicationCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "publication", Short: "Create, list, validate, and publish publications"}
	cmd.AddCommand(newPublicationCreateCmd())
	cmd.AddCommand(newPublicationListCmd())
	cmd.AddCommand(newPublicationViewCmd())
	cmd.AddCommand(newPublicationUpdateCmd())
	cmd.AddCommand(newPublicationRenditionsCmd())
	cmd.AddCommand(newPublicationReplyCmd())
	cmd.AddCommand(newPublicationValidateCmd())
	cmd.AddCommand(newPublicationScheduleCmd())
	cmd.AddCommand(newPublicationCancelCmd())
	cmd.AddCommand(newPublicationPublishNowCmd())
	cmd.AddCommand(newPublicationRetryCmd())
	cmd.AddCommand(newPublicationDeleteRenditionCmd())
	cmd.AddCommand(newPublicationDeleteCmd())
	cmd.AddCommand(newPublicationEventsCmd())
	cmd.AddCommand(newPublicationCommentsCmd())
	cmd.AddCommand(newPublicationReplyCommentCmd())
	cmd.AddCommand(newPublicationHideCommentCmd())
	cmd.AddCommand(newPublicationDeleteCommentCmd())
	return cmd
}

func newPublicationUpdateCmd() *cobra.Command {
	var flags publicationFlags
	cmd := &cobra.Command{
		Use:   "update <publication-id>",
		Short: "Update an editable publication",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, client, workspaceID, settings, err := postRuntime(cmd)
			if err != nil {
				return err
			}
			current, err := client.GetPublication(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			input := api.UpdatePublicationInput{ExpectedRevision: current.Revision, Force: flags.force}
			if cmd.Flags().Changed("title") {
				input.Title = &flags.title
			}
			if cmd.Flags().Changed("profile") {
				input.ContentProfile = &flags.profile
			}
			if cmd.Flags().Changed("content") || cmd.Flags().Changed("file") {
				content, contentErr := contentFromFlags(flags.content, flags.file)
				err = contentErr
				if err != nil {
					return err
				}
				input.SourceText = &content
			}
			if cmd.Flags().Changed("url") {
				input.SourceURL = &flags.url
			}
			if cmd.Flags().Changed("schedule") {
				input.ScheduledAt, _, err = parseScheduleFlag(cmd, client, workspaceID, flags.schedule, settings.Timezone)
				if err != nil {
					return err
				}
				input.ClearSchedule = input.ScheduledAt == nil
			}
			if input.Title == nil && input.ContentProfile == nil && input.SourceText == nil &&
				input.SourceURL == nil && input.ScheduledAt == nil && !input.ClearSchedule {
				return fmt.Errorf("no publication changes requested")
			}
			updated, err := client.UpdatePublication(cmd.Context(), args[0], input)
			if err != nil {
				return err
			}
			return printPublicationSummary(cfg, updated)
		},
	}
	cmd.Flags().StringVar(&flags.title, "title", "", "publication title")
	cmd.Flags().StringVar(&flags.profile, "content-profile", "", "content profile")
	cmd.Flags().StringVar(&flags.content, "content", "", "shared post or caption text")
	cmd.Flags().StringVar(&flags.file, "file", "", "read shared text from file or '-' for stdin")
	cmd.Flags().StringVar(&flags.url, "url", "", "source URL; pass an empty value to clear")
	cmd.Flags().StringVar(&flags.schedule, "schedule", "", "new schedule time; use draft to clear")
	cmd.Flags().BoolVar(&flags.force, "force", false, "overwrite after reviewing a revision conflict")
	return cmd
}

func newPublicationRenditionsCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:   "renditions <publication-id>",
		Short: "Replace destination-specific renditions from JSON",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(file) == "" {
				return fmt.Errorf("--file is required")
			}
			payload, err := contentFromFlags("", file)
			if err != nil {
				return err
			}
			var renditions []api.RenditionInput
			if err := json.Unmarshal([]byte(payload), &renditions); err != nil {
				return fmt.Errorf("decode renditions JSON: %w", err)
			}
			if len(renditions) == 0 {
				return fmt.Errorf("renditions JSON must contain at least one item")
			}
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			current, err := client.GetPublication(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			publication, err := client.UpsertPublicationRenditions(cmd.Context(), args[0], current.Revision, renditions)
			if err != nil {
				return err
			}
			return printPublicationSummary(cfg, publication)
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "JSON array of renditions, or '-' for stdin")
	return cmd
}

func newPublicationReplyCmd() *cobra.Command {
	var body, file, parentID, schedule string
	cmd := &cobra.Command{
		Use:   "reply <rendition-id>",
		Short: "Queue an explicit reply to a published rendition",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			content, err := contentFromFlags(body, file)
			if err != nil {
				return err
			}
			if strings.TrimSpace(content) == "" {
				return fmt.Errorf("--body or --file is required")
			}
			cfg, client, workspaceID, settings, err := postRuntime(cmd)
			if err != nil {
				return err
			}
			runAt, _, err := parseScheduleFlag(cmd, client, workspaceID, schedule, settings.Timezone)
			if err != nil {
				return err
			}
			result, err := client.ReplyToRendition(cmd.Context(), args[0], api.RenditionReplyInput{Body: content, ParentID: parentID, RunAt: runAt})
			if err != nil {
				return err
			}
			return printPublicationAction(cfg, result.Message, result.JobID)
		},
	}
	cmd.Flags().StringVar(&body, "body", "", "reply text")
	cmd.Flags().StringVar(&file, "file", "", "read reply text from file or '-' for stdin")
	cmd.Flags().StringVar(&parentID, "parent-id", "", "external provider post or comment ID")
	cmd.Flags().StringVar(&schedule, "at", "", "optional reply schedule time")
	return cmd
}

func newPublicationCreateCmd() *cobra.Command {
	var flags publicationFlags
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a format-first publication",
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
			media := make([]api.PublicationMediaInput, 0, len(mediaIDs))
			for _, mediaID := range mediaIDs {
				media = append(media, api.PublicationMediaInput{MediaID: mediaID, Role: "attachment"})
			}
			profile := defaultString(flags.profile, "short_text")
			sourceText := publicationSourceText(profile, content, flags)
			title := publicationTitle(profile, sourceText, flags)
			accounts := []api.SocialAccount{}
			if len(accountIDs) > 0 {
				accounts, err = client.ListAccounts(cmd.Context(), workspaceID)
				if err != nil {
					return err
				}
			}
			publication, err := client.CreatePublication(cmd.Context(), api.CreatePublicationInput{
				WorkspaceID:      workspaceID,
				Title:            title,
				ContentProfile:   profile,
				SourceText:       sourceText,
				SourceURL:        flags.url,
				ScheduledAt:      scheduledAt,
				SocialAccountIDs: accountIDs,
				Media:            media,
				Renditions:       buildPublicationRenditions(profile, content, flags, accounts, accountIDs, media),
				Metadata:         map[string]interface{}{"created_from": "cli"},
			})
			if err != nil {
				return err
			}
			if scheduledAt != nil {
				if _, err := client.SchedulePublication(cmd.Context(), publication.ID, publication.Revision); err != nil {
					return err
				}
				publication, err = client.GetPublication(cmd.Context(), publication.ID)
				if err != nil {
					return err
				}
			}
			return printPublicationSummary(cfg, publication)
		},
	}
	cmd.Flags().StringVar(&flags.profile, "content-profile", "short_text", "content profile: short_text, thread, link_share, image_post, carousel, story, short_video, long_video")
	cmd.Flags().StringVar(&flags.title, "title", "", "publication title")
	cmd.Flags().StringVar(&flags.content, "content", "", "post text or fallback source text")
	cmd.Flags().StringVar(&flags.file, "file", "", "read post/source text from file or '-' for stdin")
	cmd.Flags().StringVar(&flags.url, "url", "", "source URL for link shares")
	cmd.Flags().StringVar(&flags.description, "description", "", "description field for link/video outputs")
	cmd.Flags().StringVar(&flags.caption, "caption", "", "caption for image, carousel, story, or social video outputs")
	cmd.Flags().StringVar(&flags.videoTitle, "video-title", "", "YouTube video title")
	cmd.Flags().StringVar(&flags.videoDescription, "video-description", "", "YouTube video description")
	cmd.Flags().StringVar(&flags.privacy, "privacy", "", "YouTube privacy status: private, unlisted, or public")
	cmd.Flags().StringVar(&flags.tiktokMethod, "tiktok-method", "DIRECT_POST", "TikTok content posting method")
	cmd.Flags().StringVar(&flags.tiktokPrivacy, "tiktok-privacy", "SELF_ONLY", "TikTok privacy level")
	cmd.Flags().StringVar(&flags.accounts, "accounts", "", "comma-separated account IDs/slugs/platforms")
	cmd.Flags().StringVar(&flags.schedule, "schedule", "", "schedule time")
	cmd.Flags().StringArrayVar(&flags.media, "media", nil, "media ID or local file path to attach; repeatable")
	cmd.Flags().StringArrayVar(&flags.mediaAlt, "media-alt", nil, "alt text for uploaded media")
	return cmd
}

func newPublicationListCmd() *cobra.Command {
	var flags publicationFlags
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List publications",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, client, workspaceID, _, err := postRuntime(cmd)
			if err != nil {
				return err
			}
			publications, err := client.ListPublications(cmd.Context(), api.ListPublicationsInput{
				WorkspaceID:    workspaceID,
				Status:         flags.status,
				ContentProfile: flags.profile,
				Limit:          flags.limit,
				Offset:         flags.offset,
			})
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(publications)
			}
			rows := make([][]string, 0, len(publications))
			for _, publication := range publications {
				rows = append(rows, []string{
					publication.ID,
					publication.Status,
					publication.ContentProfile,
					scheduleLabel(publication.ScheduledAt),
					preview(publication.Title, 40),
					strconv.Itoa(len(publication.Renditions)),
				})
			}
			p.Table([]string{"ID", "STATUS", "PROFILE", "SCHEDULED", "TITLE", "RENDITIONS"}, rows)
			return nil
		},
	}
	cmd.Flags().StringVar(&flags.status, "status", "", "filter by status")
	cmd.Flags().StringVar(&flags.profile, "content-profile", "", "filter by content profile")
	cmd.Flags().IntVar(&flags.limit, "limit", 0, "maximum number of publications to return")
	cmd.Flags().IntVar(&flags.offset, "offset", 0, "number of publications to skip")
	return cmd
}

func newPublicationViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "view <publication-id>",
		Short: "View a publication",
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
			publication, err := client.GetPublication(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			return printPublicationSummary(cfg, publication)
		},
	}
}

func newPublicationValidateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "validate <publication-id>",
		Short: "Validate a publication",
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
			result, err := client.ValidatePublication(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(result)
			}
			p.Printf("valid\t%t", result.Valid)
			for _, issue := range result.Issues {
				p.Printf("%s\t%s\t%s", issue.Severity, issue.Code, issue.Message)
			}
			return nil
		},
	}
}

func newPublicationScheduleCmd() *cobra.Command {
	var flags publicationFlags
	cmd := &cobra.Command{
		Use:   "schedule <publication-id>",
		Short: "Schedule an existing publication",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(flags.schedule) == "" {
				return fmt.Errorf("--at is required")
			}
			cfg, client, workspaceID, settings, err := postRuntime(cmd)
			if err != nil {
				return err
			}
			scheduledAt, label, err := parseScheduleFlag(cmd, client, workspaceID, flags.schedule, settings.Timezone)
			if err != nil {
				return err
			}
			if scheduledAt == nil {
				return fmt.Errorf("--at is required")
			}
			if err := confirmNaturalSchedule(cfg.Yes, scheduledAt, label); err != nil {
				return err
			}
			current, err := client.GetPublication(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			updated, err := client.UpdatePublication(cmd.Context(), args[0], api.UpdatePublicationInput{
				ExpectedRevision: current.Revision,
				ScheduledAt:      scheduledAt,
			})
			if err != nil {
				return err
			}
			result, err := client.SchedulePublication(cmd.Context(), args[0], updated.Revision)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(result)
			}
			p.Printf("%s\t%s", result.Message, emptyDash(result.JobID))
			return nil
		},
	}
	cmd.Flags().StringVar(&flags.schedule, "at", "", "schedule time, natural language, or next-slot")
	return cmd
}

func newPublicationCancelCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "cancel <publication-id>",
		Short: "Cancel a scheduled publication",
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
			current, err := client.GetPublication(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			result, err := client.CancelPublication(cmd.Context(), args[0], current.Revision)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(result)
			}
			p.Printf("%s", result.Message)
			return nil
		},
	}
}

func newPublicationPublishNowCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "publish-now <publication-id>",
		Short: "Queue a publication for immediate publishing",
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
			current, err := client.GetPublication(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			result, err := client.PublishPublicationNow(cmd.Context(), args[0], current.Revision)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(result)
			}
			p.Printf("%s\t%s", result.Message, emptyDash(result.JobID))
			return nil
		},
	}
}

func newPublicationRetryCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "retry <publication-id> <account-id>",
		Short: "Retry one failed publication destination",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			result, err := client.RetryPublicationRendition(cmd.Context(), args[0], args[1])
			if err != nil {
				return err
			}
			return printPublicationAction(cfg, result.Message, result.JobID)
		},
	}
}

func newPublicationDeleteRenditionCmd() *cobra.Command {
	var confirm bool
	cmd := &cobra.Command{
		Use:   "delete-rendition <publication-id> <account-id>",
		Short: "Permanently delete one saved publication destination",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !confirm {
				return fmt.Errorf("--confirm is required to delete a saved destination")
			}
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			current, err := client.GetPublication(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			result, err := client.DeletePublicationRendition(cmd.Context(), args[0], args[1], current.Revision)
			if err != nil {
				return err
			}
			return printPublicationAction(cfg, result.Message, "")
		},
	}
	cmd.Flags().BoolVar(&confirm, "confirm", false, "confirm permanent destination deletion")
	return cmd
}

func newPublicationDeleteCmd() *cobra.Command {
	var confirm bool
	cmd := &cobra.Command{
		Use:   "delete <publication-id>",
		Short: "Permanently delete an editable publication",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !confirm {
				return fmt.Errorf("--confirm is required to delete a publication")
			}
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			current, err := client.GetPublication(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			result, err := client.DeletePublication(cmd.Context(), args[0], current.Revision)
			if err != nil {
				return err
			}
			return printPublicationAction(cfg, result.Message, "")
		},
	}
	cmd.Flags().BoolVar(&confirm, "confirm", false, "confirm permanent publication deletion")
	return cmd
}

func newPublicationEventsCmd() *cobra.Command {
	var flags publicationFlags
	cmd := &cobra.Command{
		Use:   "events <publication-id>",
		Short: "List publication lifecycle events",
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
			events, err := client.ListPublicationEvents(cmd.Context(), args[0], flags.limit)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(events)
			}
			rows := make([][]string, 0, len(events))
			for _, event := range events {
				rows = append(rows, []string{
					event.CreatedAt,
					event.Type,
					event.Status,
					emptyDash(event.RenditionID),
					event.Message,
				})
			}
			p.Table([]string{"CREATED", "TYPE", "STATUS", "RENDITION", "MESSAGE"}, rows)
			return nil
		},
	}
	cmd.Flags().IntVar(&flags.limit, "limit", 0, "maximum number of events to return")
	return cmd
}

func newPublicationCommentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "comments <rendition-id>",
		Short: "List comments for a published rendition",
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
			comments, err := client.ListRenditionComments(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(comments)
			}
			rows := make([][]string, 0, len(comments))
			for _, comment := range comments {
				rows = append(rows, []string{
					comment.ID,
					emptyDash(comment.AuthorName),
					hiddenLabel(comment.Hidden),
					commentActions(comment),
					preview(comment.Text, 80),
				})
			}
			p.Table([]string{"ID", "AUTHOR", "HIDDEN", "ACTIONS", "TEXT"}, rows)
			return nil
		},
	}
}

func newPublicationReplyCommentCmd() *cobra.Command {
	var body, file string
	cmd := &cobra.Command{
		Use:   "reply-comment <comment-id>",
		Short: "Reply to a provider comment",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			content, err := contentFromFlags(body, file)
			if err != nil {
				return err
			}
			if strings.TrimSpace(content) == "" {
				return fmt.Errorf("--body or --file is required")
			}
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			result, err := client.ReplyToComment(cmd.Context(), args[0], content)
			if err != nil {
				return err
			}
			return printCommentAction(cfg, result)
		},
	}
	cmd.Flags().StringVar(&body, "body", "", "reply text")
	cmd.Flags().StringVar(&file, "file", "", "read reply text from file or '-' for stdin")
	return cmd
}

func newPublicationHideCommentCmd() *cobra.Command {
	return newPublicationCommentActionCmd("hide-comment <comment-id>", "Hide a provider comment", func(client *api.Client, cmd *cobra.Command, id string) (*api.CommentActionOutput, error) {
		return client.HideComment(cmd.Context(), id)
	})
}

func newPublicationDeleteCommentCmd() *cobra.Command {
	cmd := newPublicationCommentActionCmd("delete-comment <comment-id>", "Delete a provider comment", func(client *api.Client, cmd *cobra.Command, id string) (*api.CommentActionOutput, error) {
		return client.DeleteComment(cmd.Context(), id)
	})
	cmd.Flags().Bool("confirm", false, "confirm permanent provider deletion")
	cmd.PreRunE = func(cmd *cobra.Command, _ []string) error {
		confirmed, _ := cmd.Flags().GetBool("confirm")
		if !confirmed {
			return fmt.Errorf("--confirm is required to delete a provider comment")
		}
		return nil
	}
	return cmd
}

func newPublicationCommentActionCmd(use, short string, action func(*api.Client, *cobra.Command, string) (*api.CommentActionOutput, error)) *cobra.Command {
	return &cobra.Command{
		Use: use, Short: short, Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			result, err := action(client, cmd, args[0])
			if err != nil {
				return err
			}
			return printCommentAction(cfg, result)
		},
	}
}

func printPublicationAction(cfg *config.Runtime, message, jobID string) error {
	result := api.PublicationActionOutput{Message: message, JobID: jobID}
	if cfg.AsJSON {
		return printerFrom(cfg).PrintJSON(result)
	}
	printerFrom(cfg).Printf("%s\t%s", message, emptyDash(jobID))
	return nil
}

func printCommentAction(cfg *config.Runtime, result *api.CommentActionOutput) error {
	if cfg.AsJSON {
		return printerFrom(cfg).PrintJSON(result)
	}
	printerFrom(cfg).Printf("%s\t%s", result.Message, emptyDash(result.ID))
	return nil
}

func printPublicationSummary(cfg *config.Runtime, publication *api.Publication) error {
	p := printerFrom(cfg)
	if cfg.AsJSON {
		return p.PrintJSON(publication)
	}
	p.Table([]string{"FIELD", "VALUE"}, [][]string{
		{"id", publication.ID},
		{"workspace_id", publication.WorkspaceID},
		{"status", publication.Status},
		{"revision", strconv.Itoa(publication.Revision)},
		{"profile", publication.ContentProfile},
		{"scheduled_at", scheduleLabel(publication.ScheduledAt)},
		{"title", publication.Title},
		{"rendition_count", strconv.Itoa(len(publication.Renditions))},
	})
	for _, rendition := range publication.Renditions {
		p.Printf("rendition %s\t%s\t%s\t%s", rendition.ID, rendition.Platform, rendition.Status, emptyDash(rendition.ErrorMessage))
	}
	return nil
}

func publicationSourceText(profile, content string, flags publicationFlags) string {
	switch profile {
	case "image_post", "carousel", "story", "short_video", "long_video":
		return firstNonEmpty(flags.videoDescription, flags.description, flags.caption, content, flags.videoTitle, flags.title)
	default:
		return firstNonEmpty(content, flags.description, flags.caption, flags.title)
	}
}

func publicationTitle(profile, sourceText string, flags publicationFlags) string {
	if profile == "short_video" || profile == "long_video" {
		return firstNonEmpty(flags.title, flags.videoTitle, firstLineCLI(sourceText), "Untitled publication")
	}
	return firstNonEmpty(flags.title, firstLineCLI(sourceText), "Untitled publication")
}

func buildPublicationRenditions(profile, content string, flags publicationFlags, accounts []api.SocialAccount, accountIDs []string, media []api.PublicationMediaInput) []api.RenditionInput {
	if len(accountIDs) == 0 {
		return nil
	}
	accountsByID := make(map[string]api.SocialAccount, len(accounts))
	for _, account := range accounts {
		accountsByID[account.ID] = account
	}
	renditions := make([]api.RenditionInput, 0, len(accountIDs))
	for _, accountID := range accountIDs {
		account, ok := accountsByID[accountID]
		if !ok {
			continue
		}
		body, title, description := publicationFieldsForAccount(account.Platform, profile, content, flags)
		renditions = append(renditions, api.RenditionInput{
			SocialAccountID: account.ID,
			Profile:         profile,
			Body:            body,
			Title:           title,
			Description:     description,
			Settings:        publicationSettingsForAccount(account.Platform, profile, flags, title, description),
			Media:           clonePublicationMedia(media),
		})
	}
	return renditions
}

func publicationFieldsForAccount(platform, profile, content string, flags publicationFlags) (string, string, string) {
	if platform == "youtube" && isVideoProfile(profile) {
		title := firstNonEmpty(flags.videoTitle, flags.title, firstLineCLI(flags.videoDescription), firstLineCLI(flags.description), firstLineCLI(content), "Untitled video")
		description := firstNonEmpty(flags.videoDescription, flags.description, content, flags.caption)
		return description, title, description
	}

	switch profile {
	case "link_share":
		return firstNonEmpty(content, flags.caption, flags.description), flags.title, flags.description
	case "image_post", "carousel", "story", "short_video", "long_video":
		return firstNonEmpty(flags.caption, content, flags.description), flags.title, flags.description
	default:
		return content, flags.title, flags.description
	}
}

func publicationSettingsForAccount(platform, profile string, flags publicationFlags, title, description string) map[string]interface{} {
	settings := map[string]interface{}{}
	if profile == "link_share" && flags.url != "" {
		if platform == "bluesky" {
			settings["link_url"] = flags.url
			if title != "" {
				settings["link_title"] = title
			}
			if description != "" {
				settings["link_description"] = description
			}
		} else {
			settings["url"] = flags.url
		}
	}

	if platform == "youtube" && isVideoProfile(profile) {
		settings["privacy"] = defaultString(flags.privacy, "private")
		if title != "" {
			settings["title"] = title
		}
		if description != "" {
			settings["description"] = description
		}
	}

	if platform == "tiktok" && (profile == "short_video" || profile == "carousel") {
		settings["content_posting_method"] = defaultString(flags.tiktokMethod, "DIRECT_POST")
		settings["privacy_level"] = defaultString(flags.tiktokPrivacy, "SELF_ONLY")
	}

	if platform == "instagram" {
		if profile == "story" {
			settings["post_type"] = "story"
		}
		if profile == "short_video" {
			settings["is_reel"] = true
		}
	}

	if platform == "facebook" {
		if profile == "story" {
			settings["post_type"] = "story"
		}
		if profile == "link_share" && flags.url != "" {
			settings["url"] = flags.url
		}
	}

	if len(settings) == 0 {
		return nil
	}
	return settings
}

func isVideoProfile(profile string) bool {
	return profile == "short_video" || profile == "long_video"
}

func clonePublicationMedia(media []api.PublicationMediaInput) []api.PublicationMediaInput {
	if len(media) == 0 {
		return nil
	}
	out := make([]api.PublicationMediaInput, len(media))
	copy(out, media)
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func firstLineCLI(text string) string {
	return strings.TrimSpace(strings.Split(strings.TrimSpace(text), "\n")[0])
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func hiddenLabel(hidden bool) string {
	if hidden {
		return "yes"
	}
	return "no"
}

func commentActions(comment api.Comment) string {
	actions := make([]string, 0, 3)
	if comment.CanReply {
		actions = append(actions, "reply")
	}
	if comment.CanHide {
		actions = append(actions, "hide")
	}
	if comment.CanDelete {
		actions = append(actions, "delete")
	}
	if len(actions) == 0 {
		return "-"
	}
	return strings.Join(actions, ",")
}
