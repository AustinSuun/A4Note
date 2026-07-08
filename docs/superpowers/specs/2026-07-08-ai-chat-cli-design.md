# Aster AI Chat CLI Design

## Goal

Build a standalone AI chat scene for Aster that lets users talk to local AI CLI tools from inside the app. The user experience should reference Paseo where it is useful: provider selection, model selection, permission mode selection, long-running sessions, streaming output, stop/resume controls, and clear unavailable-provider states.

This is not a clone of Paseo's workspace/product model. Aster's AI chat is for the local knowledge base: papers, PDFs, notes, annotations, tags, and relations.

## First Version Scope

The first version focuses on the standalone `AI Chat` scene only. The reader side-panel AI chat remains unchanged until this flow is stable.

Supported providers are limited to:

- Claude
- Codex
- Copilot
- OpenCode
- Pi

There is no custom provider marketplace, no generic API-provider setup, and no additional provider family in this version. A provider can be shown as unavailable when its CLI is missing, not logged in, or not supported by the current platform.

## Product Behavior

The chat scene contains:

- A left rail with saved conversations and provider status.
- A main message timeline with streaming assistant output.
- A bottom composer with message input, send/stop button, attachment entry, `@` context entry, provider selector, model selector, permission selector, and context controls.
- Clear empty, loading, running, stopped, failed, and unavailable states.

The central workflow is:

1. User opens the AI chat scene.
2. Aster detects supported local CLI providers.
3. User chooses a provider, model, permission mode, and optional fixed context.
4. User sends a prompt.
5. Aster builds a knowledge-context prompt from automatic retrieval plus any fixed `@` references.
6. Tauri starts or reuses a local CLI session for the selected provider.
7. Output streams into the message timeline.
8. Messages and context references are saved to the local library.

## Knowledge Context

Context mode is hybrid:

- Automatic retrieval is always available. Aster searches current library data for related papers, notes, annotations, tags, and relations.
- Manual fixed context is available through `@paper`, `@note`, `@annotation`, and `@tag` entries in the composer.
- The final prompt contains a structured context block followed by the user's message.

The first version uses existing in-memory document data and relation helpers. It does not require a new vector index. If retrieval quality is not enough, later versions can add full-text search or embeddings without changing the provider interface.

## Provider Model

Each provider has a dedicated adapter:

- `codexAdapter`
- `claudeAdapter`
- `copilotAdapter`
- `opencodeAdapter`
- `piAdapter`

Each adapter owns:

- CLI detection.
- Availability and login diagnostics.
- Supported model list.
- Permission-mode mapping.
- Session start.
- Message send.
- Streaming output parsing.
- Stop and cleanup behavior.
- Error normalization.

Adapters expose one common interface to the app. Provider-specific command flags and stream formats do not leak into React components.

## Permission Modes

The UI exposes three shared permission modes:

- `Default permissions`: use the provider's normal approval and sandbox behavior.
- `Auto-review`: conservative mode for analysis, summaries, checks, and review-like tasks.
- `Full access`: explicit high-permission mode for users who want the CLI to act with fewer restrictions.

Adapters map these modes to provider-specific flags. For Codex, this maps to approval and sandbox options such as `--ask-for-approval`, `--sandbox`, and related config overrides. Other providers map the same UI modes to their own CLI options where available. When a provider cannot support a mode, the UI marks that mode unavailable for that provider.

Aster-owned data writes remain controlled. If an AI response proposes creating notes, tags, relations, or other knowledge-base changes, Aster shows a confirmation before writing to SQLite. CLI providers must not directly mutate the Aster database.

## Long-Running Sessions

The target effect follows Paseo's local-CLI chat feel: the user should not feel like Aster is making a one-shot API call. A session can be running, streaming, stopped, failed, or closed.

Implementation boundary:

- Tauri owns process lifecycle.
- Frontend owns UI state and sends commands through Tauri.
- A session is associated with a saved Aster AI thread.
- Stopping a generation should terminate or interrupt the underlying CLI process safely.
- If a provider does not support true interactive continuation, its adapter may emulate continuation by starting a new CLI invocation with conversation history and context.

This gives the UI a single long-running-session model while still allowing provider-specific fallback behavior.

## Data Model

Reuse the current tables:

- `ai_threads`
- `ai_messages`

The implementation should extend stored metadata as needed so a thread can remember:

- Provider id.
- Model id.
- Permission mode.
- Context references.
- Session status.

If schema changes are required, they should be additive. Existing AI messages must continue to load.

## UI Boundaries

`src/features/ai` owns the standalone AI chat scene:

- Chat shell.
- Conversation list.
- Message timeline.
- Composer.
- Provider picker.
- Model picker.
- Permission picker.
- Context picker.
- Hook/state for chat sessions.

`src/core` owns shared AI types and provider registry types.

`src/platform` owns frontend wrappers for Tauri commands.

`src-tauri` owns local CLI execution and process management.

The reader-side `ReaderChatPanel` remains a simple panel for now. It can later reuse the same provider/session primitives after the standalone scene is stable.

## Error Handling

Provider states should be explicit:

- Installed and ready.
- Installed but not logged in.
- Missing CLI.
- Unsupported platform.
- Failed to start.
- Running.
- Stopped by user.
- Exited with error.

Errors should be shown inside the chat scene without breaking the rest of the app. Aster should preserve user messages even when a provider run fails.

## Testing And Verification

Minimum verification for implementation:

- `npm run build`
- `npm run test:architecture`
- Tauri/Rust tests for provider detection and process command construction where practical.
- Manual desktop verification with at least Codex CLI.

When reader side-panel AI is touched in a later task, run reader-specific tests as well.

## Non-Goals

This version does not implement:

- Reader side-panel AI chat replacement.
- A provider marketplace.
- Custom provider authoring UI.
- Cloud-hosted AI API integration.
- Embedding/vector retrieval.
- Direct AI writes to SQLite without user confirmation.
- Full Paseo workspace management, Git workspace tabs, or multi-workspace history.

## Implementation Notes

Codex and Claude are installed on the current development machine. Copilot, OpenCode, and Pi may not be installed locally. The app should still ship their providers as first-class entries, with unavailable states when their binaries cannot be found.

Provider adapter behavior must be verified against each CLI before enabling a provider as ready. If a CLI is present but its streaming protocol is not stable, that provider can initially use the emulated-continuation fallback while still appearing in the same UI.
