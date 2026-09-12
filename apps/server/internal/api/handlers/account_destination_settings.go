package handlers

import (
	"strings"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

func isDiscordBotAccount(account models.SocialAccount) bool {
	return platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState) == capabilities.ProviderDiscord+":"+platform.ConnectionModeBot
}

func discordChannelIssue(account models.SocialAccount, profile, outputProfile string, settings map[string]any) *capabilities.ValidationIssue {
	if !isDiscordBotAccount(account) {
		return nil
	}
	channelID, _ := settings["channel_id"].(string)
	if strings.TrimSpace(channelID) != "" {
		return nil
	}
	return &capabilities.ValidationIssue{
		Severity: "error", Code: "setting_required", Field: "channel_id",
		Message:         "Choose a Discord channel for this destination.",
		FallbackMessage: "Choose a Discord channel for this destination.",
		Provider:        account.Platform, Profile: profile, OutputProfile: outputProfile,
		Scope: capabilities.SettingScopeDestination,
	}
}

func applyAccountDestinationSettings(account models.SocialAccount, settings map[string]any, resolved *capabilities.ResolvedCapability) {
	if account.Platform != capabilities.ProviderDiscord {
		return
	}
	if !isDiscordBotAccount(account) {
		// Incoming webhooks fix their channel at connection and always disable mentions.
		resolved.Settings = nil
		resolved.SettingGroups = nil
		return
	}
	for index := range resolved.Settings {
		if resolved.Settings[index].Key == "channel_id" {
			resolved.Settings[index].Required = true
			resolved.Settings[index].RequiredPolicy = "always"
		}
	}
	for groupIndex := range resolved.SettingGroups {
		for index := range resolved.SettingGroups[groupIndex].Settings {
			field := &resolved.SettingGroups[groupIndex].Settings[index]
			if field.Key == "channel_id" {
				field.Required = true
				field.RequiredPolicy = "always"
			}
		}
	}
	if issue := discordChannelIssue(account, resolved.Profile, resolved.OutputProfile, settings); issue != nil {
		resolved.Issues = append(resolved.Issues, *issue)
		resolved.Compatible = false
	}
}
