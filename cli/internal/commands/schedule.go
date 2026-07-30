package commands

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/openpost/cli/internal/api"
	"github.com/openpost/cli/internal/config"
)

func newScheduleCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "schedule",
		Short: "Manage reusable posting schedule slots",
		Long:  "Manage the workspace-local weekly slots used by next-slot scheduling.",
	}
	cmd.AddCommand(newScheduleListCmd())
	cmd.AddCommand(newScheduleCreateCmd())
	cmd.AddCommand(newScheduleUpdateCmd())
	cmd.AddCommand(newScheduleDeleteCmd())
	cmd.AddCommand(newScheduleSuggestCmd())
	cmd.AddCommand(newScheduleNextCmd())
	return cmd
}

func newScheduleListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List posting schedule slots",
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
			schedules, err := client.ListPostingSchedules(cmd.Context(), workspaceID)
			if err != nil {
				return err
			}
			return printPostingSchedules(cfg, schedules)
		},
	}
}

func newScheduleCreateCmd() *cobra.Command {
	var (
		day    int
		hour   int
		minute int
		label  string
	)
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a weekly posting schedule slot",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if !cmd.Flags().Changed("day") || !cmd.Flags().Changed("hour") {
				return fmt.Errorf("--day and --hour are required")
			}
			if err := validateScheduleTime(day, hour, minute); err != nil {
				return err
			}
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
			schedule, err := client.CreatePostingSchedule(cmd.Context(), api.CreatePostingScheduleInput{
				WorkspaceID:    workspaceID,
				LocalDayOfWeek: &day,
				LocalHour:      &hour,
				LocalMinute:    &minute,
				Label:          label,
			})
			if err != nil {
				return err
			}
			if cfg.AsJSON {
				return printerFrom(cfg).PrintJSON(schedule)
			}
			return printPostingSchedules(cfg, []api.PostingSchedule{*schedule})
		},
	}
	cmd.Flags().IntVar(&day, "day", 0, "workspace-local day of week (0=Sunday, 6=Saturday)")
	cmd.Flags().IntVar(&hour, "hour", 0, "workspace-local hour (0-23)")
	cmd.Flags().IntVar(&minute, "minute", 0, "workspace-local minute (0-59)")
	cmd.Flags().StringVar(&label, "label", "", "display label")
	return cmd
}

func newScheduleUpdateCmd() *cobra.Command {
	var (
		day      int
		hour     int
		minute   int
		label    string
		active   bool
		inactive bool
	)
	cmd := &cobra.Command{
		Use:   "update <schedule-id>",
		Short: "Update a posting schedule slot",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if active && inactive {
				return fmt.Errorf("--active and --inactive cannot be used together")
			}
			input := api.UpdatePostingScheduleInput{}
			if cmd.Flags().Changed("day") {
				if err := validateScheduleTime(day, 0, 0); err != nil {
					return err
				}
				input.DayOfWeek = &day
			}
			if cmd.Flags().Changed("hour") {
				if err := validateScheduleTime(0, hour, 0); err != nil {
					return err
				}
				input.UTCHour = &hour
			}
			if cmd.Flags().Changed("minute") {
				if err := validateScheduleTime(0, 0, minute); err != nil {
					return err
				}
				input.UTCMinute = &minute
			}
			if cmd.Flags().Changed("label") {
				input.Label = &label
			}
			if active || inactive {
				value := active
				input.IsActive = &value
			}
			if input.DayOfWeek == nil && input.UTCHour == nil && input.UTCMinute == nil && input.Label == nil && input.IsActive == nil {
				return fmt.Errorf("at least one update flag is required")
			}

			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			schedule, err := client.UpdatePostingSchedule(cmd.Context(), args[0], input)
			if err != nil {
				return err
			}
			if cfg.AsJSON {
				return printerFrom(cfg).PrintJSON(schedule)
			}
			return printPostingSchedules(cfg, []api.PostingSchedule{*schedule})
		},
	}
	cmd.Flags().IntVar(&day, "day", 0, "workspace-local day of week (0=Sunday, 6=Saturday)")
	cmd.Flags().IntVar(&hour, "hour", 0, "workspace-local hour (0-23)")
	cmd.Flags().IntVar(&minute, "minute", 0, "workspace-local minute (0-59)")
	cmd.Flags().StringVar(&label, "label", "", "display label; pass an empty value to clear it")
	cmd.Flags().BoolVar(&active, "active", false, "enable the slot")
	cmd.Flags().BoolVar(&inactive, "inactive", false, "disable the slot")
	return cmd
}

