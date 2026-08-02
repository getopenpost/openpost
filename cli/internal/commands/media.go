package commands

import (
	"context"
	"fmt"
	"strconv"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
)

func newMediaCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "media",
		Short: "Upload and list media attachments",
	}
	cmd.AddCommand(newMediaUploadCmd())
	cmd.AddCommand(newMediaListCmd())
	cmd.AddCommand(newMediaUpdateCmd())
	cmd.AddCommand(newMediaUsageCmd())
	cmd.AddCommand(newMediaStorageCmd())
	cmd.AddCommand(newMediaDeleteCmd())
	return cmd
}

func newMediaUpdateCmd() *cobra.Command {
	var altText string
	cmd := &cobra.Command{
		Use:   "update <media-id>",
		Short: "Update media alt text",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !cmd.Flags().Changed("alt") {
				return fmt.Errorf("--alt is required; pass an empty value to clear alt text")
			}
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			if err := client.UpdateMedia(cmd.Context(), args[0], altText); err != nil {
				return err
			}
			if cfg.AsJSON {
				return printerFrom(cfg).PrintJSON(map[string]string{
					"id":       args[0],
					"alt_text": altText,
					"status":   "updated",
				})
			}
			printerFrom(cfg).Printf("Updated alt text for media %s.", args[0])
			return nil
		},
	}
	cmd.Flags().StringVar(&altText, "alt", "", "alt text; pass an empty value to clear it")
	return cmd
}

func newMediaUsageCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "usage <media-id>",
		Short: "List content that uses a media attachment",
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
			usage, err := client.GetMediaUsage(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(usage)
			}
			if len(usage.Usage) == 0 {
				p.Printf("Media %s is not in use.", args[0])
				return nil
			}
			rows := make([][]string, 0, len(usage.Usage))
			for _, item := range usage.Usage {
				rows = append(rows, []string{
					item.Kind,
					item.ID,
					emptyDash(item.Label),
					emptyDash(item.Status),
					emptyDash(item.ScheduledAt),
				})
			}
			p.Table([]string{"KIND", "ID", "LABEL", "STATUS", "SCHEDULED"}, rows)
			return nil
		},
	}
}

func newMediaStorageCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "storage",
		Short: "Show media storage usage",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			workspaceID, err := activeWorkspaceID(cmd, client)
			if err != nil {
				return err
			}
			storage, err := client.GetMediaStorage(cmd.Context(), workspaceID)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(storage)
			}
			p.Table(
				[]string{"USED BYTES", "ASSETS", "INTERNAL BYTES", "LIMIT BYTES", "DIRECT UPLOAD"},
				[][]string{{
					strconv.FormatInt(storage.UsedBytes, 10),
					strconv.Itoa(storage.AssetCount),
					strconv.FormatInt(storage.InternalBytes, 10),
					strconv.FormatInt(storage.LimitBytes, 10),
					yesNo(storage.DirectUploadSupported),
				}},
			)
			return nil
		},
	}
}

func newMediaDeleteCmd() *cobra.Command {
	return newConfirmedDeleteCmd(
		"delete <media-id>",
		"Delete an unused media attachment",
		"media",
		func(ctx context.Context, client *api.Client, id string) error {
			return client.DeleteMedia(ctx, id)
		},
	)
}

func newMediaUploadCmd() *cobra.Command {
	var altText string

	cmd := &cobra.Command{
		Use:   "upload <file>",
		Short: "Upload a media file",
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
			workspaceID, err := activeWorkspaceID(cmd, client)
			if err != nil {
				return err
			}
			media, err := client.UploadMedia(cmd.Context(), workspaceID, args[0], altText)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(media)
			}
			p.Table([]string{"ID", "URL", "ALT"}, [][]string{{
				media.ID,
				media.URL,
				emptyDash(media.AltText),
			}})
			return nil
		},
	}
	cmd.Flags().StringVar(&altText, "alt", "", "alt text for the uploaded media")
	return cmd
}

func newMediaListCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List media attachments",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			workspaceID, err := activeWorkspaceID(cmd, client)
			if err != nil {
				return err
			}
			media, err := client.ListMedia(cmd.Context(), workspaceID, limit)
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(media)
			}
			if len(media) == 0 {
				p.Printf("No media has been uploaded for this workspace.")
				return nil
			}
			rows := make([][]string, 0, len(media))
			for _, item := range media {
				rows = append(rows, []string{
					item.ID,
					emptyDash(item.OriginalFilename),
					strconv.FormatInt(item.Size, 10),
					emptyDash(item.AltText),
					emptyDash(item.CreatedAt),
				})
			}
			p.Table([]string{"ID", "FILENAME", "SIZE", "ALT", "CREATED"}, rows)
			return nil
		},
	}
	cmd.Flags().IntVar(&limit, "limit", 0, "maximum number of media items to return")
	return cmd
}
