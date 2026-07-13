import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StaticsPage } from './pages/StaticsPage';
import './styles/global.css';

function Root() {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/statics')) {
    return <StaticsPage />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);