func newScheduleDeleteCmd() *cobra.Command {
	return newConfirmedDeleteCmd(
		"delete <schedule-id>",
		"Delete a posting schedule slot",
		"posting schedule",
		func(ctx context.Context, client *api.Client, id string) error {
			return client.DeletePostingSchedule(ctx, id)
		},
	)
}

func newScheduleSuggestCmd() *cobra.Command {
	var postsPerDay int
	cmd := &cobra.Command{
		Use:   "suggest",
		Short: "Create a suggested seven-day posting schedule",
		Long:  "Create active workspace-local schedule slots for every day of the week.",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if postsPerDay < 1 || postsPerDay > 10 {
				return fmt.Errorf("--posts-per-day must be between 1 and 10")
			}
			cfg, err := runtimeFrom(cmd)
			if err != nil {
				return err
			}
			ok, err := confirmMutation(cfg, fmt.Sprintf("Create %d posting schedule slots?", postsPerDay*7))
			if err != nil {
				return err
			}
			if !ok {
				printerFrom(cfg).Printf("Canceled.")
				return nil
			}
			client, err := clientFrom(cfg)
			if err != nil {
				return err
			}
			workspaceID, err := activeWorkspaceID(cmd, client)
			if err != nil {
				return err
			}
			result, err := client.SuggestPostingSchedule(cmd.Context(), workspaceID, postsPerDay)
			if err != nil {
				return err
			}
			if cfg.AsJSON {
				return printerFrom(cfg).PrintJSON(result)
			}
			printerFrom(cfg).Printf("%s", result.Message)
			return nil
		},
	}
	cmd.Flags().IntVar(&postsPerDay, "posts-per-day", 3, "number of slots to create per day (1-10)")
	return cmd
}

func newScheduleNextCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "next",
		Short: "Find the next available posting slot",
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
			result, err := client.NextAvailableSlot(cmd.Context(), api.NextAvailableSlotInput{WorkspaceID: workspaceID})
			if err != nil {
				return err
			}
			if cfg.AsJSON {
				return printerFrom(cfg).PrintJSON(result)
			}
			if strings.TrimSpace(result.SlotTime) == "" {
				printerFrom(cfg).Printf("%s", result.Message)
				return nil
			}
			printerFrom(cfg).Table([]string{"TIME", "SLOT", "MESSAGE"}, [][]string{{
				result.SlotTime,
				postingScheduleLabel(result.Slot),
				emptyDash(result.Message),
			}})
			return nil
		},
	}
}

func printPostingSchedules(cfg *config.Runtime, schedules []api.PostingSchedule) error {
	p := printerFrom(cfg)
	if cfg.AsJSON {
		return p.PrintJSON(schedules)
	}
	if len(schedules) == 0 {
		p.Printf("No posting schedule slots are configured for this workspace.")
		return nil
	}
	rows := make([][]string, 0, len(schedules))
	for _, schedule := range schedules {
		rows = append(rows, []string{
			schedule.ID,
			scheduleDayName(schedule.LocalDayOfWeek),
			fmt.Sprintf("%02d:%02d", schedule.LocalHour, schedule.LocalMinute),
			emptyDash(schedule.Label),
			yesNo(schedule.IsActive),
		})
	}
	p.Table([]string{"ID", "DAY", "TIME", "LABEL", "ACTIVE"}, rows)
	return nil
}

func validateScheduleTime(day, hour, minute int) error {
	if day < 0 || day > 6 {
		return fmt.Errorf("--day must be between 0 (Sunday) and 6 (Saturday)")
	}
	if hour < 0 || hour > 23 {
		return fmt.Errorf("--hour must be between 0 and 23")
	}
	if minute < 0 || minute > 59 {
		return fmt.Errorf("--minute must be between 0 and 59")
	}
	return nil
}

func scheduleDayName(day int) string {
	names := []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
	if day < 0 || day >= len(names) {
		return strconv.Itoa(day)
	}
	return names[day]
}

func postingScheduleLabel(slot *api.PostingSchedule) string {
	if slot == nil {
		return "-"
	}
	if slot.Label != "" {
		return slot.Label
	}
	return slot.ID
}
