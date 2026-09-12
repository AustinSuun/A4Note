//! Local Agent CLI runtime: the wire contract (CLI-0), the process layer (CLI-1) and
//! the provider adapters (CLI-2 onwards).
//!
//! The split is deliberate. `protocol` / `transport` / `peer` / `turn` decode
//! frames, correlate requests, shape errors and isolate runs — all over an
//! abstract transport, so tests drive a fake peer through an in-memory pipe.
//! `launch` / `process` / `supervisor` add the real thing: what to spawn and with
//! which environment, a `std::process::Child` behind the same transport trait, and
//! one thread per session translating provider frames into `AgentEvent`s.
//! `providers` holds one adapter per CLI and nothing else.
//!
//! Still no Tauri here: the commands live in `crate::agent_bridge`, which is the only
//! file that knows both this runtime and the app. Everything below it can be tested
//! with `cargo test` and no window.

pub mod launch;
pub mod peer;
pub mod process;
pub mod protocol;
pub mod providers;
pub mod supervisor;
pub mod transport;
pub mod turn;

pub use launch::{resolve_program, LaunchConfig, STRIPPED_ENV_VARS};
pub use peer::{AgentPeer, PeerNotice, PumpOutcome, DEFAULT_REQUEST_TIMEOUT};
pub use process::{ChildTransport, StopLadder};
pub use protocol::{
    AgentError, AgentErrorKind, AgentEvent, JsonlDecoder, RpcFrame, StderrTail, STDERR_TAIL_LIMIT,
};
pub use providers::{ClaudeSession, CodexSession, ProviderHandle, CLAUDE_PROGRAM, CODEX_PROGRAM};
pub use supervisor::{
    AgentSupervisor, ProviderSession, SessionSink, SessionSpec, TurnFrame, TurnStart, TurnUpdate,
};
pub use transport::{AgentTransport, FakePeer, InMemoryTransport, ProcessExit, TransportRead};
pub use turn::RunGate;
