import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { markdown as markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { languages as codeLanguages } from '@codemirror/language-data';
import { calloutLabel, isKnownCalloutType } from '../../shared/markdown';
import { defaultKeymap, indentWithTab, historyKeymap } from '@codemirror/commands';
import { Annotation, EditorState, StateEffect, StateField, type Range, type Transaction } from '@codemirror/state';
import { codeFolding, defaultHighlightStyle, foldedRanges, foldEffect, HighlightStyle, syntaxHighlighting, syntaxTree, unfoldEffect } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Decoration, EditorView, WidgetType, keymap, placeholder } from '@codemirror/view';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { isTauriRuntime, openExternalUrl } from '../../platform/projects';

export interface MarkdownLivePreviewEditorHandle {
  setMarkdown: (markdown: string) => void;
  focus: () => void;
  scrollToLine: (lineNumber: number) => void;
  hasSelection: () => boolean;
  insertMarkdown: (before: string, after?: string, placeholder?: string) => void;
  clearFormatting: () => void;
}

interface MarkdownLivePreviewEditorProps {
  markdown: string;
  placeholder: string;
  sourceMode?: boolean;
  /** Identifies the editor instance that owns a change callback. */
  sessionId?: number;
  onChange: (markdown: string, context?: { previousMarkdown: string; sourceMode: boolean; sessionId: number }) => void;
  onBlur: () => void;
  onOpenWikiLink?: (target: string) => void;
}

const modeChanged = StateEffect.define<boolean>();
// Parent state can update the editor (for example after changing the document
// title or applying an external patch). Those transactions must not be
// reported back as user edits, otherwise the parent and CodeMirror can keep
// re-inserting the heading into each other.
const externalDocumentSync = Annotation.define<boolean>();

function safeExternalMarkdownUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 4096 || /[\u0000-\u001f\u007f\s]/u.test(trimmed) || /^(?:javascript|vbscript|data:text\/html):/i.test(trimmed)) return '';
  if (/^(?:https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  return '';
}

function openMarkdownUrl(url: string) {
  const safeUrl = safeExternalMarkdownUrl(url);
  if (!safeUrl) return;
  if (isTauriRuntime()) {
    void openExternalUrl(safeUrl).catch(() => window.open(safeUrl, '_blank', 'noopener,noreferrer'));
    return;
  }
  window.open(safeUrl, '_blank', 'noopener,noreferrer');
}

type MarkdownLinkMatch = { from: number; to: number; label: string; url: string; source: string };

function collectMarkdownLinks(text: string): MarkdownLinkMatch[] {
  const links: MarkdownLinkMatch[] = [];
  const addMatches = (pattern: RegExp, getLabel: (match: RegExpMatchArray) => string, getUrl: (match: RegExpMatchArray) => string) => {
    for (const match of text.matchAll(pattern)) {
      const source = match[0];
      const from = match.index ?? 0;
      if (from > 0 && text[from - 1] === '!') continue;
      const url = safeExternalMarkdownUrl(getUrl(match));
      if (!url) continue;
      links.push({ from, to: from + source.length, label: getLabel(match), url, source });
    }
  };
  addMatches(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match) => match[1] ?? '', (match) => match[2] ?? '');
  addMatches(/<((?:https?:\/\/|mailto:|tel:)[^>\s]+)>/gi, (match) => match[1] ?? '', (match) => match[1] ?? '');
  addMatches(/(?<![\w"'=\(])(https?:\/\/[^\s<>()]+|mailto:[^\s<>()]+)/gi, (match) => match[1] ?? '', (match) => (match[1] ?? '').replace(/[.,!?;:，。！？；：]+$/u, ''));
  links.sort((left, right) => left.from - right.from || right.to - left.to);
  return links.filter((link, index) => !links.slice(0, index).some((previous) => link.from < previous.to && previous.from < link.to));
}

function markdownLinkAt(state: EditorState, position: number) {
  const line = state.doc.lineAt(position);
  const localPosition = position - line.from;
  return collectMarkdownLinks(line.text)
    .map((link) => ({ ...link, from: link.from + line.from, to: link.to + line.from }))
    .find((link) => localPosition >= link.from - line.from && localPosition < link.to - line.from) ?? null;
}

const markdownHeadingHighlight = HighlightStyle.define([
  { tag: tags.heading, textDecoration: 'none', fontWeight: 'bold' },
]);

/**
 * Fenced code tokens carry the same `tok-*` classes the reading view uses, so
 * both surfaces read from one palette in `markdown.css` instead of each owning
 * a set of colours.
 */
const fenceTokenHighlight = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: 'tok-comment' },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.modifier, tags.self], class: 'tok-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.docString, tags.character, tags.attributeValue, tags.regexp], class: 'tok-string' },
  { tag: [tags.number, tags.integer, tags.float, tags.unit], class: 'tok-number' },
  { tag: [tags.bool, tags.null, tags.atom, tags.constant(tags.name), tags.escape, tags.color], class: 'tok-constant' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName, tags.labelName], class: 'tok-function' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], class: 'tok-type' },
  { tag: [tags.propertyName, tags.attributeName], class: 'tok-propertyName' },
  { tag: [tags.operator, tags.derefOperator, tags.arithmeticOperator, tags.logicOperator, tags.bitwiseOperator, tags.compareOperator, tags.updateOperator, tags.definitionOperator, tags.typeOperator, tags.controlOperator], class: 'tok-operator' },
  { tag: [tags.punctuation, tags.separator, tags.bracket, tags.angleBracket, tags.squareBracket, tags.paren, tags.brace], class: 'tok-punctuation' },
  { tag: [tags.meta, tags.documentMeta, tags.annotation, tags.processingInstruction], class: 'tok-meta' },
  { tag: tags.invalid, class: 'tok-invalid' },
]);

const latexSymbols: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  pm: '±', times: '×', cdot: '·', leq: '≤', geq: '≥', neq: '≠', approx: '≈', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←',
};

function renderLatex(source: string) {
  return source
    .replace(/\\([A-Za-z]+)/g, (_, name: string) => latexSymbols[name] ?? name)
    .replace(/\^\{([^}]+)\}/g, (_, value: string) => `^${value}`)
    .replace(/_\{([^}]+)\}/g, (_, value: string) => `_${value}`)
    .replace(/[{}]/g, '')
    .replace(/\\/g, '');
}

// A small, dependency-free TeX presentation layer. It intentionally focuses on
// notation commonly used in notes while keeping the source editable in place.
const latexDisplaySymbols: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ϵ', theta: 'θ', vartheta: 'ϑ', lambda: 'λ', mu: 'μ', pi: 'π', varpi: 'ϖ', sigma: 'σ', phi: 'φ', varphi: 'ϕ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  pm: '±', times: '×', cdot: '·', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', approx: '≈', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
  dots: '…', ldots: '…', cdots: '⋯', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', therefore: '∴',
};

function escapeLatexHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readLatexGroup(source: string, start: number) {
  if (source[start] !== '{') return null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return { value: source.slice(start + 1, index), end: index + 1 };
    }
  }
  return null;
}

