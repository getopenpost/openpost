package notifications

import (
	"net/url"
	"strconv"

	"github.com/openpost/backend/internal/models"
)

// TypeWorkflowApproval covers the whole life of an approval wait: it starts,
// it reminds, and it expires. One topic rather than one per transition, because
// they are one mechanism — somebody has to decide something before a deadline —
// and muting any of the three without the others would be a strange thing to
// want. It mirrors post_review, which carries pending/approved/changes_requested
// through a single preference.
const TypeWorkflowApproval = "workflow_approval"

// Approval states, in the order a wait experiences them.
const (
	ApprovalStateWaiting  = "waiting"
	ApprovalStateReminder = "reminder"
	ApprovalStateExpired  = "expired"
)

// Approval audiences. The same transition reads differently to the person who
// could have decided it and to the person whose post died, so the producer says
// who it is addressing instead of leaving the materializer to guess.
const (
	ApprovalAudienceApprover = "approver"
	// ApprovalAudienceAuthor is the author whose post expired.
	ApprovalAudienceAuthor = "author"
	// ApprovalAudienceNoApprover is the author of a workspace where nobody
	// holds the level needed to decide, so the wait cannot end in approval at
	// all. Telling them to "review" the post would be a dead button.
	ApprovalAudienceNoApprover = "no_approver"
)

// WorkflowApprovalFacts describe one notification about a parked approval.
//
// RunID and StepID identify the wait. The step is part of the identity because
// a workflow may contain more than one approval step, so a single run can park
// more than once; keying only on the run would silently drop the second notice.
// An expiry is the exception: a run expires once, so it keys on the run alone.
type WorkflowApprovalFacts struct {
	EngagementID    string
	RecipientUserID string
	WorkspaceID     string
	RunID           string
	StepID          string
	State           string
	Audience        string
	PublicationID   string
	WorkflowName    string
	// DaysLeft is how long the wait still has, computed by the producer from
	// the run's own creation time. It is a fact rather than a calculation here
	// so the wording cannot drift from the deadline that actually applies, and
	// so tests do not depend on the wall clock.
	DaysLeft int
}

// approvalEventID keeps a wait addressable across its states. Waiting and
// reminders are per step; the expiry is per run.
func approvalEventID(facts WorkflowApprovalFacts) string {
	if facts.State == ApprovalStateExpired {
		return facts.RunID + ":" + ApprovalStateExpired
	}
	return facts.RunID + ":" + facts.StepID + ":" + facts.State
}

// WorkflowApprovalDedupKey is the stored identity of one approval notice. It is
// exported so the producer can resolve the notices it wrote without repeating
// the format, and it mirrors what baseOutcomeInput composes: topic + eventID.
func WorkflowApprovalDedupKey(runID, stepID, state string) string {
	return TypeWorkflowApproval + ":" + approvalEventID(WorkflowApprovalFacts{
		RunID: runID, StepID: stepID, State: state,
	})
}

func NewWorkflowApprovalOutcome(facts WorkflowApprovalFacts) (Outcome, error) {
	switch facts.State {
	case ApprovalStateWaiting, ApprovalStateReminder, ApprovalStateExpired:
	default:
		return nil, ErrInvalidOutcome
	}
	switch facts.Audience {
	case ApprovalAudienceApprover, ApprovalAudienceAuthor, ApprovalAudienceNoApprover:
	default:
		return nil, ErrInvalidOutcome
	}
	// A wait is identified by its step, so a waiting or reminder outcome
	// without one has no identity and could never be deduplicated or resolved.
	if facts.State != ApprovalStateExpired && facts.StepID == "" {
		return nil, ErrInvalidOutcome
	}
	payload := map[string]any{
		"run_id":   facts.RunID,
		"state":    facts.State,
		"audience": facts.Audience,
	}
	putOptionalFact(payload, "step_id", facts.StepID)
	putOptionalFact(payload, "engagement_id", facts.EngagementID)
	putOptionalFact(payload, "publication_id", facts.PublicationID)
	putOptionalFact(payload, "workflow_name", facts.WorkflowName)
	// Payload facts are strings: semantic payloads accept no numeric type, and
	// keeping the encoding here means the materializer never has to guess
	// whether it received an int or a float64 from a JSON round trip.
	if facts.State == ApprovalStateReminder {
		payload["days_left"] = strconv.Itoa(facts.DaysLeft)
	}
	return newOutcome(semanticOutcome{
		recipientID: facts.RecipientUserID, workspaceID: facts.WorkspaceID,
		topic: TypeWorkflowApproval, eventID: approvalEventID(facts), payload: payload,
	})
}

