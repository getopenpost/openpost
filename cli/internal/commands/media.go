package commands

import (
	"strconv"

	"github.com/spf13/cobra"
)

func newMediaCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "media",
		Short: "Upload and list media attachments",
	}
	cmd.AddCommand(newMediaUploadCmd())
	cmd.AddCommand(newMediaListCmd())
	return cmd
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
