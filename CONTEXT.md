# OpenPost

OpenPost coordinates authored content, durable work, and delivery across connected social destinations.

## Language

**Job**:
A durable unit of work that OpenPost can recover after process interruption and drive to a terminal or recurring outcome.
_Avoid_: Task, background task

**Publication**:
The canonical user-visible post aggregate. It owns authored intent, revision, schedule, and one or more destination renditions.
_Avoid_: Post record, campaign

**Rendition**:
One destination-specific form of a Publication, bound to a connected social account and output profile.
_Avoid_: Variant, cross-post

**Organization**:
The billing, identity-policy, and administration boundary that owns one or more Workspaces. Organization membership alone does not grant access to Workspace content.
_Avoid_: Workspace, team

**Owner**:
The single Organization member with ultimate authority over ownership transfer and Organization-level destructive decisions.
_Avoid_: Administrator, Workspace administrator, co-owner

**Workspace**:
The content and collaboration boundary within an Organization. A user needs explicit Workspace membership to access its content.
_Avoid_: Organization, tenant

**Managed identity**:
A user identity governed by an Organization's authentication or access policy.
_Avoid_: Managed user, hosted user

**Hosted service**:
The OpenPost-operated deployment, named only when it must be distinguished from an operator-run deployment.
_Avoid_: Managed user, managed account

**Self-hosted deployment**:
An OpenPost instance operated by its user, who owns its infrastructure, configuration, upgrades, backups, and service-provider relationships. It is not a zero-price tier of the Hosted service.
_Avoid_: Free tier, Free plan

**Public knowledge**:
Product, usage, provider, and operating information that OpenPost intentionally publishes without Workspace authorization. It excludes private, mutable, or Workspace-scoped application state.
_Avoid_: Public app data, crawlable app state

**Agent-readable representation**:
A build-generated Markdown representation of one public page that preserves its useful meaning and factual substance without reproducing its visual or interactive behavior.
_Avoid_: Markdown mirror, agent page

**Activation**:
The point when a Workspace has a connected destination and its first Publication has been scheduled or submitted for delivery. A saved draft alone is not activation, and provider-confirmed delivery is not required.
_Avoid_: Workspace creation, first draft, first live post

**Transactional notification**:
A delivery required to complete or secure access, identity, or a critical billing action. Optional notification preferences and temporary Mutes do not suppress it.
_Avoid_: Marketing notification, product update

**Mute**:
A temporary account-wide or Workspace-specific pause layered over optional notification preferences. It expires without changing the user's saved channel or frequency choices.
_Avoid_: Unsubscribe, disable notifications

**Audit evidence**:
Permission-safe facts projected from consequential domain actions for administrative inspection. It does not drive business state and excludes content, secrets, credentials, invitation links, and raw provider data.
_Avoid_: Generic event, activity log

**Release candidate**:
One exact revision that passed candidate CI and carries a matching release manifest. It may advance through draft, complete draft, deployed, and published evidence without being rebuilt.
_Avoid_: Build, latest image
