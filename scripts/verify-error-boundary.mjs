import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile('src/main.tsx', 'utf8');
const boundarySource = await readFile('src/ui/ErrorBoundary.tsx', 'utf8');
const styles = await readFile('src/ui/styles.css', 'utf8');

assert.match(mainSource, /<ErrorBoundary>/);
assert.match(boundarySource, /static getDerivedStateFromError/);
assert.match(boundarySource, /componentDidCatch/);
assert.match(boundarySource, /window\.location\.reload/);
assert.match(boundarySource, /navigator\.clipboard\.writeText/);
assert.match(styles, /\.error-boundary-shell/);

console.log('Error boundary verification passed');
