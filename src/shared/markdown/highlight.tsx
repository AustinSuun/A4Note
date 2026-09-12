import { LanguageDescription, type Language } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import { Fragment, type ReactNode } from 'react';

/**
 * Static syntax highlighting for fenced code, reusing the CodeMirror language
 * set the editor already ships. No separate highlighter dependency, and the
 * live editor and the rendered document therefore agree on tokenisation.
 *
 * `classHighlighter` emits `tok-*` class names (`tok-keyword`, `tok-string`),
 * styled in `src/ui/styles/markdown.css`, so the palette stays in CSS and
 * follows the theme instead of being baked into inline colours.
 */
const loadedLanguages = new Map<string, Language | null>();

/** Resolves a fence info string (`ts`, `python`, `sh`) to a known language. */
export function describeFenceLanguage(alias: string) {
  const name = alias.trim().toLowerCase();
  if (!name) return null;
  return LanguageDescription.matchLanguageName(languages, name, true);
}

/**
 * Loads a language on demand. Each language is a separate dynamic import, so a
 * document only pays for the languages it actually uses. Failures resolve to
 * `null`, which keeps the code block readable as plain text.
 */
export async function loadFenceLanguage(alias: string): Promise<Language | null> {
  const description = describeFenceLanguage(alias);
  if (!description) return null;
  const cached = loadedLanguages.get(description.name);
  if (cached !== undefined) return cached;
  try {
    const support = await description.load();
    loadedLanguages.set(description.name, support.language);
    return support.language;
  } catch {
    loadedLanguages.set(description.name, null);
    return null;
  }
}

/** Tokenises `code` into spans carrying `tok-*` classes. */
export function highlightFence(code: string, language: Language): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  highlightCode(
    code,
    language.parser.parse(code),
    classHighlighter,
    (text, classes) => {
      nodes.push(classes ? <span key={`t${key++}`} className={classes}>{text}</span> : <Fragment key={`p${key++}`}>{text}</Fragment>);
    },
    () => nodes.push(<Fragment key={`b${key++}`}>{'\n'}</Fragment>),
  );
  return nodes;
}
