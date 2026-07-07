import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { addTag, FALLBACK_TAG, getTagSuggestions, normalizeEditableTags, removeTag } from '../../ui/tagInput';

export function TagInput({
  value,
  suggestions,
  placeholder,
  onChange,
}: {
  value: string[];
  suggestions: string[];
  placeholder: string;
  onChange: (tags: string[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const normalizedValue = useMemo(() => normalizeEditableTags(value), [value]);
  const suggestionItems = useMemo(() => getTagSuggestions(suggestions, normalizedValue, input), [suggestions, normalizedValue, input]);
  const realTags = normalizedValue.filter((tag) => tag !== FALLBACK_TAG);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [input, suggestionItems.length]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const commitTag = (raw: string) => {
    const next = addTag(normalizedValue, raw);
    onChange(next);
    setInput('');
    setOpen(false);
    setHighlightedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!suggestionItems.length) return;
      setOpen(true);
      setHighlightedIndex((current) => (current + 1) % suggestionItems.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!suggestionItems.length) return;
      setOpen(true);
      setHighlightedIndex((current) => (current - 1 + suggestionItems.length) % suggestionItems.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (open && suggestionItems[highlightedIndex]) {
        commitTag(suggestionItems[highlightedIndex]);
        return;
      }
      if (input.trim()) {
        commitTag(input);
      }
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Backspace' && !input && realTags.length) {
      onChange(removeTag(normalizedValue, realTags[realTags.length - 1]));
    }
  };

  return (
    <div className="tag-input" ref={rootRef}>
      <div className="tag-input-shell" onClick={() => inputRef.current?.focus()}>
        {normalizedValue.map((tag) => (
          <span className={tag === FALLBACK_TAG ? 'tag-chip muted' : 'tag-chip'} key={tag}>
            <span>{tag}</span>
            {tag !== FALLBACK_TAG && (
              <button type="button" className="tag-remove" onClick={() => onChange(removeTag(normalizedValue, tag))} aria-label={`删除标签 ${tag}`}>
                x
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
      </div>
      {open && suggestionItems.length > 0 && (
        <div className="tag-suggestions">
          {suggestionItems.map((tag, index) => (
            <button
              key={tag}
              type="button"
              className={index === highlightedIndex ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