// approvalRunHref deep-links to the run. The workspace travels with it because
// the run inspector resolves a run against the workspace the viewer is
// currently in, so an approver sitting in a different workspace would otherwise
// land on an empty inspector.
func approvalRunHref(runID, workspaceID string) string {
	return "/workflows?run=" + url.QueryEscape(runID) + "&workspace_id=" + url.QueryEscape(workspaceID)
}

func approvalPublicationHref(publicationID, workspaceID string) string {
	return "/publications/" + url.PathEscape(publicationID) + "?workspace_id=" + url.QueryEscape(workspaceID)
}

func materializeWorkflowApproval(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	runID, _ := value.payload["run_id"].(string)
	state, _ := value.payload["state"].(string)
	audience, _ := value.payload["audience"].(string)
	publicationID, _ := value.payload["publication_id"].(string)
	workflowName, _ := value.payload["workflow_name"].(string)
	daysLeft, _ := strconv.Atoi(payloadString(value.payload["days_left"]))

	runHref := approvalRunHref(runID, value.workspaceID)
	input.Href = runHref

	if engagementID, _ := value.payload["engagement_id"].(string); engagementID != "" {
		return materializeCommentApproval(input, state, runHref)
	}

	switch state {
	case ApprovalStateWaiting:
		switch audience {
		case ApprovalAudienceNoApprover:
			input.Title = "Nobody can approve this post"
			input.Body = "This workflow is waiting for an approval nobody in this workspace is allowed to give. Ask a workspace administrator to assign someone the client or admin role."
			if publicationID != "" {
				input.Href = approvalPublicationHref(publicationID, value.workspaceID)
			}
			label := "View workflow run"
			if publicationID != "" {
				label = "Open post"
			}
			input.Actions = []models.NotificationAction{{Label: label, Href: input.Href, Kind: "primary"}}
		default:
			input.Title = "A post is waiting for your approval"
			input.Body = approvalBodyWithName(workflowName, "OpenPost paused this workflow until someone approves or rejects the post.")
			input.Actions = []models.NotificationAction{{Label: "Review post", Href: input.Href, Kind: "primary"}}
		}
	case ApprovalStateReminder:
		input.Title = "Still waiting for your approval"
		switch daysLeft {
		case 1:
			input.Body = "One day left before this approval expires and the post is not published."
		case 0:
			input.Body = "This approval expires today. If nobody decides, the post is not published."
		default:
			input.Body = pluralDays(daysLeft) + " left before this approval expires and the post is not published."
		}
		input.Actions = []models.NotificationAction{{Label: "Review post", Href: input.Href, Kind: "primary"}}
		if audience == ApprovalAudienceNoApprover {
			input.Title = "Nobody can approve this post"
			input.Body += " Ask a workspace administrator to assign someone the client or admin role."
			label := "View workflow run"
			if publicationID != "" {
				input.Href = approvalPublicationHref(publicationID, value.workspaceID)
				label = "Open post"
			}
			input.Actions = []models.NotificationAction{{Label: label, Href: input.Href, Kind: "primary"}}
		}
	case ApprovalStateExpired:
		if audience == ApprovalAudienceAuthor {
			input.Title = "Your post was not published"
			input.Body = "Nobody approved it before the approval window closed. Reschedule it, or follow up with whoever was meant to decide."
			if publicationID != "" {
				input.Href = approvalPublicationHref(publicationID, value.workspaceID)
			}
			input.Actions = []models.NotificationAction{{Label: "Open post", Href: input.Href, Kind: "primary"}}
		} else {
			input.Title = "An approval request expired"
			input.Body = "The approval window closed with no decision, so nothing was published."
			input.Actions = []models.NotificationAction{{Label: "View workflow run", Href: input.Href, Kind: "primary"}}
		}
	}
	return input, nil
}

func approvalBodyWithName(workflowName, fallback string) string {
	if workflowName == "" {
		return fallback
	}
	return "The workflow \"" + workflowName + "\" is paused until someone approves or rejects the post."
}

func payloadString(value any) string {
	text, _ := value.(string)
	return text
}

func pluralDays(days int) string {
	if days == 1 {
		return "1 day"
	}
	return strconv.Itoa(days) + " days"
}

func materializeCommentApproval(input createInput, state, runHref string) (createInput, error) {
	switch state {
	case ApprovalStateWaiting:
		input.Title = "A reply is waiting for your approval"
		input.Body = "Review the incoming comment and exact reply before sending."
	case ApprovalStateReminder:
		input.Title = "A reply still needs your approval"
		input.Body = "Review or dismiss the reply before the workflow expires."
	case ApprovalStateExpired:
		input.Title = "The reply approval expired"
		input.Body = "No reply was sent. Open the comment in Inbox if you still want to answer."
	}
	input.Actions = []models.NotificationAction{{Label: "Review reply", Href: runHref, Kind: "primary"}}
	return input, nil
}
