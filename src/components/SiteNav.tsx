import './SiteNav.css';

interface SiteNavProps {
  /** 当前路径，用于高亮。只做前缀匹配，/works/42 也算在作品库上。 */
  current: string;
}

const ITEMS = [
  { href: '/', label: '生成图纸', match: (p: string) => p === '/' || p === '' },
  { href: '/works', label: '作品库', match: (p: string) => p === '/works' || p.startsWith('/works/') },
] as const;

export function SiteNav({ current }: SiteNavProps) {
  return (
    <nav className="site-nav" aria-label="主导航">
      {ITEMS.map(item => {
        const active = item.match(current);
        return (
          <a
            key={item.href}
            href={item.href}
            className={active ? 'site-nav-link site-nav-link--active' : 'site-nav-link'}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
