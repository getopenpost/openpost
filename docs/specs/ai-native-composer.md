# AI-native composer

## Scope

OpenPost keeps the existing composer as the only editing and review surface. AI helps before and during drafting without adding a separate creation mode, build library, research screen, or final editor.

## User flow

1. An empty composer shows `Ideate`. It opens with one optional brief and an explicit `Get ideas` action. OpenPost then shows four ranked ideas tailored to the brief, selected destinations, and default Workspace voice. `Find more` adds another bounded set on request.
2. A composer with text shows `Build with AI`. It opens five selectable directions: keep the current angle, strongest recommendation, evidence-led, personal or opinion-led, and contrarian or unexpected.
3. Choosing an idea only selects it. `Continue` opens the direction grid. Choosing a direction does not mutate the composer. The explicit `Build` action submits the server-provided, bounded build direction and starts generation only after the build is accepted.
4. OpenPost returns to the composer with one canonical draft and account-specific Renditions. The user edits the result in place, can switch destination tabs, restore the original, or collapse an earned thread into one post.
5. The applied result shows a compact strategy summary for each destination, including the objective, format, media recommendation, and any safety or basic-adaptation warning.

## Generation rules

- Start from a factual kernel, choose one dominant outcome, then choose the route and write the prose.
- Preserve the user's facts, thesis, and recognizable voice. Remove generic AI phrasing during the final review pass.
- LinkedIn, X, Mastodon, Bluesky, and Threads use distinct native creative policies. Other providers receive conservative adaptation and must not claim native optimization.
- Destination versions may diverge in hook, shape, length, segmentation, and media treatment while keeping the same facts and thesis.
- Research, source checks, and citations are internal. The composer never shows a citation list. A link appears in a draft only when the platform or claim needs it.
- Existing attachments are source material and remain attached. AI never removes or replaces them.
- A weak destination is still returned with a warning. If a safe adaptation is not possible, OpenPost keeps the current text and marks the result as not adapted.

## Media recommendations

Every direction recommends a concrete media job or explicitly recommends no media. When the selected result calls for a meme, OpenPost renders three classic-template previews. The user must choose `Use` or `Edit`; no suggestion is attached automatically. An approved meme is attached only to the Renditions for which it was recommended.

## Durable behavior

Publication Builds persist in the Workspace and run through the durable job queue. The composer stores an accepted build ID, resumes it after reload, and continues polling when the workspace closes. Users can cancel an accepted queued or running build or retry a failed one. A rejected create request stays on direction selection and never appears as a running build.

Applying a result is conflict-safe. If the composer changed after generation began, OpenPost does not overwrite it and instead offers `Review and apply` or `Keep my edits`. Creating a Publication from a ready build uses the existing idempotent Publication creation boundary and validates publishable media in the same transaction.

## Voice and context

Each Workspace receives a default voice profile. The workspace shows `Writing as <voice>` and resolves the default automatically. Users can add optional notes and URLs and can explicitly allow those notes to appear in the post. Extracted source material is bounded and treated as untrusted input.

## Verification

- Backend tests cover migrations, Workspace isolation, bounded build directions, multiline source handling, native and basic platform policies, durable job state, retries, fencing, cancellation, build application, and idempotent Publication creation.
- Frontend tests cover explicit idea continuation, create-rejection presentation, result application, media preservation, account-specific Renditions, thread shape, meme previews, and Meme Maker handoff.
- UI acceptance covers desktop and phone widths, keyboard focus, reduced motion, dark mode, loading, empty, failure, conflict, and resumed-build states.
