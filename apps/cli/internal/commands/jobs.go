package commands

import (
	"strconv"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
)

func newJobsCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "jobs", Short: "List background jobs"}
	cmd.AddCommand(newJobsListCmd())
	return cmd
}

func newJobsListCmd() *cobra.Command {
	var status string
	var limit int
	var offset int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List background jobs",
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
			workspaceID := ""
			if cfg.Workspace != "" {
				workspaceID, err = activeWorkspaceID(cmd, client)
				if err != nil {
					return err
				}
			}
			jobs, err := client.ListJobs(cmd.Context(), api.ListJobsInput{Status: status, Limit: limit, Offset: offset, WorkspaceID: workspaceID})
			if err != nil {
				return err
			}
			p := printerFrom(cfg)
			if cfg.AsJSON {
				return p.PrintJSON(jobs)
			}
			rows := make([][]string, 0, len(jobs))
			for _, job := range jobs {
				rows = append(rows, []string{job.ID, job.Type, job.Status, emptyDash(job.RunAt), strconv.Itoa(job.Attempts)})
			}
			p.Table([]string{"ID", "TYPE", "STATUS", "RUN_AT", "ATTEMPTS"}, rows)
			return nil
		},
	}
	cmd.Flags().StringVar(&status, "status", "", "filter by status: pending, failed, completed")
	cmd.Flags().IntVar(&limit, "limit", 0, "maximum number of jobs to return")
	cmd.Flags().IntVar(&offset, "offset", 0, "number of jobs to skip")
	return cmd
}
