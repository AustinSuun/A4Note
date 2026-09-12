import { resolveWikiLink } from '../../core/wikiLinks';
import { listDirectoryEntries } from './projectApi';
export function resolveProjectWikiLink(root: string, from: string, target: string) {
  return resolveWikiLink(root, from, target, listDirectoryEntries);
}
