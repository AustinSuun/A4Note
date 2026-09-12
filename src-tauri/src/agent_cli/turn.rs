//! Run isolation.
//!
//! A provider can start streaming before the request that created the turn has
//! returned its id, and a stopped run can still flush frames that were already
//! in flight. [`RunGate`] is the single place that decides which events belong
//! to the live run. Mirrors `AgentRunGate` in `src/core/agentProtocol.ts`.

use super::protocol::AgentEvent;

#[derive(Debug, Default)]
pub struct RunGate {
    current: Option<String>,
    buffered: Vec<AgentEvent>,
}

impl RunGate {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn current(&self) -> Option<&str> {
        self.current.as_deref()
    }

    /// Holds an event that arrived before the run id was known. Once a run is
    /// open there is nothing to buffer, so this is a no-op and the caller should
    /// be going through [`accept`](Self::accept) instead.
    pub fn buffer(&mut self, event: AgentEvent) {
        if self.current.is_some() {
            return;
        }
        self.buffered.push(event);
    }

    /// Opens `run_id` and returns the buffered events that belong to it. Events
    /// buffered for any other run are dropped: they came from a turn that is
    /// already over, and replaying them would corrupt the new answer.
    pub fn open(&mut self, run_id: impl Into<String>) -> Vec<AgentEvent> {
        let run_id = run_id.into();
        let buffered = std::mem::take(&mut self.buffered);
        let replay = buffered
            .into_iter()
            .filter(|event| event.run_id() == run_id)
            .collect();
        self.current = Some(run_id);
        replay
    }

    /// True when the event belongs to the open run. False both for a stale run
    /// and for the window before any run is open.
    pub fn accept(&self, event: &AgentEvent) -> bool {
        self.current
            .as_deref()
            .is_some_and(|run_id| event.run_id() == run_id)
    }

    /// Ends the current run. Anything buffered afterwards belongs to the next
    /// one, so the buffer is cleared here rather than at `open`.
    pub fn close(&mut self) {
        self.current = None;
        self.buffered.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delta(run_id: &str, content: &str) -> AgentEvent {
        AgentEvent::Delta {
            session_id: "s1".to_string(),
            run_id: run_id.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn replays_the_new_run_and_drops_the_stale_one() {
        let mut gate = RunGate::new();
        gate.buffer(delta("r1", "old"));
        gate.buffer(delta("r2", "new-a"));
        gate.buffer(delta("r2", "new-b"));
        let replay = gate.open("r2");
        assert_eq!(replay, vec![delta("r2", "new-a"), delta("r2", "new-b")]);
        assert_eq!(gate.current(), Some("r2"));
    }

    #[test]
    fn accepts_only_the_open_run() {
        let mut gate = RunGate::new();
        // Before any run is open nothing is acceptable, not even a plausible id.
        assert!(!gate.accept(&delta("r1", "x")));
        gate.open("r1");
        assert!(gate.accept(&delta("r1", "x")));
        assert!(!gate.accept(&delta("r2", "x")));
    }

    #[test]
    fn closing_forgets_the_run_and_its_buffer() {
        let mut gate = RunGate::new();
        gate.open("r1");
        // A run that is already open has nothing to buffer.
        gate.buffer(delta("r1", "x"));
        gate.close();
        assert_eq!(gate.current(), None);
        gate.buffer(delta("r2", "y"));
        assert_eq!(gate.open("r2"), vec![delta("r2", "y")]);
    }
}