function renderLatexInlineHtml(source: string): string {
  const output: string[] = [];
  const appendScript = (kind: 'sup' | 'sub', value: string) => {
    const base = output.pop() ?? '';
    output.push(`<span class="cm-md-math-script-base">${base}<${kind}>${renderLatexInlineHtml(value)}</${kind}></span>`);
  };
  const readAtom = (start: number) => {
    if (source[start] === '{') {
      const group = readLatexGroup(source, start);
      if (group) return { value: group.value, end: group.end };
    }
    if (source[start] === '\\') {
      const command = source.slice(start).match(/^\\([A-Za-z]+|.)/);
      if (command) return { value: command[0], end: start + command[0].length };
    }
    return { value: source[start] ?? '', end: start + 1 };
  };

  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (/\s/.test(character)) { output.push(' '); index += 1; continue; }
    if (character === '^' || character === '_') {
      const atom = readAtom(index + 1);
      appendScript(character === '^' ? 'sup' : 'sub', atom.value);
      index = atom.end;
      continue;
    }
    if (character === '\\') {
      if (source[index + 1] === '\\') { output.push('<br />'); index += 2; continue; }
      const command = source.slice(index).match(/^\\([A-Za-z]+|.)/);
      if (!command) { index += 1; continue; }
      const name = command[1];
      index += command[0].length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const numerator = readLatexGroup(source, index);
        if (numerator) {
          index = numerator.end;
          const denominator = readLatexGroup(source, index);
          if (denominator) {
            index = denominator.end;
            output.push(`<span class="cm-md-math-frac"><span>${renderLatexInlineHtml(numerator.value)}</span><span>${renderLatexInlineHtml(denominator.value)}</span></span>`);
            continue;
          }
        }
      }
      if (name === 'sqrt') {
        const radicand = readLatexGroup(source, index);
        if (radicand) { index = radicand.end; output.push(`<span class="cm-md-math-sqrt"><span class="cm-md-math-radical">√</span><span>${renderLatexInlineHtml(radicand.value)}</span></span>`); continue; }
      }
      if (name === 'text' || name === 'mathrm' || name === 'operatorname' || name === 'mathbf') {
        const group = readLatexGroup(source, index);
        if (group) { index = group.end; output.push(`<span class="cm-md-math-text">${renderLatexInlineHtml(group.value)}</span>`); continue; }
      }
      if (name === 'left' || name === 'right' || name === 'displaystyle' || name === 'textstyle' || name === 'limits' || name === '!') continue;
      if (name === ',' || name === ';' || name === ':' || name === ' ' || name === 'quad' || name === 'qquad') { output.push('&thinsp;'); continue; }
      const symbol = latexDisplaySymbols[name];
      if (symbol) { output.push(`<span class="cm-md-math-symbol">${symbol}</span>`); continue; }
      if (name === '{' || name === '}' || name === '[' || name === ']' || name === '(' || name === ')' || name === '|' || name === ',') { output.push(escapeLatexHtml(name)); continue; }
      output.push(`<span class="cm-md-math-command">${escapeLatexHtml(name)}</span>`);
      continue;
    }
    if (character === '{' || character === '}') { index += 1; continue; }
    output.push(escapeLatexHtml(character));
    index += 1;
  }
  return output.join('');
}

function renderLatexEnvironmentHtml(environment: 'cases' | 'array', source: string) {
  const rows = source.split(/\\\\/g).map((row) => row.trim()).filter(Boolean);
  const body = rows.map((row) => {
    const cells = row.split(/\s*&\s*/);
    return `<tr>${cells.map((cell) => `<td>${renderLatexInlineHtml(cell)}</td>`).join('')}</tr>`;
  }).join('');
  return `<table class="cm-md-math-table cm-md-math-${environment}"><tbody>${body}</tbody></table>`;
}

function renderLegacyLatexHtml(source: string) {
  const environment = source.match(/\\begin\{(cases|array)\}(?:\{[^}]*\})?([\s\S]*?)\\end\{\1\}/);
  if (!environment || environment.index == null) return renderLatexInlineHtml(source);
  const before = source.slice(0, environment.index);
  const after = source.slice(environment.index + environment[0].length);
  return `${renderLatexInlineHtml(before)}${renderLatexEnvironmentHtml(environment[1] as 'cases' | 'array', environment[2])}${renderLatexInlineHtml(after)}`;
}

function renderLatexHtml(source: string, display: boolean): string {
  const expression = source.trim();
  if (!expression) return '';
  try {
    return katex.renderToString(expression, {
      displayMode: display,
      output: 'htmlAndMathml',
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    });
  } catch {
    // Keep malformed input visible and editable instead of breaking the whole
    // CodeMirror decoration pass.
    const escaped = expression.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<span class="cm-md-math-error">${escaped}</span>`;
  }
}

class LatexWidget extends WidgetType {
  constructor(private readonly source: string, private readonly display: boolean, private readonly from: number, private readonly to: number, private readonly cursorOffset = 1) { super(); }
  eq(other: LatexWidget) { return other.source === this.source && other.display === this.display && other.from === this.from && other.to === this.to && other.cursorOffset === this.cursorOffset; }
  toDOM(view: EditorView) {
    const element = document.createElement('span');
    element.className = this.display ? 'cm-md-math cm-md-math-display' : 'cm-md-math';
    const content = document.createElement('span');
    content.className = 'cm-md-math-content';
    content.innerHTML = renderLatexHtml(this.source, this.display);
    element.append(content);
    element.setAttribute('aria-label', `LaTeX ${this.source}`);
    // Replaced widgets do not contain an editable text node. Clicking the
    // rendered formula must still place the cursor in its original source so
    // live preview can reveal the syntax for editing.
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: Math.min(this.from + this.cursorOffset, this.to) } });
      view.focus();
    });
    return element;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly alt: string,
    private readonly sourceFrom?: number,
    private readonly sourceTo?: number,
  ) { super(); }
  eq(other: ImageWidget) {
    return other.source === this.source
      && other.alt === this.alt
      && other.sourceFrom === this.sourceFrom
      && other.sourceTo === this.sourceTo;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-md-image-wrap cm-md-image-preview';
    const image = document.createElement('img');
    image.className = 'cm-md-image';
    image.src = this.source;
    image.alt = this.alt;
    image.loading = 'lazy';
    wrapper.append(image);
    const sourceFrom = this.sourceFrom;
    const sourceTo = this.sourceTo;
    if (sourceFrom != null && sourceTo != null) {
      // The preview is a zero-width widget appended after the real Markdown
      // source. Clicking it enters the source range instead of leaving the
      // caret stranded on the following line.
      wrapper.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ selection: { anchor: sourceFrom, head: sourceTo } });
        view.focus();
      });
    }
    return wrapper;
  }
}

class MarkdownLinkWidget extends WidgetType {
  constructor(private readonly label: string, private readonly url: string) { super(); }
  eq(other: MarkdownLinkWidget) { return other.label === this.label && other.url === this.url; }
  toDOM() {
    const anchor = document.createElement('a');
    anchor.className = 'cm-md-link-widget';
    anchor.href = this.url;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.textContent = this.label || this.url;
    anchor.title = this.url;
    anchor.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMarkdownUrl(this.url);
    });
    return anchor;
  }
  ignoreEvent() { return true; }
}

/** A compact task-list control that keeps the Markdown marker editable. */
class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean, private readonly from: number, private readonly to: number) { super(); }
  eq(other: TaskCheckboxWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cm-md-task-checkbox${this.checked ? ' is-checked' : ''}`;
    button.setAttribute('role', 'checkbox');
    button.setAttribute('aria-checked', String(this.checked));
    button.setAttribute('aria-label', this.checked ? '取消任务完成状态' : '标记任务为已完成');
    button.title = this.checked ? '标记为未完成' : '标记为已完成';
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const marker = this.checked ? '[ ]' : '[x]';
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: marker },
        selection: { anchor: this.from + marker.length },
      });
      view.focus();
    });
    return button;
  }
  ignoreEvent() { return true; }
}

/**
 * Marker glyphs by nesting depth, matching the reading view's list styling:
 * `ul` disc, `ul ul` circle, `ul ul ul` square, then the cycle repeats, and
 * `ol` decimal, `ol ol` lower-alpha, `ol ol ol` lower-roman.
 */
const listBullets = ['•', '◦', '▪'];

const romanNumerals: Array<[number, string]> = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

function toRoman(value: number) {
  let remaining = Math.max(1, value);
  let roman = '';
  for (const [amount, numeral] of romanNumerals) {
    while (remaining >= amount) {
      roman += numeral;
      remaining -= amount;
    }
  }
  return roman;
}

/** `1.` / `a.` / `i.` depending on nesting depth, like `ol` / `ol ol` / `ol ol ol`. */
function orderedLabel(index: number, depth: number) {
  const cycle = depth % 3;
  if (cycle === 1) return `${String.fromCharCode(96 + ((index - 1) % 26) + 1)}.`;
  if (cycle === 2) return `${toRoman(index)}.`;
  return `${index}.`;
}

