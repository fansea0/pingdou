import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StaticsPage } from './pages/StaticsPage';
import { WorksListPage } from './pages/WorksListPage';
import { matchRoute } from './router';
import './styles/global.css';

function Root() {
  const route = matchRoute(window.location.pathname);
  if (route.name === 'works-list') return <WorksListPage />;
  if (route.name === 'statics') return <StaticsPage />;
  // work-detail 分支留给 Task 8（WorkDetailPage）。在那之前 /works/42 会落到这里
  // 渲染首页：URL 与页面不一致，是已知的临时状态，不是本任务要修的。
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);