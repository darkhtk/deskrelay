# Orchestration Centerline Plan

## Goal

DeskRelay orchestration must stop behaving like several independent panels that each infer state.
The manager, approval gate, worker ledger, round view, and work tab should read one canonical
orchestration snapshot.

The immediate implementation goal is a backend snapshot API. UI panels can then migrate to it
without changing the general chat area.

## Designed Items

1. **Single Orchestration Snapshot**
   - Expose one current-state object per project.
   - Include phase, current action label, active round, active tasks, active agents, approval actions,
     worker views, blockers, flow nodes, and update time.
   - UI panels should render this snapshot instead of each panel calculating state independently.

2. **Canonical Phase Model**
   - Supported phases:
     `idle`, `planning`, `ready`, `running`, `observing`, `needs_approval`,
     `applying_action`, `reviewing`, `replanning`, `completed`, `blocked`.
   - The phase is computed from command flow, round health, worker runs, blockers, and approval actions.
   - Conflicting labels such as "idle" and "approval waiting" must collapse into one phase.

3. **Event Log Direction**
   - Important changes should be append-only events:
     `project.created`, `round.started`, `worker.liveness`, `worker.completed`,
     `approval.created`, `approval.executed`, `approval.expired`, `state.reconciled`.
   - Initial implementation can project events from existing stores before adding a dedicated event store.

4. **Reducer / Reconciler**
   - Read raw stores: project, round, agent, task, decision, blocker, artifact, protocol.
   - Remove stale action suggestions.
   - Classify worker runtime state.
   - Select a single phase and current label.
   - Return a stable snapshot for the UI.

5. **Approval Action Queue**
   - Approval gate actions must be structured queue items, not free-floating buttons.
   - Every action needs id, type, target, risk, status, preflight result, payload, timestamps.
   - Button click flow:
     `preflight -> execute -> postcheck -> event/snapshot refresh`.
   - Stale actions should be hidden or marked stale before execution.

6. **Worker Runtime State**
   - Worker display state must be richer than task state:
     `queued`, `starting`, `active`, `quiet_but_alive`, `waiting_external`,
     `completed`, `failed`, `blocked`, `cancelled`, `stale_unknown`.
   - `quiet_but_alive` is not failure and must not produce retry approval.

7. **Manager Loop Separation**
   - Conversation loop answers the user promptly.
   - Supervision loop observes workers, reconciles state, and proposes actions.
   - User questions should not wait behind long-running worker observation.

8. **Work Tab Structure**
   - Do not touch the general chat window unless explicitly requested.
   - Work tab should be organized as:
     current state, state flow, next actions, agent/task status, execution timeline.
   - Agent rows are collapsed by default and expand for detailed rendered data.

9. **Backend Module Direction**
   - Target modules:
     `manager-orchestration-snapshot.ts`,
     `manager-action-queue.ts`,
     `manager-worker-liveness.ts`,
     `manager-approval-preflight.ts`,
     `manager-orchestration-events.ts`.
   - Keep `app.ts` as route wiring over time.

10. **API Direction**
    - Add:
      `GET /api/manager/projects/:id/orchestration`
    - Later:
      `GET /api/manager/projects/:id/orchestration/events`,
      `POST /api/manager/projects/:id/orchestration/reconcile`,
      `GET /api/manager/projects/:id/actions`,
      `POST /api/manager/actions/:id/preflight`,
      `POST /api/manager/actions/:id/execute`,
      `POST /api/manager/actions/:id/expire-stale`.

11. **Regression Test Direction**
    - Cover full project flow:
      create project -> protocol ready -> start round -> worker liveness -> worker completion
      -> approval action -> review -> next round or complete.
    - Include failure cases:
      quiet worker, failed worker, stale action, manager response delay, open-folder failure,
      and external access failure.

## First Implementation Slice

1. Add shared snapshot/action/worker view types.
2. Build snapshot from existing command-flow, round health, worker ledger, and blockers.
3. Add `GET /api/manager/projects/:id/orchestration`.
4. Add backend tests proving:
   - active worker produces `running` or `observing`, not `needs_approval`;
   - approval judgments produce `needs_approval`;
   - completed project produces `completed`;
   - stale retry actions are not exposed as available actions.

## Non-Goals For This Slice

- Do not redesign the chat window.
- Do not replace every work-tab panel at once.
- Do not add a persistent event store before the snapshot reducer is stable.
- Do not launch new long-running orchestration validation until the snapshot API exists.
