# Aster UI Redesign Baseline

## Direction

Aster uses a light, quiet, modern workbench language inspired by Paseo, VS Code, and Obsidian. It should feel like one continuous workspace rather than a collection of floating cards.

## Shared Rules

- Keep the main work area dominant.
- Use a persistent information sidebar for navigation and context; do not use an icon-only rail as the primary navigation.
- Prefer spacing, background levels, and typography over strong borders.
- Use small radii and restrained shadows only for floating surfaces, dialogs, and transient panels.
- Keep controls compact, explicit, and keyboard friendly.
- Use neutral surfaces with a restrained accent color. Reserve stronger colors for status and selection.
- Reader and editor surfaces should be quieter than management surfaces.
- Dark mode must reuse the same semantic tokens rather than introducing feature-specific colors.

## Workbench Shape

The shell is:

```text
application sidebar -> project/workspace navigation -> tabbed work area -> optional utility drawer
```

This is implemented. The structural contract (slots, tab kinds, derived `activeScene`) lives in `WORKSPACE_BASELINE.md`; this file only covers visual language.

Rule that still holds: navigation entries must be backed by real state. Do not add a sidebar or tab entry for a capability that has no data model or backend command behind it.

## Current Increment

The shared visual layer is isolated in `src/ui/styles/workbench.css`. It provides:

- a labeled information sidebar (244px, 208px under 1180px) with project and workspace rows;
- a lightweight A4Note brand entry;
- a 42px top bar with pill actions and no explanatory body text;
- a single-row tab strip with pin, close and drag-to-reorder affordances;
- a file tree panel and file preview tab;
- an agent session panel built from a facts list rather than cards;
- lower-contrast surfaces and shadows;
- a continuous settings list rendered as an overlay instead of a card grid;
- shared light-theme tokens ready for a dark theme.

Row-level controls (`.workbench-icon-button`, `.workbench-tab-close`) stay at `opacity: 0` and appear on hover, active or pinned state. Keep new row controls on that pattern so idle rows stay quiet.

Page-level primitives (`.scene`, `.topbar`, `.eyebrow`, `.error-boundary-*`) stay in `src/ui/styles/layout.css`. Feature scenes keep their own stylesheets; `workbench.css` does not reach inside them beyond the shared rhythm block at the end of the file.

Removed and not to be reintroduced:

```text
.app-shell / .scene-rail / .scene-buttons / .scene-utility-buttons
.scene-button* / .scene-brand* / .workspace / .scene-host
.scene-frame* / .settings-frame
```

## Next UI Work

1. Dark theme using the same semantic tokens.
2. Optional right utility drawer, reusing `WorkspaceLayout.rightDrawerVisible`.
3. Rework each feature scene to fit inside a tab rather than a full page, beginning with Agent chat once the CLI runtime lands.
4. Reader surface polish under `READER_UI_REDESIGN.md`, adjusted for the workbench shell.
5. Repair and verify all localized UI strings before visual sign-off.
