package main

import "fmt"

type processRole string

const (
	processRoleAll     processRole = "all"
	processRoleWeb     processRole = "web"
	processRoleWorker  processRole = "worker"
	processRoleMigrate processRole = "migrate"
)

const processUsage = "usage: openpost [all|web|worker|migrate|check-config]"

type processCommand struct {
	role        processRole
	checkConfig bool
	showHelp    bool
}

func parseProcessCommand(args []string) (processCommand, error) {
	if len(args) == 0 {
		return processCommand{role: processRoleAll}, nil
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
