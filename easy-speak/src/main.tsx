import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './learning.css';
import './voices.css';
import './training.css';
import { loadInitialSettings } from './lib/speechSettings';

const allowLocalMiniMax = import.meta.env.MODE !== 'android';

void loadInitialSettings(allowLocalMiniMax).then((initialSettings) =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App initialSettings={initialSettings} allowLocalMiniMax={allowLocalMiniMax} />
    </React.StrictMode>,
  ),
);
