import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

/* The three platform branches of `open_path_in_file_manager` / `open_file_with_default_app`
   are `#[cfg]`-gated, so a broken format string in the two that are not this machine's
   would compile here and fail on someone else's. P2-1 moved them out of `lib.rs`. */
const tauriSource = readFileSync('src-tauri/src/app_paths.rs', 'utf8');
if ((tauriSource.match(/format!\("Failed to open path: \{error\}"\)/g) ?? []).length < 3) {
  throw new Error('Cross-platform path opening errors must use valid Rust format strings.');
}
const tauriMainSource = readFileSync('src-tauri/src/main.rs', 'utf8');
if (!tauriMainSource.includes('#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]')) {
  throw new Error('Windows release builds must not open a console window.');
}

const isWindows = process.platform === 'win32';
const steps = [
  ['node', ['scripts/verify-file-tree-display-name.mjs']],
  ['node', ['scripts/verify-markdown-end-space.mjs']],
  ['node', ['scripts/verify-annotation-history.mjs']],
  ['node', ['scripts/verify-reader-priority-fixes.mjs']],
  ['node', ['scripts/verify-task-binding-guide.mjs']],
  ...(isWindows ? [['node', ['scripts/prepare-native-host.mjs', '--debug']]] : []),
  ['npm', ['run', 'build']],
  ['npm', ['run', 'test:dev-live']],
  ['npm', ['run', 'test:dev-admission']],
  ['npm', ['run', 'test:core']],
  ['npm', ['run', 'test:shortcuts']],
  ['npm', ['run', 'test:project-tasks']],
  ['npm', ['run', 'test:capture']],
  ['npm', ['run', 'test:extension-updates']],
  ['npm', ['run', 'test:capture-native']],
  ['npm', ['run', 'test:capture-native-registration']],
  ...(isWindows ? [['npm', ['run', 'test:capture-native-process']]] : []),
  ['npm', ['run', 'test:sync']],
  ['npm', ['run', 'test:workspace']],
  ['node', ['scripts/verify-folder-config-v2.mjs']],
  ['npm', ['run', 'test:resources']],
  ['npm', ['run', 'test:resource-openers']],
  ['npm', ['run', 'test:resource-views']],
  ['npm', ['run', 'test:agent-protocol']],
  ['npm', ['run', 'test:pdfjs']],
  ['npm', ['run', 'test:reader']],
  ['npm', ['run', 'test:markdown-safety']],
  ['npm', ['run', 'test:reader-helpers']],
  ['npm', ['run', 'test:pdf-rotated-text']],
  ['npm', ['run', 'test:pdf-crosspage-selection']],
  ['npm', ['run', 'test:annotation-layers']],
  ['npm', ['run', 'test:pdf-selection-preview']],
  ['npm', ['run', 'test:pdf-text-layer-offset']],
  ['npm', ['run', 'test:pdf-text-layer-offset-browser']],
  ['npm', ['run', 'test:pdf-eraser-precision']],
  ['npm', ['run', 'test:pdf-text-annotation']],
  ['npm', ['run', 'test:ai-toolbar']],
  ['npm', ['run', 'test:ui-state']],
  ['npm', ['run', 'test:note-workbench']],
  ['npm', ['run', 'test:settings-ui']],
  ['node', ['scripts/verify-brand-update.mjs']],

  ['npm', ['run', 'test:architecture']],
  ['npm', ['run', 'test:scene-plugins']],
  ['npm', ['run', 'test:plugin-bindings']],
  ['npm', ['run', 'test:declarative-plugin-runtime']],
  ['npm', ['run', 'test:library-export']],
  ['npm', ['run', 'test:library-behavior']],
  ['npm', ['run', 'test:library-summary']],
  ['node', ['scripts/verify-summary-provision.mjs']],
  ['npm', ['run', 'test:startup-safety']],
  ['npm', ['run', 'test:reliability']],
  ['npm', ['run', 'test:error-boundary']],
  ['npm', ['run', 'test:agent-status']],
  ['npm', ['run', 'test:plugin-security']],
  ['cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml']],
];

const failures = [];
for (const [command, args] of steps) {
  const printable = [command, ...args].join(' ');
  console.log(`\n==> ${printable}`);
  try { await run(command, args); }
  catch (error) {
    failures.push(printable);
    console.error(`Verification step failed: ${printable}`, error);
  }
}

if (failures.length) throw new Error(`Verification failed (${failures.length} steps):\n${failures.join('\n')}`);
console.log('\nA4Note verification passed');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const childCommand = isWindows ? 'cmd.exe' : command;
    const childArgs = isWindows ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args;
    const child = spawn(childCommand, childArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}
