package main

import (
	"fmt"
	"strings"
)

type processRole string

const (
	processRoleAll     processRole = "all"
	processRoleWeb     processRole = "web"
	processRoleWorker  processRole = "worker"
	processRoleMigrate processRole = "migrate"
	// Maintenance is an internal database-only role selected by bounded admin
	// commands. It never starts HTTP or durable workers.
	processRoleMaintenance processRole = "maintenance"
)

const processUsage = "usage: openpost [all|web|worker|migrate|check-config|grant-admin --email <address>|rotate-encryption-key]"

type processCommand struct {
	role                processRole
	checkConfig         bool
	rotateEncryptionKey bool
	grantAdminEmail     string
	showHelp            bool
}

func parseProcessCommand(args []string) (processCommand, error) {
	if len(args) == 0 {
		return processCommand{role: processRoleAll}, nil
	}
	if args[0] == "grant-admin" {
		if len(args) != 3 || args[1] != "--email" || strings.TrimSpace(args[2]) == "" {
			return processCommand{}, fmt.Errorf("grant-admin requires --email <address>\n%s", processUsage)
		}
		return processCommand{role: processRoleMaintenance, grantAdminEmail: strings.TrimSpace(args[2])}, nil
	}
	if len(args) != 1 {
		return processCommand{}, fmt.Errorf("%s", processUsage)
	}

	switch args[0] {
	case string(processRoleAll):
		return processCommand{role: processRoleAll}, nil
	case string(processRoleWeb):
		return processCommand{role: processRoleWeb}, nil
	case string(processRoleWorker):
		return processCommand{role: processRoleWorker}, nil
	case string(processRoleMigrate):
		return processCommand{role: processRoleMigrate}, nil
	case "check-config":
		return processCommand{checkConfig: true}, nil
	case "rotate-encryption-key":
		return processCommand{role: processRoleMaintenance, rotateEncryptionKey: true}, nil
	case "help", "-h", "--help":
		return processCommand{showHelp: true}, nil
	default:
		return processCommand{}, fmt.Errorf("unknown command %q\n%s", args[0], processUsage)
	}
}

func (r processRole) runsWeb() bool {
	return r == processRoleAll || r == processRoleWeb
}

func (r processRole) runsWorker() bool {
	return r == processRoleAll || r == processRoleWorker
}

func (r processRole) autoMigrates() bool {
	return r == processRoleAll || r == processRoleMigrate
}