/**
 * The list marker, drawn where the source marker sits.
 *
 * Replacing `- ` / `1. ` in place is what keeps the bullet aligned with the
 * dash: a hidden marker would still reserve its width, which left a blank gap
 * after the bullet and doubled the visual indent.
 */
class ListMarkerWidget extends WidgetType {
  constructor(private readonly label: string, private readonly ordered: boolean, private readonly depth: number) { super(); }
  eq(other: ListMarkerWidget) {
    return other.label === this.label && other.ordered === this.ordered && other.depth === this.depth;
  }
  toDOM() {
    const marker = document.createElement('span');
    marker.className = `cm-md-list-marker${this.ordered ? ' is-ordered' : ''} cm-md-list-marker-level-${this.depth}`;
    marker.textContent = this.label;
    marker.setAttribute('aria-hidden', 'true');
    return marker;
  }
  ignoreEvent() { return false; }
}

/** lucide path data, kept in sync with MarkdownCallout.tsx's icon choices. */
const calloutIconPaths: Record<string, string[]> = {
  info: ['M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M12 16v-4', 'M12 8h.01'],
  tip: ['M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'],
  warning: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  danger: ['M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M12 8v4', 'M12 16h.01'],
  success: ['M21.801 10A10 10 0 1 1 17 3.335', 'm9 11 3 3L22 4'],
  question: ['M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
  quote: ['M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z', 'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'],
};

/** Callout type to icon set, mirroring calloutIcon() in the shared renderer. */
function calloutIconPathsFor(type: string) {
  if (type === 'tip' || type === 'hint') return calloutIconPaths.tip;
  if (type === 'warning' || type === 'caution' || type === 'todo') return calloutIconPaths.warning;
  if (type === 'danger' || type === 'error') return calloutIconPaths.danger;
  if (type === 'success' || type === 'check') return calloutIconPaths.success;
  if (type === 'question' || type === 'help') return calloutIconPaths.question;
  if (type === 'quote') return calloutIconPaths.quote;
  return calloutIconPaths.info;
}

/**
 * The callout header, drawn where `> [!TYPE] ` sits.
 *
 * The reading view renders lucide icons and a localized type label; hiding the
 * marker text left its width reserved, which pushed the title away from the icon
 * and made the two surfaces look unrelated. Replacing the marker puts the same
 * icon and label in its place.
 */
class CalloutMarkerWidget extends WidgetType {
  constructor(private readonly type: string, private readonly label: string) { super(); }
  eq(other: CalloutMarkerWidget) { return other.type === this.type && other.label === this.label; }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-md-callout-badge';
    wrap.setAttribute('aria-hidden', 'true');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('class', 'cm-md-callout-icon');
    for (const path of calloutIconPathsFor(this.type)) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      node.setAttribute('d', path);
      icon.appendChild(node);
    }
    wrap.appendChild(icon);
    if (this.label) {
      const label = document.createElement('span');
      label.className = 'cm-md-callout-badge-label';
      label.textContent = this.label;
      wrap.appendChild(label);
    }
    return wrap;
  }
  ignoreEvent() { return false; }
}

/**
 * Copy button for a fenced code block, matching the reading view's affordance.
 *
 * It is attached to the opening fence line and reads the block back out of the
 * document, so it keeps working while the code is being edited.
 */
class CodeCopyWidget extends WidgetType {
  constructor(private readonly fenceLine: number) { super(); }
  eq(other: CodeCopyWidget) { return other.fenceLine === this.fenceLine; }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-md-code-copy';
    button.title = '复制代码';
    button.setAttribute('aria-label', '复制代码');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    for (const d of ['M20 8h-6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2']) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      icon.appendChild(path);
    }
    button.appendChild(icon);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const doc = view.state.doc;
      const body: string[] = [];
      for (let line = this.fenceLine + 1; line <= doc.lines; line += 1) {
        const text = doc.line(line).text;
        if (/^\s{0,3}(`{3,}|~{3,})/.test(text)) break;
        body.push(text);
      }
      void navigator.clipboard?.writeText(body.join('\n'));
      button.classList.add('is-copied');
      window.setTimeout(() => button.classList.remove('is-copied'), 1200);
    });
    return button;
  }
  ignoreEvent() { return true; }
}

/** One parsed GFM table: its source range, its lines and its cell grid. */
type TableRegion = {
  from: number;
  to: number;
  firstLine: number;
  lastLine: number;
  align: Array<'left' | 'center' | 'right' | null>;
  rows: Array<{ line: number; cells: Array<{ text: string; from: number }> }>;
};

const tableRowPattern = /^\s*\|.*\|\s*$/;
const tableDelimiterPattern = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/** Splits `| a | b |` into cells, keeping each cell's document offset. */
function splitTableRow(text: string, lineFrom: number) {
  const cells: Array<{ text: string; from: number }> = [];
  let cursor = text.indexOf('|');
  if (cursor === -1) return cells;
  cursor += 1;
  let start = cursor;
  for (; cursor <= text.length; cursor += 1) {
    const char = text[cursor];
    if (char === '|' || cursor === text.length) {
      const raw = text.slice(start, cursor);
      if (!(cursor === text.length && raw.trim() === '')) {
        const leading = raw.length - raw.trimStart().length;
        cells.push({ text: raw.trim(), from: lineFrom + start + leading });
      }
      start = cursor + 1;
    }
  }
  return cells;
}

function parseAlignment(text: string): Array<'left' | 'center' | 'right' | null> {
  return text.split('|').map((part) => part.trim()).filter((part) => part.length > 0).map((part) => {
    const left = part.startsWith(':');
    const right = part.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

/**
 * Finds tables that can be rendered: a header row, a delimiter row and any
 * number of body rows. Lines inside a fence are skipped so a table drawn inside
 * a code sample stays code.
 */
function findTableRegions(state: EditorState, fencedLines: Set<number>): TableRegion[] {
  const regions: TableRegion[] = [];
  let lineNumber = 1;
  while (lineNumber < state.doc.lines) {
    const header = state.doc.line(lineNumber);
    const delimiter = state.doc.line(lineNumber + 1);
    const isTable = !fencedLines.has(lineNumber)
      && tableRowPattern.test(header.text)
      && tableDelimiterPattern.test(delimiter.text);
    if (!isTable) {
      lineNumber += 1;
      continue;
    }
    let lastLine = lineNumber + 1;
    while (lastLine < state.doc.lines) {
      const next = state.doc.line(lastLine + 1);
      if (fencedLines.has(lastLine + 1) || !tableRowPattern.test(next.text)) break;
      lastLine += 1;
    }
    const rows: TableRegion['rows'] = [];
    for (let row = lineNumber; row <= lastLine; row += 1) {
      if (row === lineNumber + 1) continue;
      const rowLine = state.doc.line(row);
      rows.push({ line: row, cells: splitTableRow(rowLine.text, rowLine.from) });
    }
    regions.push({
      from: header.from,
      to: state.doc.line(lastLine).to,
      firstLine: lineNumber,
      lastLine,
      align: parseAlignment(delimiter.text),
      rows,
    });
    lineNumber = lastLine + 1;
  }
  return regions;
}

/**
 * A rendered GFM table.
 *
 * Editing stays source-based: clicking a cell drops the caret into that cell's
 * text, which reveals the whole table as source on the next redraw. Cells carry
 * plain text rather than re-parsed inline Markdown — the caret lands in the
 * source the moment you want to change anything, so a second inline renderer
 * would be a lot of surface area for a fraction of a second of fidelity.
 */
class TableWidget extends WidgetType {
  constructor(private readonly region: TableRegion) { super(); }
  eq(other: TableWidget) {
    return other.region.from === this.region.from
      && other.region.to === this.region.to
      && other.region.rows.length === this.region.rows.length
      && other.region.rows.every((row, index) => {
        const mine = this.region.rows[index];
        return mine.cells.length === row.cells.length && row.cells.every((cell, cellIndex) => cell.text === mine.cells[cellIndex].text);
      });
  }
  /**
   * One compact row plus the wrapper padding. Kept close to the real rendered
   * height so CodeMirror's height oracle does not have to correct itself after
   * paint, which is what makes clicks below the table land on the wrong line.
   */
  get estimatedHeight() { return Math.max(1, this.region.rows.length) * 30 + 9; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'markdown-table-wrap cm-md-table-widget';
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const body = document.createElement('tbody');
    this.region.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      row.cells.forEach((cell, cellIndex) => {
        const element = document.createElement(rowIndex === 0 ? 'th' : 'td');
        element.textContent = cell.text;
        const align = this.region.align[cellIndex];
        if (align) element.setAttribute('align', align);
        element.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          view.dispatch({ selection: { anchor: Math.min(cell.from, this.region.to) } });
          view.focus();
        });
        tr.appendChild(element);
      });
      (rowIndex === 0 ? head : body).appendChild(tr);
    });
    table.append(head, body);
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() { return false; }
}

class HeadingFoldWidget extends WidgetType {
  constructor(private readonly from: number, private readonly to: number, private readonly collapsed: boolean) { super(); }
  eq(other: HeadingFoldWidget) { return other.from === this.from && other.to === this.to && other.collapsed === this.collapsed; }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cm-md-heading-fold-toggle${this.collapsed ? ' is-collapsed' : ''}`;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', this.collapsed ? 'm9 18 6-6-6-6' : 'm6 9 6 6 6-6');
    icon.append(path);
    button.append(icon);
    button.title = this.collapsed ? '展开此标题内容' : '收起此标题内容';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(!this.collapsed));
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ effects: (this.collapsed ? unfoldEffect : foldEffect).of({ from: this.from, to: this.to }) });
    });
    return button;
  }
  ignoreEvent() { return true; }
}

