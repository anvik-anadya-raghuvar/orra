import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionGlobalConfig } from 'framer-motion';
import App from './App';
import './styles/theme.css';
import './styles/alive.css';
import './styles/viz.css';

/**
 * Set BEFORE the first render, not in an effect: mount animations are queued
 * during that first render, so a flag flipped afterwards arrives too late.
 *
 * A hidden tab throttles requestAnimationFrame to nothing. Entrance animations
 * reveal content from opacity 0, so without this they never run and the page
 * paints blank. Skipping animations resolves every one instantly, which means
 * the final state is always what the user sees.
 */
MotionGlobalConfig.skipAnimations = document.visibilityState !== 'visible';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
