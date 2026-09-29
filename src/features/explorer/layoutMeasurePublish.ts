import type { EditorState, StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type Item = { state: EditorState; effect: StateEffect<unknown>; alive: () => boolean; stale: () => void };
const queues = new WeakMap<EditorView, Item[]>();

/** The math and preview layout plugins read in the same CodeMirror measure pass
 * and must publish after it (a write phase still belongs to a view update).
 * Publishing each result in its own transaction made the sibling's result stale
 * (the first dispatch changed the state), which discarded it and re-measured
 * every visible line on the next frame. Results read from the same state are
 * published together in one transaction; results from an older state are
 * handed back to their plugin to measure again. */
export function publishMeasurement(view: EditorView, item: Item) {
  let queue = queues.get(view);
  if (!queue) {
    const pending: Item[] = queue = [];
    queues.set(view, pending);
    queueMicrotask(() => {
      queues.delete(view);
      const effects: StateEffect<unknown>[] = [];
      for (const entry of pending) {
        if (!entry.alive()) continue;
        if (entry.state === view.state) effects.push(entry.effect);
        else entry.stale();
      }
      if (effects.length) view.dispatch({ effects });
    });
  }
  queue.push(item);
}
