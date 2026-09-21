# MCP review · task detail modal

## Task

- Task ID: `c2a1bcdd-4f69-4f85-abd4-4f03138a98a6`
- Worktree: `task-detail-modal-arena`
- Scope: make the task detail dialog easier to scan and review without changing the project-task state machine, revision fencing, acceptance API payloads, attachment operations, or event ordering.

## Implementation notes

- The dialog identity line now renders `任务详情 · #短编号 · 标题`, exposes the full UUID, and reports copy success/failure through an `aria-live` status.
- Requirements are kept verbatim in two content cards. The execution tab separates Agent, presence/heartbeat, and current phase, and limits that tab to three key activities.
- The history component uses a real vertical timeline with event kind, actor, time, a derived summary, and an explicit text button for the raw payload. Unknown event kinds remain visible rather than being dropped.
- Review actions are in the scrolling body after the content. Feedback is collapsed until requested, focuses and scrolls into view when opened, and retains the existing `request_changes` / `archive` calls and revision guard. Destructive delete remains behind a separate “更多操作” disclosure.
- The delivery summary has one real `交付成果与实际效果` heading. References, reports, notes, and attachment management are text-button disclosures rather than native `details` controls in the delivery summary path.
- Acceptance criteria are vertical cards. Manual mode foregrounds the original explanation and expected outcome; machine-oriented capability, objective, screenshot, and ID fields are in the advanced configuration. Existing acceptance action payloads are unchanged.

## Validation

- `get_diagnostics` on `src/features/taskboard`: 0 errors, 0 warnings.
- `npm run test:project-tasks`: passed; 87 tests, 86 passed, 1 skipped; task acceptance regression 109 assertions; edit-conflict and launcher checks passed.
- `npm run build`: passed (`tsc -b` and Vite build). Existing Vite warnings about a large chunk and an ineffective dynamic import remain informational.
- `node scripts/verify-task-detail-review-ui-browser.mjs`: passed 138 browser checks with no failed checks, including 1366/1568 widths, zoom, maximized/narrow layouts, in-flow actions, feedback focus, evidence/compare keyboard behavior, non-review and archived states.

## Final screenshots

- `docs/screenshots/task-detail/requirements.png` — 任务要求 tab
- `docs/screenshots/task-detail/execution.png` — 执行记录 tab and status summary/timeline
- `docs/screenshots/task-detail/evidence.png` — 验收与证据 tab and delivery summary
- `docs/screenshots/task-detail/history.png` — 完整历史 tab and full vertical timeline

