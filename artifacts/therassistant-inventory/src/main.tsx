import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';
// Keep the reference palette last so it consistently overrides the base theme.
import './therassistant-reference-theme.css';
import './clinical-workspace-refresh.css';
// Apply compact Inter typography and responsive fixes after existing theme layers.
import './therassistant-compact-responsive.css';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
