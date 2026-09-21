import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpCircle, CircleHelp, LibraryBig, Palette, Plug, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import type { AiProviderContribution, ProviderContribution, SceneContribution, SettingContribution } from '../../core/types';
import type { AppDiagnostics, AsterPaths, BackupResult } from '../../platform/nativeApi';
import { zh } from '../../ui/zh';
import { SECTION_META, searchSettings, type SettingsSearchHit } from './catalog';
import { EmptyState, SectionLayout } from './primitives';
import { AboutSection } from './sections/AboutSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { GeneralSection } from './sections/GeneralSection';
import { LibrarySection } from './sections/LibrarySection';
import { PluginsSection } from './sections/PluginsSection';
import { SyncSection } from './sections/SyncSection';
import { UpdatesSection } from './sections/UpdatesSection';
import { normalizeSection, SETTINGS_SECTIONS } from './types';
import type { AppSettings, LocalPluginSummary, PluginMarketSettingsState, PluginSettingValue, PluginSettingValues, Section, SettingsExtensionCounts, SettingsPathKind, SettingsPluginSummary, SyncSettingsState } from './types';
import './settings.css';

export { defaultSettings } from './types';
export type { AppSettings, InterfaceDensity, InterfaceFont, InterfaceFontSize, AppTheme, DocumentFont, CodeFont, DocumentFontSize, DocumentLineHeight, DocumentLayout, MetadataSourcePreference, PluginSettingValue, PluginSettingValues, SettingsPathKind, SettingsExtensionCounts, SettingsPluginSummary, LocalPluginSummary, SyncSettingsState, PluginMarketSettingsState, Section } from './types';

const SECTION_ICONS: Record<Section, typeof SlidersHorizontal> = {
  general: SlidersHorizontal,
  appearance: Palette,
  library: LibraryBig,
  plugins: Plug,
  sync: RefreshCw,
  updates: ArrowUpCircle,
  about: CircleHelp,
};

/* A search hit must land on the real control, not on a copy of its label: walk into
   the anchor and focus the first focusable descendant, making the anchor focusable
   itself when it holds no control at all. */
export function focusSettingsAnchor(id: string): boolean {
  const anchor = document.getElementById(id);
  if (!anchor) return false;
  const nested = anchor.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
  const target = anchor.matches('input, select, textarea, button') ? anchor : nested ?? anchor;
  if (!target.hasAttribute('tabindex') && !/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(target.tagName)) target.setAttribute('tabindex', '-1');
  target.scrollIntoView({ block: 'center' });
  target.focus({ preventScroll: true });
  return true;
}

export type SettingsSceneProps = {
  settings: AppSettings;
  pluginSettings: SettingContribution[];
  pluginSettingValues: PluginSettingValues;
  paths: AsterPaths | null;
  diagnostics: AppDiagnostics | null;
  aiProviders: AiProviderContribution[];
  providers: ProviderContribution[];
  plugins: SettingsPluginSummary[];
  extensionCounts: SettingsExtensionCounts;
  scenes: SceneContribution[];
  enabledSceneIds: string[];
  initialSection?: Section;
  onChange: (settings: AppSettings) => void;
  onToggleScene: (sceneId: string, enabled: boolean) => void;
  onTogglePlugin: (pluginId: string, enabled: boolean) => void;
  onPluginSettingChange: (settingId: string, value: PluginSettingValue) => void;
  onRefreshPaths: () => void | Promise<void>;
  onRevealPath: (kind: SettingsPathKind) => void | Promise<void>;
  onCreateBackup: () => Promise<BackupResult>;
  onRestoreBackup: () => Promise<void>;
  sync: SyncSettingsState;
  onSync: () => void | Promise<void>;
  onSyncLogin: (username: string, password: string) => void | Promise<void>;
  onSyncLogout: () => void | Promise<void>;
  market: PluginMarketSettingsState;
  localPlugins: LocalPluginSummary[];
  onImportPlugin: () => void | Promise<void>;
  onMarketUrlChange: (url: string) => void;
  onRefreshMarket: () => void | Promise<void>;
};

