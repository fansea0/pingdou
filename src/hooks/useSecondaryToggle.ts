import { useEffect, useState } from 'react';

/**
 * 可以切到主按钮上的次级动作（当前是投稿）。
 *
 * 抽出来而不是各组件各写一份：导出面板（桌面/平板）和底部栏（手机）是同一件事的
 * 两个入口，两处的手感、文案、切换位行为必须一模一样。定义散在两个文件里，
 * 迟早一边改了另一边没跟上。
 */
export interface SecondaryAction {
  /** 切过去之后主按钮显示的文案，必须诚实描述点下去会发生什么 */
  label: string;
  /** 主按钮处在该状态时被点击 → 调它 */
  onSelect: () => void;
  /** 切回主态后主按钮显示的文案。默认「下载」 */
  backLabel?: string;
}

/**
 * 主按钮的两态切换。
 *
 * 切换位**只改状态、不执行动作**。把「切」和「做」混在同一次点击里，用户永远
 * 不知道自己刚才那下到底干了什么 —— 而这两个动作一个是私有的即时下载、一个会
 * 把图交给站主审核，代价根本不对等。
 *
 * @param secondary 没传时退化成单按钮，主态恒为 primary
 */
export function useSecondaryToggle(secondary?: SecondaryAction) {
  const [onSecondary, setOnSecondary] = useState(false);

  // 次级动作被撤掉后还停在它的状态上，主按钮就会显示一个点了没反应的标签
  useEffect(() => {
    if (!secondary && onSecondary) setOnSecondary(false);
  }, [secondary, onSecondary]);

  return {
    onSecondary: onSecondary && !!secondary,
    toggle: () => setOnSecondary((v) => !v),
  };
}
