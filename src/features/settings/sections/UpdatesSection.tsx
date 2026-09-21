import { UpdateSettings } from '../UpdateSettings';

export function UpdatesSection({ currentVersion }: { currentVersion?: string }) {
  return <UpdateSettings currentVersion={currentVersion} />;
}
