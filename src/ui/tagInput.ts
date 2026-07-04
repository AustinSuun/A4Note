export const FALLBACK_TAG = '未分类';

export function normalizeEditableTags(tags: string[]) {
  const cleaned = uniqueTags(
    tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .filter((tag) => tag !== FALLBACK_TAG),
  );
  return cleaned.length ? cleaned : [FALLBACK_TAG];
}

export function addTag(tags: string[], input: string) {
  const next = input.trim();
  if (!next) return normalizeEditableTags(tags);
  return normalizeEditableTags([...tags.filter((tag) => tag !== FALLBACK_TAG), next]);
}

export function removeTag(tags: string[], target: string) {
  return normalizeEditableTags(tags.filter((tag) => tag !== target));
}

export function getTagSuggestions(allTags: string[], selectedTags: string[], keyword: string) {
  const needle = keyword.trim().toLowerCase();
  const selected = new Set(selectedTags.map((tag) => tag.toLowerCase()));
  return uniqueTags(allTags)
    .filter((tag) => tag !== FALLBACK_TAG)
    .filter((tag) => !selected.has(tag.toLowerCase()))
    .filter((tag) => (needle ? tag.toLowerCase().includes(needle) : true))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}