class HeadingFoldPlaceholderWidget extends WidgetType {
  constructor(private readonly from: number, private readonly to: number) { super(); }
  eq(other: HeadingFoldPlaceholderWidget) { return other.from === this.from && other.to === this.to; }
  toDOM(view: EditorView) {
    const placeholder = document.createElement('span');
    placeholder.className = 'cm-md-heading-fold-placeholder';
    placeholder.textContent = '…';
    placeholder.setAttribute('role', 'button');
    placeholder.setAttribute('tabindex', '0');
    placeholder.setAttribute('aria-label', '展开此标题内容');
    placeholder.title = '展开此标题内容';
    const unfold = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ effects: unfoldEffect.of({ from: this.from, to: this.to }) });
    };
    placeholder.addEventListener('mousedown', (event) => event.preventDefault());
    placeholder.addEventListener('click', unfold);
    placeholder.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') unfold(event);
    });
    return placeholder;
  }
  ignoreEvent() { return true; }
}

type MarkdownHeading = { lineNumber: number; level: number };

function collectMarkdownHeadings(state: EditorState): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let inFence = false;
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const text = state.doc.line(lineNumber).text;
    const fenceMatch = text.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (!inFence && !fenceMatch) {
      const heading = text.match(/^\s{0,3}#{1,6}\s+/);
      if (heading) headings.push({ lineNumber, level: (heading[0].match(/#/g) ?? []).length });
    }
    if (fenceMatch) inFence = !inFence;
  }
  return headings;
}

function buildLiveDecorations(state: EditorState, sourceMode: boolean) {
  const decorations: Range<Decoration>[] = [];
  const headings = collectMarkdownHeadings(state);
  const activePos = state.selection.main.head;
  const activeLine = state.doc.lineAt(activePos).number;
  // Keep source markers scoped to the line (or block) under the cursor. A
  // one-character global allowance makes a cursor at the end of the previous
  // line accidentally reveal the syntax at the start of the next line.
  const cursorNear = (from: number, to: number) => {
    const boundedFrom = Math.max(0, Math.min(from, state.doc.length));
    const boundedTo = Math.max(boundedFrom, Math.min(to, state.doc.length));
    const firstLine = state.doc.lineAt(boundedFrom).number;
    const lastLine = state.doc.lineAt(boundedTo).number;
    if (activeLine < firstLine || activeLine > lastLine) return false;
    return activePos >= boundedFrom - 1 && activePos <= boundedTo + 1;
  };
  let inFence = false;
  let calloutType: string | null = null;
  let listIndentStack: number[] = [];
  let listCounters: Array<number | undefined> = [];
  let orderedListDepth: boolean[] = [];

  // Block math must be detected against the complete document: a line-by-line
  // regexp cannot recognize `$$` formulas containing cases, arrays, or breaks.
  const mathBlocks: Array<{ from: number; to: number; source: string; lines: Set<number> }> = [];
  if (!sourceMode) {
    const fencedLines = new Set<number>();
    let fenced = false;
    for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      const fence = line.text.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenced || fence) fencedLines.add(lineNumber);
      if (fence) fenced = !fenced;
    }
    const blockPattern = /(\$\$)([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g;
    const documentText = state.doc.toString();
    for (const match of documentText.matchAll(blockPattern)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      const firstLine = state.doc.lineAt(from).number;
      const lastLine = state.doc.lineAt(Math.max(from, to - 1)).number;
      let isFenced = false;
      const lines = new Set<number>();
      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
        lines.add(lineNumber);
        if (fencedLines.has(lineNumber)) isFenced = true;
      }
      if (!isFenced) mathBlocks.push({ from, to, source: match[2] ?? match[3] ?? '', lines });
    }
    for (const block of mathBlocks) {
      if (cursorNear(block.from, block.to)) {
        decorations.push(Decoration.mark({ class: 'cm-md-math-source cm-md-math-display-source' }).range(block.from, block.to));
      } else {
        decorations.push(Decoration.replace({ widget: new LatexWidget(block.source, true, block.from, block.to, 2), inclusive: false, block: true }).range(block.from, block.to));
      }
    }
  }
  const mathBlockLines = new Set(mathBlocks.flatMap((block) => [...block.lines]));

  // Tables render as a real table whenever the caret is elsewhere; with the
  // caret inside, the per-line source decorations below take over so the cells
  // stay editable.
  const tableWidgetLines = new Set<number>();
  if (!sourceMode) {
    const fencedLines = new Set<number>();
    let fenced = false;
    for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
      const fence = state.doc.line(lineNumber).text.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenced || fence) fencedLines.add(lineNumber);
      if (fence) fenced = !fenced;
    }
    for (const region of findTableRegions(state, fencedLines)) {
      if (cursorNear(region.from, region.to)) continue;
      if ([...mathBlockLines].some((line) => line >= region.firstLine && line <= region.lastLine)) continue;
      decorations.push(Decoration.replace({ widget: new TableWidget(region), inclusive: false, block: true }).range(region.from, region.to));
      for (let line = region.firstLine; line <= region.lastLine; line += 1) tableWidgetLines.add(line);
    }
  }

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const text = line.text;
    const isActiveLine = lineNumber === activeLine;
    const fenceMatch = text.match(/^\s{0,3}(`{3,}|~{3,})/);
    const insideFence = inFence;
    if (fenceMatch) inFence = !inFence;
    if (sourceMode) continue;
    if (mathBlockLines.has(lineNumber)) continue;
    if (tableWidgetLines.has(lineNumber)) continue;

    const hide = (from: number, to: number, className = 'cm-md-syntax-hidden') => {
      if (to > from) decorations.push(Decoration.mark({ class: className }).range(from, to));
    };
    const hideInlineSyntax = (from: number, to: number) => hide(from, to, 'cm-md-inline-syntax-hidden');
    const mark = (from: number, to: number, className: string) => {
      if (to > from) decorations.push(Decoration.mark({ class: className }).range(from, to));
    };
    if (fenceMatch) {
      // The fence regexp only captures the backtick run, so the info string has
      // to come from the line itself — reading it off the match is why the
      // language badge never had a value to render.
      const language = text.replace(/^\s{0,3}[`~]+/, '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9_+#-]/g, '');
      const languageClass = language ? ` cm-md-code-fence-${language}` : '';
      // Opening and closing fences need different caps. Deciding it here instead
      // of with a `+` sibling rule is what stops the closing fence from getting
      // the opening fence's top rounding as well, which showed as a notch.
      const boundaryClass = insideFence ? ' cm-md-code-end' : ' cm-md-code-start';
      decorations.push(Decoration.line({
        class: `cm-md-code-fence${languageClass}${boundaryClass}`,
        attributes: language ? { 'data-language': language } : undefined,
      }).range(line.from));
      // The whole line is the reveal target: clicking the header bar puts the
      // caret past the language word, which a backticks-only range missed.
      if (!cursorNear(line.from, line.to)) {
        hide(line.from, line.to);
        if (!insideFence) {
          decorations.push(Decoration.widget({ widget: new CodeCopyWidget(lineNumber), side: 1 }).range(line.to));
        }
      }
      continue;
    }
    if (insideFence) {
      decorations.push(Decoration.line({ class: 'cm-md-code-line' }).range(line.from));
      mark(line.from, line.to, 'cm-md-code-content');
      continue;
    }
    let imageWidgetAdded = false;

    const heading = text.match(/^\s{0,3}#{1,6}\s+/);
    if (heading) {
      const level = (heading[0].match(/#/g) ?? []).length;
      // Keep the heading's visual metrics on the line itself. The source
      // markers are only a visibility/editing concern, so revealing `# ` on
      // the active line cannot change the heading's size or line height.
      decorations.push(Decoration.line({ class: `cm-md-heading-line-${level}` }).range(line.from));
      const headingPrefixFrom = line.from + heading[0].search(/#/);
      const headingPrefixTo = line.from + heading[0].length;
      const headingContentFrom = headingPrefixTo;
      // Headings reveal their complete Markdown prefix whenever the cursor is
      // on the heading line, while inline syntax remains cursor-near based.
      if (!isActiveLine) {
        hide(headingPrefixFrom, headingPrefixTo, 'cm-md-heading-syntax-hidden');
        mark(headingContentFrom, line.to, `cm-md-heading-${level}`);
      } else {
        mark(headingPrefixFrom, headingPrefixTo, `cm-md-heading-source-${level}`);
        mark(headingContentFrom, line.to, `cm-md-heading-source-${level}`);
      }
      const nextHeading = headings.find((candidate) => candidate.lineNumber > lineNumber && candidate.level <= level);
      // Keep the heading's trailing newline outside the fold. Otherwise the
      // next heading is pulled onto the same visual line when this range is
      // replaced by CodeMirror's fold widget.
      const foldFrom = line.to < state.doc.length ? line.to + 1 : line.to;
      const firstBodyPosition = foldFrom;
      const nextHeadingLine = nextHeading ? state.doc.line(nextHeading.lineNumber) : null;
      // A replacement ending exactly at the next heading's line start can
      // consume the line boundary while CodeMirror rebuilds its height map.
      // Leave that boundary outside the fold whenever there is actual body
      // text. Blank-only sections still use the heading boundary so their
      // empty lines can be collapsed as before.
      const bodyBeforeNextHeading = nextHeadingLine
        ? state.doc.sliceString(firstBodyPosition, nextHeadingLine.from)
        : '';
      const foldTo = nextHeadingLine && bodyBeforeNextHeading.trim().length > 0
        ? Math.max(firstBodyPosition, nextHeadingLine.from - 1)
        : nextHeadingLine?.from ?? state.doc.length;
      if (foldTo > firstBodyPosition) {
        let collapsed = false;
        foldedRanges(state).between(foldFrom, foldTo, (from, to) => {
          if (from === foldFrom && to === foldTo) collapsed = true;
        });
        decorations.push(Decoration.widget({ widget: new HeadingFoldWidget(foldFrom, foldTo, collapsed), side: -1 }).range(line.from));
        if (collapsed) {
          decorations.push(Decoration.widget({ widget: new HeadingFoldPlaceholderWidget(foldFrom, foldTo), side: 1 }).range(line.to));
        }
      }
    }
    const horizontalRule = text.match(/^\s{0,3}(?:([-*_])\s*){3,}$/);
    if (horizontalRule) {
      decorations.push(Decoration.line({ class: 'cm-md-horizontal-rule' }).range(line.from));
      if (cursorNear(line.from, line.to)) mark(line.from, line.to, 'cm-md-horizontal-rule-source');
      else hide(line.from, line.to, 'cm-md-block-syntax-hidden');
      continue;
    }
    const footnoteDefinition = text.match(/^\s*\[\^([^\]]+)\]:\s*/);
    if (footnoteDefinition) {
      const prefixFrom = line.from + text.indexOf('[^');
      const prefixTo = line.from + footnoteDefinition[0].length;
      decorations.push(Decoration.line({ class: 'cm-md-footnote-definition' }).range(line.from));
      if (!cursorNear(prefixFrom, prefixTo)) hideInlineSyntax(prefixFrom, prefixTo);
      else mark(prefixFrom, prefixTo, 'cm-md-footnote-source');
      mark(prefixTo, line.to, 'cm-md-footnote-content');
      continue;
    }
    const tableRow = /^\s*\|.*\|\s*$/.test(text);
    if (tableRow) {
      const isTableSeparator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(text);
      decorations.push(Decoration.line({ class: `cm-md-table-line${isTableSeparator ? ' cm-md-table-separator' : ''}` }).range(line.from));
      if (isTableSeparator) {
        if (cursorNear(line.from, line.to)) mark(line.from, line.to, 'cm-md-table-separator-source');
        else hide(line.from, line.to, 'cm-md-block-syntax-hidden');
      }
      else {
        for (const delimiter of text.matchAll(/\|/g)) {
          const from = line.from + (delimiter.index ?? 0);
          mark(from, from + 1, 'cm-md-table-delimiter');
        }
      }
    }
    const list = text.match(/^(\s*)(?:[-+*]|\d+[.)])\s+/);
    if (list) {
      const orderedList = /^\s*\d+[.)]\s+/.test(text);
      const task = text.match(/^(\s*)(?:[-+*]|\d+[.)])\s+\[([ xX])\](?:\s+|$)/);
      const indent = (list[1] ?? '').replace(/\t/g, '    ').length;
      while (listIndentStack.length && indent < (listIndentStack.at(-1) ?? 0)) listIndentStack.pop();
      if (!listIndentStack.length || indent > (listIndentStack.at(-1) ?? 0)) listIndentStack.push(indent);
      const listDepth = Math.min(Math.max(listIndentStack.length - 1, 0), 6);
      // A parent item ends the nested counter scope. This keeps a nested
      // ordered list at 1, 2, ... for each parent while the parent continues
      // its own sequence after the child list.
      for (let depth = listDepth + 1; depth < listCounters.length; depth += 1) {
        listCounters[depth] = undefined;
        orderedListDepth[depth] = false;
      }
      const markerNumber = Number(text.match(/^\s*(\d+)[.)]/)?.[1] ?? 1);
      const orderedStart = orderedList && orderedListDepth[listDepth] !== true;
      if (orderedList) {
        if (orderedStart) listCounters[listDepth] = Math.max(markerNumber - 1, 0);
        listCounters[listDepth] = (listCounters[listDepth] ?? 0) + 1;
        orderedListDepth[listDepth] = true;
      } else {
        listCounters[listDepth] = undefined;
        orderedListDepth[listDepth] = false;
      }
      const listIndex = orderedList ? listCounters[listDepth] : undefined;
      const listPrefixActive = cursorNear(line.from, line.from + list[0].length);
      const listClass = `cm-md-list-line cm-md-list-level-${listDepth}${orderedList ? ' cm-md-list-ordered' : ''}${orderedStart ? ' cm-md-list-ordered-start' : ''}${task ? ' cm-md-task-line' : ''}${listPrefixActive ? ' cm-md-list-line-source' : ''}`;
      decorations.push(Decoration.line({ class: listClass, attributes: listIndex == null ? undefined : { 'data-list-index': String(listIndex) } }).range(line.from));
      // The whole prefix — indentation plus marker — is replaced by one widget.
      // The depth padding on the line supplies the indent, so leaving the source
      // spaces in place (even hidden) would indent the item twice, and drawing
      // the bullet with a pseudo-element on top of a hidden `1. ` is what showed
      // both markers at once when the caret revealed the source.
      const listPrefixFrom = line.from;
      const listPrefixTo = line.from + list[0].length;
      const itemFrom = listPrefixTo;
      if (listPrefixActive) {
        // The line padding already represents the list indentation. Keep the
        // source marker editable, but remove leading indentation whitespace so
        // revealing `  - ` does not add a second indentation on the active row.
        const markerFrom = line.from + (list[1] ?? '').length;
        if (markerFrom > listPrefixFrom) {
          decorations.push(Decoration.replace({ inclusive: false }).range(listPrefixFrom, markerFrom));
        }
        mark(markerFrom, listPrefixTo, 'cm-md-list-source');
      } else if (task) {
        // A task's marker is the checkbox that follows; no bullet as well.
        decorations.push(Decoration.replace({ inclusive: false }).range(listPrefixFrom, listPrefixTo));
      } else {
        const label = orderedList
          ? orderedLabel(listIndex ?? markerNumber, listDepth)
          : (listBullets[listDepth % listBullets.length] ?? '•');
        decorations.push(Decoration.replace({ widget: new ListMarkerWidget(label, orderedList, listDepth), inclusive: false }).range(listPrefixFrom, listPrefixTo));
      }
      if (task) {
        const taskFrom = itemFrom;
        const taskTo = taskFrom + 3;
        if (cursorNear(taskFrom, taskTo)) mark(taskFrom, taskTo, 'cm-md-task-source');
        else decorations.push(Decoration.replace({ widget: new TaskCheckboxWidget(task[2].toLowerCase() === 'x', taskFrom, taskTo), inclusive: false }).range(taskFrom, taskTo));
        mark(taskTo, line.to, 'cm-md-task-item');
      } else {
        mark(itemFrom, line.to, 'cm-md-list-item');
      }
    } else {
      listIndentStack = [];
      listCounters = [];
      orderedListDepth = [];
    }
    const quote = text.match(/^(\s*>\s?)/);
    const callout = text.match(/^(\s*>\s*)\[!([A-Za-z]+)\]\s*/);
    if (quote) {
      const currentCalloutType: string | null = callout ? callout[2].toLowerCase() : calloutType;
      const nextLineText = lineNumber < state.doc.lines ? state.doc.line(lineNumber + 1).text : '';
      const previousLineText = lineNumber > 1 ? state.doc.line(lineNumber - 1).text : '';
      const quoteContinues = /^\s*>\s?/.test(nextLineText);
      const calloutContinues = Boolean(currentCalloutType && quoteContinues);
      const calloutStart = Boolean(currentCalloutType && !calloutType);
      const calloutEnd = Boolean(currentCalloutType && !calloutContinues);
      // Run boundaries are decided here, not by a CSS `:has()` guess: an empty
      // `>` line in the middle of a quote made the sibling test pick the wrong
      // line, so the rounded cap and its shadow landed mid-block.
      const quoteStart = !currentCalloutType && !/^\s*>\s?/.test(previousLineText);
      const quoteEnd = !currentCalloutType && !quoteContinues;
      const lineClass = currentCalloutType
        ? `cm-md-callout-line cm-md-callout-${currentCalloutType}${calloutStart ? ' cm-md-callout-start' : ''}${calloutEnd ? ' cm-md-callout-end' : ''}`
        : `cm-md-quote-line${quoteStart ? ' cm-md-quote-start' : ''}${quoteEnd ? ' cm-md-quote-end' : ''}`;
      decorations.push(Decoration.line({
        class: lineClass,
        attributes: currentCalloutType ? { 'data-callout-type': currentCalloutType.toUpperCase() } : undefined,
      }).range(line.from));
      if (callout) {
        const calloutPrefixFrom = line.from + callout[1].indexOf('>');
        const calloutPrefixTo = line.from + callout[0].length;
        if (cursorNear(calloutPrefixFrom, calloutPrefixTo)) {
          mark(line.from + callout[1].length, line.from + callout[0].length, 'cm-md-callout-marker');
        } else {
          const type = callout[2].toLowerCase();
          decorations.push(Decoration.replace({
            // Unknown types keep the icon but drop the label: the badge on the
            // right already spells the raw name out.
            widget: new CalloutMarkerWidget(type, isKnownCalloutType(type) ? calloutLabel(type) : ''),
            inclusive: false,
          }).range(calloutPrefixFrom, calloutPrefixTo));
        }
        mark(line.from + callout[0].length, line.to, 'cm-md-callout-title');
        calloutType = currentCalloutType;
      } else {
        const quotePrefixFrom = line.from + quote[1].indexOf('>');
        const quotePrefixTo = line.from + quote[1].length;
        if (!cursorNear(quotePrefixFrom, quotePrefixTo)) hide(quotePrefixFrom, quotePrefixTo);
        mark(line.from + quote[1].length, line.to, currentCalloutType ? 'cm-md-callout-body' : 'cm-md-quote');
      }
    } else {
      calloutType = null;
    }

    for (const match of text.matchAll(/(?<!\$)\$([^$\n]+)\$(?!\$)|\\\(([^\n]*?)\\\)/g)) {
      const from = line.from + (match.index ?? 0);
      const full = match[0];
      const source = match[1] ?? match[2] ?? '';
      if (isActiveLine && cursorNear(from, from + full.length)) mark(from, from + full.length, 'cm-md-math-source');
      else {
        const openingLength = full.startsWith('$') ? 1 : 2;
        decorations.push(Decoration.replace({ widget: new LatexWidget(source, false, from, from + full.length, openingLength), inclusive: false }).range(from, from + full.length));
      }
    }

    for (const match of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
      const source = match[2];
      if (!/^(?:data:image\/|https?:\/\/)/i.test(source)) continue;
      const from = line.from + (match.index ?? 0);
      const to = from + match[0].length;
      if (isActiveLine && cursorNear(from, to)) {
        // Keep the source text in the document so the caret can move through
        // and edit alt text, URL and optional title. The image remains visible
        // as an inline preview immediately after the source.
        mark(from, to, 'cm-md-image-source');
        decorations.push(Decoration.widget({ widget: new ImageWidget(source, match[1], from, to), side: 1, block: false }).range(to));
      } else {
        decorations.push(Decoration.replace({ widget: new ImageWidget(source, match[1]), inclusive: false }).range(from, to));
      }
      imageWidgetAdded = true;
      if (isActiveLine) decorations.push(Decoration.line({ class: 'cm-md-image-line-active' }).range(line.from));
    }
    for (const match of text.matchAll(/<img\s+[^>]*src=["'](data:image\/[^"']+|https?:\/\/[^"']+)["'][^>]*>/gi)) {
      const source = match[1];
      const alt = match[0].match(/alt=["']([^"']*)["']/i)?.[1] ?? '';
      const from = line.from + (match.index ?? 0);
      const to = from + match[0].length;
      if (isActiveLine && cursorNear(from, to)) {
        mark(from, to, 'cm-md-image-source');
        decorations.push(Decoration.widget({ widget: new ImageWidget(source, alt, from, to), side: 1, block: false }).range(to));
      } else {
        decorations.push(Decoration.replace({ widget: new ImageWidget(source, alt), inclusive: false }).range(from, to));
      }
      imageWidgetAdded = true;
      if (isActiveLine) decorations.push(Decoration.line({ class: 'cm-md-image-line-active' }).range(line.from));
    }
    if (imageWidgetAdded && /^\s*(?:!\[[^\]]*\]\((?:data:image\/|https?:\/\/)[^)]+\)|<img\s+[^>]*src=["'](?:data:image\/|https?:\/\/)[^"']+["'][^>]*>)\s*$/i.test(text)) {
      decorations.push(Decoration.line({ class: 'cm-md-image-line' }).range(line.from));
    }

    // `***x***` first: the bold pass would otherwise consume `**x*` and leave a
    // stray `*` behind, which is why bold-italic only ever rendered as bold.
    const boldItalicRanges: Array<[number, number]> = [];
    for (const match of text.matchAll(/(\*\*\*|___)(.+?)\1/g)) {
      const from = line.from + (match.index ?? 0);
      const to = from + match[0].length;
      boldItalicRanges.push([from, to]);
      if (!cursorNear(from, to)) { hideInlineSyntax(from, from + 3); hideInlineSyntax(to - 3, to); }
      else mark(from, to, 'cm-md-bold-source');
      mark(from + 3, to - 3, 'cm-md-bold');
      mark(from + 3, to - 3, 'cm-md-italic');
    }
    const insideBoldItalic = (from: number, to: number) => boldItalicRanges.some(([start, end]) => from >= start && to <= end);

    for (const match of text.matchAll(/(\*\*|__)(.+?)\1/g)) {
      const from = line.from + (match.index ?? 0);
      if (insideBoldItalic(from, from + match[0].length)) continue;
      if (!cursorNear(from, from + match[0].length)) { hideInlineSyntax(from, from + 2); hideInlineSyntax(from + match[0].length - 2, from + match[0].length); }
      else mark(from, from + match[0].length, 'cm-md-bold-source');
      mark(from + 2, from + match[0].length - 2, 'cm-md-bold');
    }
    for (const match of text.matchAll(/~~(.+?)~~/g)) {
      const from = line.from + (match.index ?? 0);
      if (!cursorNear(from, from + match[0].length)) { hideInlineSyntax(from, from + 2); hideInlineSyntax(from + match[0].length - 2, from + match[0].length); }
      else mark(from, from + match[0].length, 'cm-md-strike-source');
      mark(from + 2, from + match[0].length - 2, 'cm-md-strike');
    }
    for (const match of text.matchAll(/(?<![\w*])\*([^*\n]+)\*(?!\*)|(?<![\w_])_([^_\n]+)_(?!_)/g)) {
      const from = line.from + (match.index ?? 0);
      const value = match[1] ?? match[2] ?? '';
      if (insideBoldItalic(from, from + match[0].length)) continue;
      if (!cursorNear(from, from + match[0].length)) { hideInlineSyntax(from, from + 1); hideInlineSyntax(from + match[0].length - 1, from + match[0].length); }
      else mark(from, from + match[0].length, 'cm-md-italic-source');
      mark(from + 1, from + 1 + value.length, 'cm-md-italic');
    }
    for (const match of text.matchAll(/`([^`\n]+)`/g)) {
      const from = line.from + (match.index ?? 0);
      if (!cursorNear(from, from + match[0].length)) { hideInlineSyntax(from, from + 1); hideInlineSyntax(from + match[0].length - 1, from + match[0].length); }
      else mark(from, from + match[0].length, 'cm-md-inline-code-source');
      mark(from + 1, from + match[0].length - 1, 'cm-md-inline-code');
    }
    // `[[note]]` links and the inline HTML allow-list, mirroring remarkAsterInline
    // so the two surfaces recognise the same inline syntax.
    for (const match of text.matchAll(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g)) {
      const from = line.from + (match.index ?? 0);
      const to = from + match[0].length;
      if (cursorNear(from, to)) {
        mark(from, to, 'cm-md-wiki-source');
      } else {
        const label = (match[2] ?? match[1]).trim();
        const labelStart = from + match[0].indexOf(label, 2);
        hideInlineSyntax(from, labelStart);
        hideInlineSyntax(labelStart + label.length, to);
        mark(labelStart, labelStart + label.length, 'cm-md-wiki-link');
      }
    }
    for (const match of text.matchAll(/<(mark|kbd|u|sub|sup|s|small|abbr)(\s[^>]*?)?>([\s\S]*?)<\/\1\s*>/gi)) {
      const from = line.from + (match.index ?? 0);
      const to = from + match[0].length;
      const tag = match[1].toLowerCase();
      const openLength = match[0].indexOf('>') + 1;
      const closeLength = match[0].length - match[0].lastIndexOf('</');
      if (cursorNear(from, to)) {
        mark(from, to, 'cm-md-inline-html-source');
      } else {
        hideInlineSyntax(from, from + openLength);
        hideInlineSyntax(to - closeLength, to);
        mark(from + openLength, to - closeLength, `cm-md-inline-html cm-md-inline-html-${tag}`);
      }
    }

    for (const link of collectMarkdownLinks(text)) {
      const from = line.from + link.from;
      const to = line.from + link.to;
      // Clicking the rendered link opens it (the widget swallows the event), so
      // the caret only lands in this range when the user actually navigates
      // there. Revealing on `cursorNear` — like every other inline construct —
      // is what lets the caret walk through the source; keying it to the exact
      // edge positions meant one arrow press re-collapsed the widget and pushed
      // the caret back out, so the source could never be edited.
      if (cursorNear(from, to)) {
        mark(from, to, 'cm-md-link-source');
      } else {
        decorations.push(Decoration.replace({ widget: new MarkdownLinkWidget(link.label, link.url), inclusive: false }).range(from, to));
      }
    }

    for (const match of text.matchAll(/==([^=\n]+)==/g)) {
      const from = line.from + (match.index ?? 0);
      if (!cursorNear(from, from + match[0].length)) {
        hideInlineSyntax(from, from + 2);
        hideInlineSyntax(from + match[0].length - 2, from + match[0].length);
        mark(from + 2, from + match[0].length - 2, 'cm-md-highlight');
      } else {
        mark(from, from + match[0].length, 'cm-md-highlight-source');
      }
    }
    for (const match of text.matchAll(/\[\^([^\]]+)\]/g)) {
      const from = line.from + (match.index ?? 0);
      mark(from, from + match[0].length, cursorNear(from, from + match[0].length) ? 'cm-md-footnote-source' : 'cm-md-footnote-reference');
    }
  }
  return Decoration.set(decorations, true);
}

function createDecorationsField(sourceMode: () => boolean) {
  return StateField.define<ReturnType<typeof Decoration.set>>({
    create: (state) => buildLiveDecorations(state, sourceMode()),
    update: (decorations, transaction: Transaction) => {
      if (transaction.docChanged || transaction.selection || transaction.effects.some((effect) => effect.is(modeChanged) || effect.is(foldEffect) || effect.is(unfoldEffect))) {
        return buildLiveDecorations(transaction.state, sourceMode());
      }
      return decorations.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function unfoldFoldsAtEditedBoundaries(update: { docChanged: boolean; changes: Transaction['changes']; state: EditorState; view: EditorView }) {
  if (!update.docChanged) return;
  const changedRanges: Array<{ from: number; to: number }> = [];
  update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => changedRanges.push({ from: fromB, to: toB }));
  if (!changedRanges.length) return;

  const effects: StateEffect<{ from: number; to: number }>[] = [];
  foldedRanges(update.state).between(0, update.state.doc.length, (from, to) => {
    const touched = changedRanges.some(({ from: changedFrom, to: changedTo }) => (
      Math.max(changedFrom, changedTo) >= from - 1 && changedFrom <= to + 1
    ));
    if (touched) effects.push(unfoldEffect.of({ from, to }));
  });
  if (effects.length) update.view.dispatch({ effects });
}

function clearEditorFolds(view: EditorView) {
  const effects: StateEffect<{ from: number; to: number }>[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  if (effects.length) view.dispatch({ effects });
}

function replaceEditorDocument(view: EditorView, markdown: string) {
  if (markdown === view.state.doc.toString()) return;
  // CodeMirror maps fold decorations across document changes. For a full
  // document replacement those mapped ranges belong to the old document and
  // can hide or restyle headings in the new one, so discard them first.
  clearEditorFolds(view);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: markdown },
    annotations: externalDocumentSync.of(true),
  });
}

/** CodeMirror 6 Markdown editor with Obsidian-like inactive-line syntax hiding. */
export const MarkdownLivePreviewEditor = forwardRef<MarkdownLivePreviewEditorHandle, MarkdownLivePreviewEditorProps>(
  function MarkdownLivePreviewEditor({ markdown, placeholder: emptyPlaceholder, sourceMode = false, sessionId = 0, onChange, onBlur, onOpenWikiLink }, forwardedRef) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const modeRef = useRef(sourceMode);
    const onChangeRef = useRef(onChange);
    const onBlurRef = useRef(onBlur);
    const onOpenWikiLinkRef = useRef(onOpenWikiLink);
    onOpenWikiLinkRef.current = onOpenWikiLink;
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;

    useEffect(() => {
      if (!hostRef.current || viewRef.current) return undefined;
      // Capture the id when this CodeMirror instance is created. Reusing a
      // ref for the latest prop here would let a late transaction from a
      // destroyed editor masquerade as a change from the new editor.
      const createdSessionId = sessionId;
      const decorations = createDecorationsField(() => modeRef.current);
      const state = EditorState.create({
        doc: markdown,
        extensions: [
          basicSetup,
          markdownLanguage({ codeLanguages }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          // Let the heading highlighter override CodeMirror's generic
          // Markdown token styling. In particular, the default highlighter
          // can add an underline to heading tokens after a fold refresh.
          syntaxHighlighting(markdownHeadingHighlight),
          // Registered last so fenced code wins over the generic styling.
          syntaxHighlighting(fenceTokenHighlight),
          codeFolding({
            placeholderDOM: () => {
              const placeholder = document.createElement('span');
              placeholder.className = 'cm-md-fold-placeholder-hidden';
              placeholder.setAttribute('aria-hidden', 'true');
              return placeholder;
            },
          }),
          EditorView.lineWrapping,
          placeholder(emptyPlaceholder),
          decorations,
          keymap.of([...defaultKeymap, ...historyKeymap, ...markdownKeymap, indentWithTab]),
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-document)', fontSize: 'var(--document-font-size)', lineHeight: 'var(--document-line-height)' },
            '.cm-content': { minHeight: '100%', padding: '0 8px 48px' },
            '.cm-line': { padding: '0' },
            '.cm-placeholder': { color: 'var(--muted)', opacity: '0.72' },
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-strong)' },
            '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(82,123,104,.2)' },
            '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
          }),
          EditorView.updateListener.of((update) => {
            unfoldFoldsAtEditedBoundaries(update);
            if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalDocumentSync))) {
              onChangeRef.current(update.state.doc.toString(), {
                previousMarkdown: update.startState.doc.toString(),
                sourceMode: modeRef.current,
                sessionId: createdSessionId,
              });
            }
          }),
          EditorView.domEventHandlers({
            mousedown: (event, view) => {
              const target = event.target as HTMLElement | null;
              if (!target?.closest('.cm-md-image-wrap')) return false;
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position == null) return false;
              view.dispatch({ selection: { anchor: position } });
              view.focus();
              return false;
            },
            click: (event, view) => {
              // Rendered link widgets handle their own click. This branch is
              // for source-mode text and links temporarily exposed at a live
              // editor boundary, where CodeMirror still renders plain text.
              if ((event.target as HTMLElement | null)?.closest('.cm-md-link-widget')) return false;
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position != null && onOpenWikiLinkRef.current && ((event.ctrlKey || event.metaKey) || (event.target as HTMLElement | null)?.closest('.cm-md-wiki-link'))) {
                const line = view.state.doc.lineAt(position);
                const offset = position - line.from;
                const wiki = Array.from(line.text.matchAll(/\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g))
                  .find((match) => offset >= (match.index ?? 0) && offset < (match.index ?? 0) + match[0].length);
                if (wiki) {
                  // Code blocks and inline code are text, not navigation targets.
                  let node = syntaxTree(view.state).resolveInner(position, -1);
                  let opaque = false;
                  for (;;) { if (/Code|Comment/.test(node.name)) opaque = true; if (!node.parent) break; node = node.parent; }
                  if (!opaque) { event.preventDefault(); event.stopPropagation(); onOpenWikiLinkRef.current(wiki[1].trim()); return true; }
                }
              }
              const link = position == null ? null : markdownLinkAt(view.state, position);
              if (!link) return false;
              event.preventDefault();
              event.stopPropagation();
              openMarkdownUrl(link.url);
              return true;
            },
            blur: () => { onBlurRef.current(); return false; },
          }),
        ],
      });
      viewRef.current = new EditorView({ state, parent: hostRef.current });
      return () => { viewRef.current?.destroy(); viewRef.current = null; };
    }, [emptyPlaceholder, sessionId]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view || markdown === view.state.doc.toString()) return;
      replaceEditorDocument(view, markdown);
    }, [markdown]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view || modeRef.current === sourceMode) return;
      modeRef.current = sourceMode;
      // Folding is a live-preview affordance. Clear any ranges when switching
      // surfaces so a fold from one mode/document can never hide source text
      // or leave the next heading with stale layout state.
      const effects: StateEffect<any>[] = [modeChanged.of(sourceMode)];
      foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
        effects.push(unfoldEffect.of({ from, to }));
      });
      view.dispatch({ effects });
    }, [sourceMode]);

    useImperativeHandle(forwardedRef, () => ({
      setMarkdown: (nextMarkdown) => {
        const view = viewRef.current;
        if (!view || nextMarkdown === view.state.doc.toString()) return;
        replaceEditorDocument(view, nextMarkdown);
      },
      focus: () => viewRef.current?.focus(),
      scrollToLine: (lineNumber) => {
        const view = viewRef.current;
        if (!view) return;
        const targetLine = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
        const position = view.state.doc.line(targetLine).from;
        view.dispatch({
          selection: { anchor: position },
          effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 64 }),
        });
        window.requestAnimationFrame(() => {
          const coordinates = view.coordsAtPos(position);
          const container = view.dom.closest<HTMLElement>('.markdown-resource-content');
          if (!coordinates || !container) return;
          const top = container.scrollTop + coordinates.top - container.getBoundingClientRect().top - 56;
          container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        });
        view.focus();
      },
      hasSelection: () => {
        const selection = viewRef.current?.state.selection.main;
        return Boolean(selection && selection.from !== selection.to);
      },
      insertMarkdown: (before, after = '', placeholderText = '') => {
        const view = viewRef.current;
        if (!view) return;
        const selection = view.state.selection.main;
        const selected = view.state.sliceDoc(selection.from, selection.to) || placeholderText;
        const insert = before + selected + after;
        view.dispatch({ changes: { from: selection.from, to: selection.to, insert }, selection: { anchor: selection.from + before.length, head: selection.from + before.length + selected.length } });
        view.focus();
      },
      clearFormatting: () => {
        const view = viewRef.current;
        if (!view) return;
        const selection = view.state.selection.main;
        if (selection.from === selection.to) return;
        const selected = view.state.sliceDoc(selection.from, selection.to);
        const cleared = selected
          .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
          .replace(/(~~|==|`)([\s\S]*?)\1/g, '$2')
          .replace(/(^|\s)(\*|_)(?=\S)(.*?)(?<=\S)\2(?=\s|$)/g, '$1$3');
        view.dispatch({ changes: { from: selection.from, to: selection.to, insert: cleared }, selection: { anchor: selection.from, head: selection.from + cleared.length } });
        view.focus();
      },
    }), []);

    return <div ref={hostRef} className={'markdown-live-codemirror' + (sourceMode ? ' source-mode' : ' live-mode')} aria-label={sourceMode ? 'Markdown 源码编辑器' : 'Markdown 实时预览编辑器'} />;
  },
);
