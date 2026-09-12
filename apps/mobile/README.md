# A4Note PWA

The first mobile prototype focuses on offline note reading and editing. It intentionally excludes AI, PDF rendering, community features, and desktop-only workspace state. It is a responsive PWA so the same shell can be opened in a mobile browser or installed on a phone.

## Run

```powershell
cd apps/mobile
npm install
npm run dev
```

For a production-like check, use `npm run build` and then `npm run preview`. The app includes a web manifest and a small service worker for the shell, while notes are stored in browser `localStorage`.

## Install and responsive behavior

This is a responsive PWA, not a native Expo/React Native package. On Android/Chrome, open the deployed HTTPS URL and choose **Install app** or **Add to home screen**. On iPhone/iPad, open the HTTPS URL in Safari, choose **Share**, then **Add to Home Screen**. `localhost` also works for local installation checks; a plain remote HTTP URL does not.

The layout uses fluid sizing with a compact breakpoint at 1040px. At tablet and phone widths, the desktop rail becomes a compact mobile header and bottom navigation, and safe-area insets are applied for devices with a notch or gesture bar.

## Structure

- `src/App.tsx`: app shell and screen navigation
- `src/models/note.ts`: mobile-safe note and paper summary models
- `src/data/fixtures.ts`: offline starter data
- `src/storage/notesRepository.ts`: local repository contract and browser `localStorage` implementation
- `src/sync/syncProvider.ts`: server sync contract placeholder

The UI depends on `NotesRepository`, not on AsyncStorage directly. Once the server contract is finalized, a sync-enabled repository can be introduced without changing the screens.
