import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StaticsPage } from './pages/StaticsPage';
import { matchRoute } from './router';
import './styles/global.css';

function Root() {
  const route = matchRoute(window.location.pathname);
  if (route.name === 'statics') return <StaticsPage />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);