export function SettingsScene(props: SettingsSceneProps) {
  const {
    settings, pluginSettings, pluginSettingValues, paths, diagnostics, aiProviders, providers, plugins, extensionCounts,
    scenes, enabledSceneIds, initialSection, onChange, onToggleScene, onTogglePlugin, onPluginSettingChange,
    onRefreshPaths, onRevealPath, onCreateBackup, onRestoreBackup, sync, onSync, onSyncLogin, onSyncLogout,
    market, localPlugins, onImportPlugin, onMarketUrlChange, onRefreshMarket,
  } = props;
  const [section, setSection] = useState<Section>(() => normalizeSection(initialSection));
  const [query, setQuery] = useState('');
  const [activeResult, setActiveResult] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const navRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  /* Where focus goes after the next section render: the heading for navigation,
     the matched control for a search hit. */
  const pendingFocus = useRef<string | null>('__heading__');

  /* `initialSection` is a controlled request, not just an initial value: the host can
     change it while Settings stays mounted, and an unknown value must not strand the
     user on an empty pane. */
  useEffect(() => {
    setSection(normalizeSection(initialSection));
    pendingFocus.current = '__heading__';
  }, [initialSection]);

  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === '__heading__') headingRef.current?.focus({ preventScroll: true });
    else if (target) focusSettingsAnchor(target);
  }, [section]);

  const hits = useMemo(() => searchSettings(query), [query]);

  /* User-initiated navigation keeps focus on the nav item (so arrow keys keep
     working); external jumps - `initialSection` from the host or a search hit -
     move focus into the content instead. */
  const activate = (next: Section) => {
    if (next === section) return;
    pendingFocus.current = null;
    setSection(next);
  };

  const openHit = (hit: SettingsSearchHit) => {
    setQuery('');
    setActiveResult(0);
    if (hit.section === section) {
      focusSettingsAnchor(hit.id);
      return;
    }
    pendingFocus.current = hit.id;
    setSection(hit.section);
  };

  const onNavKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = SETTINGS_SECTIONS.length - 1;
    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
      else if (event.key === 'Home') next = 0;
      else next = last;
      event.preventDefault();
      navRefs.current[SETTINGS_SECTIONS[next]]?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(SETTINGS_SECTIONS[index]);
    }
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (hits.length === 0) return;
      event.preventDefault();
      setActiveResult((current) => (event.key === 'ArrowDown' ? Math.min(hits.length - 1, current + 1) : Math.max(0, current - 1)));
      return;
    }
    if (event.key === 'Enter') {
      if (hits.length === 0) return;
      event.preventDefault();
      openHit(hits[Math.min(activeResult, hits.length - 1)]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
    }
  };

  const body = section === 'general' ? (
    <GeneralSection settings={settings} onChange={onChange} aiProviders={aiProviders} />
  ) : section === 'appearance' ? (
    <AppearanceSection settings={settings} onChange={onChange} />
  ) : section === 'library' ? (
    <LibrarySection paths={paths} onRefreshPaths={onRefreshPaths} onRevealPath={onRevealPath} onCreateBackup={onCreateBackup} onRestoreBackup={onRestoreBackup} scenes={scenes} enabledSceneIds={enabledSceneIds} onToggleScene={onToggleScene} />
  ) : section === 'plugins' ? (
    <PluginsSection plugins={plugins} pluginSettings={pluginSettings} pluginSettingValues={pluginSettingValues} onTogglePlugin={onTogglePlugin} onPluginSettingChange={onPluginSettingChange} extensionCounts={extensionCounts} market={market} localPlugins={localPlugins} onImportPlugin={onImportPlugin} onMarketUrlChange={onMarketUrlChange} onRefreshMarket={onRefreshMarket} />
  ) : section === 'sync' ? (
    <SyncSection sync={sync} onSync={onSync} onSyncLogin={onSyncLogin} onSyncLogout={onSyncLogout} />
  ) : section === 'updates' ? (
    <UpdatesSection currentVersion={diagnostics?.version} />
  ) : (
    <AboutSection diagnostics={diagnostics} />
  );

  return (
    <section className="scene active settings-scene">
      <header className="topbar compact">
        <div>
          <h1>{zh.settings.title}</h1>
          <p className="scene-description">{zh.settings.subtitle}</p>
        </div>
      </header>
      <div className="settings-layout" data-settings-section={section} data-settings-query={query}>
        <nav className="settings-section-nav" aria-label="设置分类">
          <ul role="list">
            {SETTINGS_SECTIONS.map((id, index) => {
              const Icon = SECTION_ICONS[id];
              const current = section === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    ref={(node) => { navRefs.current[id] = node; }}
                    className={current ? 'active' : ''}
                    aria-current={current ? 'page' : undefined}
                    tabIndex={current ? 0 : -1}
                    onClick={() => activate(id)}
                    onKeyDown={(event) => onNavKeyDown(event, index)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{SECTION_META[id].label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="settings-category-content">
          <div className="settings-search">
            <label className="settings-search-field" htmlFor="settings-search-input">
              <span className="settings-search-label">搜索设置</span>
              <span className="settings-search-control">
                <Search size={14} aria-hidden="true" />
                <input
                  id="settings-search-input"
                  type="search"
                  role="combobox"
                  aria-expanded={query.length > 0}
                  aria-controls="settings-search-results"
                  aria-autocomplete="list"
                  aria-activedescendant={query && hits.length > 0 ? `settings-search-result-${Math.min(activeResult, hits.length - 1)}` : undefined}
                  placeholder="搜索分类、设置项或关键词，例如 字号 / 备份"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setActiveResult(0); }}
                  onKeyDown={onSearchKeyDown}
                />
                {query ? <button type="button" className="settings-search-clear" aria-label="清空搜索" onClick={() => setQuery('')}><X size={13} aria-hidden="true" /></button> : null}
              </span>
            </label>
            {query ? (
              <ul className="settings-search-results" id="settings-search-results" role="listbox" aria-label="搜索结果">
                {hits.length === 0 ? (
                  <li className="settings-search-empty" role="presentation"><EmptyState title="没有匹配的设置" description="试试“字号”“备份”“插件”“更新”等关键词。" /></li>
                ) : hits.map((hit, index) => (
                  <li key={hit.id} role="none">
                    <button
                      type="button"
                      id={`settings-search-result-${index}`}
                      role="option"
                      aria-selected={index === Math.min(activeResult, hits.length - 1)}
                      className={index === Math.min(activeResult, hits.length - 1) ? 'is-active' : ''}
                      onClick={() => openHit(hit)}
                      onMouseEnter={() => setActiveResult(index)}
                    >
                      <span className="settings-search-result-title">{hit.title}</span>
                      <span className="settings-search-result-section">{hit.sectionLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <SectionLayout key={section} id={section} title={SECTION_META[section].label} description={SECTION_META[section].description} headingRef={(node) => { headingRef.current = node; }}>
            {body}
          </SectionLayout>
        </div>
      </div>
    </section>
  );
}
