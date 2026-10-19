import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './learning.css';
import './voices.css';
import './training.css';
import { loadInitialSettings } from './lib/speechSettings';

void loadInitialSettings().then((initialSettings) =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App initialSettings={initialSettings} />
    </React.StrictMode>,
  ),
);
