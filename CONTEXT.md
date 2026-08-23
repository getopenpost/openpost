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

**Publication Build**:
A durable, source-first AI run that prepares a reviewed Publication package. It owns source references, a Voice Profile snapshot, direction, candidate destinations, progress, and validated native Renditions until the user sends it to the composer.
_Avoid_: Campaign, AI post, draft Publication

**Voice Profile**:
A reusable Workspace writing identity assigned to accounts. It owns stable voice traits, views, examples, and limits, while each destination adapter owns platform behavior.
_Avoid_: Brand voice setting, platform style

**Content opportunity**:
A cited, current subject with several selectable angles and destination treatments. It can seed a Publication Build but is not a generated post.
_Avoid_: Trend, ready-to-post content

**Organization**:
The billing, identity-policy, and administration boundary that owns one or more Workspaces. Organization membership alone does not grant access to Workspace content.
_Avoid_: Workspace, team

**Owner**:
The single Organization member with ultimate authority over ownership transfer and Organization-level destructive decisions.
_Avoid_: Administrator, Workspace administrator, co-owner

**Workspace**:
The content and collaboration boundary within an Organization. A user needs explicit Workspace membership to access its content.
_Avoid_: Organization, tenant

**Workspace access**:
The authorization decision for an actor in one Workspace. It combines credential scope, Organization identity policy, active Workspace membership, and the access level required by the action.
_Avoid_: Workspace membership, Organization affiliation

**Composer session**:
The browser-side editing workflow for one Publication in one Workspace. It may continue through an OpenPost Image Editor or OpenPost Studio handoff, but it does not continue across a Workspace change.
_Avoid_: Draft, Publication

**OpenPost Studio**:
The standalone local-first desktop application for creating media in the OpenPost product family. It works without an OpenPost account and can connect to Hosted services or self-hosted deployments.
_Avoid_: OpenPost Video Editor, web Studio

**OpenPost Image Editor**:
The focused still-image editor available in both OpenPost web and OpenPost Studio.
_Avoid_: Studio Image Editor, web Image Editor

**Quick Cut**:
The web video tool for removing source ranges. It copies eligible streams without re-encoding and can transcode when an exact cut requires it.
_Avoid_: Video Editor

**Media pool**:
The sources available to one Video Project, including linked local files and media obtained from OpenPost.
_Avoid_: Media library, project bundle

**Linked source**:
A local media file that a Video Project references at its existing filesystem location without copying it into the project.
_Avoid_: Imported copy, uploaded media

**Collected source**:
A media file copied into a Video Project so the project can move without losing that source.
_Avoid_: Linked source, proxy

**Engagement**:
A provider interaction attached to a published Rendition, such as a comment, reply, or reaction.
_Avoid_: Message, communication

**Messaging**:
A direct provider conversation attached to a connected social account rather than a Publication or Rendition.
_Avoid_: Engagement, communication

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

**Quiet sections**:
Parts of an audio track whose measured level stays below a chosen threshold, whether or not they contain speech.
_Avoid_: Silence, speech pauses

**Speech pauses**:
Parts of an audio track where speech detection finds no human speech, even when other audible sound remains.
_Avoid_: Silence, quiet sections
