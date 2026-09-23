export function annotationReferenceToken(annotationId: string) {
  const id = annotationId.trim();
  if (!id || /[\s()]/.test(id)) return '';
  return `@annotation(${id})`;
}

export function annotationCitationInsert(annotationId: string) {
  const token = annotationReferenceToken(annotationId);
  return token ? `\n\n${token}\n` : '';
}

/** Visible chip shared by the reader note toolbar and rendered citation links. */
export function annotationCitationLabel(typeLabel: string, pageLabel: string) {
  return `${typeLabel} · ${pageLabel}`;
}
