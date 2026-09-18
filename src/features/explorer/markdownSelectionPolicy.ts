import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// Notes use a single caret/range, not the code editor's additive selections.
// Do not consume DOM clicks: Ctrl/Meta link navigation and Shift selection stay intact.
export const markdownSingleSelection = [
  // basicSetup enables multiple selections with an OR-combined facet, so
  // another false value cannot override it. Normalize transactions instead.
  EditorState.transactionFilter.of(transaction => transaction.newSelection.ranges.length > 1
    ? [transaction, { selection: transaction.newSelection.asSingle(), sequential: true }]
    : transaction),
  EditorView.clickAddsSelectionRange.of(() => false),
];
