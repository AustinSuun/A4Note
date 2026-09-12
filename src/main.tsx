import React from 'react';
import ReactDOM from 'react-dom/client';
import 'prismjs';
import App from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { createWorkbenchStorage } from './platform/workbench';
import { configureWorkbenchStorage } from './workbench';
import './ui/styles.css';

/**
 * PWS-1: the workbench snapshot has to be in hand before the first render,
 * because `App` seeds a builtin project whenever it sees an empty workbench.
 * A failed load starts the app on the `localStorage` default instead of
 * blocking startup.
 */
async function bootstrap() {
  document.addEventListener('contextmenu', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
  });
  try {
    const storage = await createWorkbenchStorage();
    if (storage) configureWorkbenchStorage(storage);
  } catch (error) {
    console.warn('工作台状态加载失败，使用浏览器存储启动', error);
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrap();
