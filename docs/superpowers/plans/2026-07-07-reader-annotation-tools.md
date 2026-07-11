# Reader Annotation Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add text box, freehand ink, eraser, rectangle, and arrow annotation tools while improving annotation icon size and color selection.

**Architecture:** Extend the existing `Annotation` model by adding new annotation types that store geometry in `positionJson`. Keep `eraser` as a transient `ReaderTool` only, so it deletes existing annotations but is never persisted as an annotation type. Reuse the current PDF overlay and annotation persistence flow.

**Tech Stack:** React, TypeScript, PDF.js, Tauri, existing Node verification scripts.

---

### Task 1: Verification Coverage

**Files:**
- Modify: `scripts/verify-reader-rendering.mjs`
- Modify: `scripts/verify-ui-state.mjs`

- [ ] Add assertions that `ReaderTool` includes `eraser` and annotation types include `text`, `ink`, `rect`, and `arrow`.
- [ ] Add assertions that toolbar icon CSS uses larger SVG dimensions without changing button width/height.
- [ ] Add assertions that selected annotation color changes render a palette instead of calling `nextAnnotationColor`.
- [ ] Add assertions that PDF reader implements text, ink, rectangle, arrow, and eraser code paths.
- [ ] Run `npm run test:reader` and `npm run test:ui-state`; both must fail before production changes.

### Task 2: Types And Toolbar

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/features/reader/readerConstants.ts`
- Modify: `src/features/reader/ReaderIcons.tsx`
- Modify: `src/features/reader/ReaderToolbar.tsx`
- Modify: `src/ui/App.tsx`

- [ ] Extend `AnnotationType` with `text | ink | rect | arrow`.
- [ ] Extend `ReaderTool` with `eraser`.
- [ ] Add toolbar entries and icons for text box, pen, eraser, rectangle, and arrow.
- [ ] Keep toolbar button dimensions stable; only enlarge SVGs.
- [ ] Add keyboard mappings for the new tools where they do not conflict with command palette shortcuts.

### Task 3: PDF Interaction And Rendering

**Files:**
- Modify: `src/features/reader/pdf/PdfReader.tsx`
- Modify: `src/features/reader/pdf/AnnotationOverlay.tsx`
- Modify: `src/features/reader/pdf/AnnotationMark.tsx`
- Modify: `src/features/reader/pdf/pdfAnnotationHelpers.ts`
- Modify: `src/ui/styles/reader.css`

- [ ] Implement `text` creation by clicking a page and opening the existing text edit popover as a visible text annotation.
- [ ] Implement `ink` by recording drag points in `positionJson.points`.
- [ ] Implement `rect` by drag-creating a rectangular outline.
- [ ] Implement `arrow` by drag-creating a line with arrow head.
- [ ] Implement `eraser` by clicking an existing annotation to delete it.
- [ ] Render `text`, `ink`, `rect`, and `arrow` annotations in the existing overlay.

### Task 4: Color Selection And Icon Size

**Files:**
- Modify: `src/features/reader/pdf/AnnotationMark.tsx`
- Modify: `src/ui/styles/reader.css`

- [ ] Replace selected annotation color cycling with an inline color palette.
- [ ] Keep custom colors renderable through existing color helpers.
- [ ] Increase selection popup icons and toolbar icons while keeping outer button boxes unchanged.

### Task 5: Verification And Packaging

**Commands:**
- `npm run test:reader`
- `npm run test:ui-state`
- `npm run test:architecture`
- `npm run build`
- `npm run verify`
- `npm run tauri:build`

- [ ] Confirm all commands exit with code 0.
- [ ] Confirm `src-tauri/target/release/aster.exe` is rebuilt.
