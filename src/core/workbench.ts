import type { ReaderSidePanelTab, SceneId, WorkbenchArea, WorkbenchPanelContribution, WorkbenchPanelId } from './types';

type ReaderWorkbenchPanelId = Extract<WorkbenchPanelId, 'reader.notes' | 'reader.annotations' | 'reader.chat' | 'reader.relations'>;

export const readerPanelIdByTab: Record<ReaderSidePanelTab, WorkbenchPanelId> = {
  notes: 'reader.notes',
  annotations: 'reader.annotations',
  chat: 'reader.chat',
  relations: 'reader.relations',
};

export const readerPanelTabById: Record<ReaderWorkbenchPanelId, ReaderSidePanelTab> = {
  'reader.notes': 'notes',
  'reader.annotations': 'annotations',
  'reader.chat': 'chat',
  'reader.relations': 'relations',
};

export const builtinWorkbenchPanels: WorkbenchPanelContribution[] = [
  {
    id: 'library.details',
    sceneId: 'library',
    area: 'right',
    commandId: 'library.panel.details',
    titleKey: 'library.details',
    icon: 'details',
    order: 10,
    source: 'core',
    context: 'paper',
  },
  {
    id: 'reader.notes',
    sceneId: 'reader',
    area: 'right',
    commandId: 'reader.panel.notes',
    titleKey: 'reader.panelNotes',
    icon: 'notes',
    order: 10,
    source: 'core',
    context: 'paper',
  },
  {
    id: 'reader.annotations',
    sceneId: 'reader',
    area: 'right',
    commandId: 'reader.panel.annotations',
    titleKey: 'reader.panelAnnotations',
    icon: 'annotations',
    order: 20,
    source: 'core',
    context: 'paper',
  },
  {
    id: 'reader.chat',
    sceneId: 'reader',
    area: 'right',
    commandId: 'reader.panel.chat',
    titleKey: 'reader.panelChat',
    icon: 'chat',
    order: 30,
    source: 'core',
    context: 'paper',
  },
  {
    id: 'reader.relations',
    sceneId: 'reader',
    area: 'right',
    commandId: 'reader.panel.relations',
    titleKey: 'reader.panelRelations',
    icon: 'relations',
    order: 40,
    source: 'core',
    context: 'paper',
  },
];

export function getWorkbenchPanelsForScene(sceneId: SceneId, area?: WorkbenchArea) {
  return builtinWorkbenchPanels
    .filter((panel) => panel.sceneId === sceneId && (!area || panel.area === area))
    .sort((left, right) => left.order - right.order);
}

export function readerPanelIdFromTab(tab: ReaderSidePanelTab): WorkbenchPanelId {
  return readerPanelIdByTab[tab];
}

export function readerPanelTabFromId(panelId: WorkbenchPanelId): ReaderSidePanelTab | null {
  return panelId in readerPanelTabById ? readerPanelTabById[panelId as keyof typeof readerPanelTabById] : null;
}

export function isReaderPanelTab(value: unknown): value is ReaderSidePanelTab {
  return typeof value === 'string' && value in readerPanelIdByTab;
}
