import { useEffect, useRef, useState } from 'react';

/** 主按钮可以执行的一个动作 */
export interface ActionChoice {
  /** 显示在按钮上的文案，必须诚实描述点下去会发生什么 */
  label: string;
  /** 点主按钮 → 调它 */
  onSelect: () => void;
}

/**
 * 「主按钮 + 小箭头下拉菜单」：按钮显示当前选中的动作，箭头负责换动作。
 *
 * 抽出来而不是各组件各写一份：导出面板（桌面/平板）和底部栏（手机）是同一件事的
 * 两个入口，两处的菜单形态、点外面关、切完即关必须一模一样。定义散在两个文件里，
 * 迟早一边改了另一边没跟上。
 *
 * 菜单项多于两个时也成立 —— 以后要加「分享」「保存配方」只是往 alternatives 里
 * 多塞一个，不用改这两个组件里的任何一行。
 */
export function useActionMenu(primary: ActionChoice, alternatives: ActionChoice[] = []) {
  const all = [primary, ...alternatives];
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点菜单外面关掉。mousedown 而不是 click：click 在用户先点外面、
  // 再点开菜单时会误判成同一次交互，把刚开的面板又关掉。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return {
    ref,
    current: all[Math.min(index, all.length - 1)],
    items: all,
    open,
    toggleMenu: () => setOpen(v => !v),
    closeMenu: () => setOpen(false),
    /** 选中即关：选完还挂着菜单，用户会以为没点上 */
    pick: (i: number) => {
      setIndex(i);
      setOpen(false);
    },
  };
}
