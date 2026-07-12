import { useEffect, useRef } from 'react';

/**
 * 百度广告联盟广告位容器
 *
 * 用法：
 *   <AdSlot slotId="你的推广位ID" width={728} height={90} position="header" />
 *
 * 工作流程：
 * 1. 在百度联盟后台创建广告位 → 获得 slotId
 * 2. 把 slotId 配置到环境变量 VITE_BAIDU_AD_SLOT_HEADER 等
 * 3. 百度 SDK 全局脚本通过 index.html 中的 <script> 注入
 * 4. SDK 扫描页面中的 .ad-slot[data-ad-slot-id] 元素并填充
 *
 * 安全设计：
 * - slotId 缺失 → 显示 "广告位" 占位（不报错）
 * - 浏览器禁用广告 → 占位区显示但 JS SDK 不会填充（百度会填充公益内容）
 * - React 18 StrictMode 双渲染不会重复填充（百度 SDK 内部幂等）
 */
export type AdPosition = 'header' | 'sidebar' | 'footer';

export interface AdSlotProps {
  /** 百度联盟推广位 ID；缺失或空时显示占位 */
  slotId?: string;
  /** 广告位宽度（像素） */
  width: number;
  /** 广告位高度（像素） */
  height: number;
  /** 位置标识（用于 CSS 类名 + data 属性） */
  position: AdPosition;
  /** 调试标签（默认 "广告"） */
  label?: string;
}

declare global {
  interface Window {
    _bdAdConfig?: unknown;
    BAIDU_CLB_addSlot?: (id: string) => void;
    BAIDU_CLB_fillSlot?: (id: string) => void;
    BAIDU_CLB_preloadSlots?: (ids: string[]) => void;
  }
}

export function AdSlot({ slotId, width, height, position, label = '广告' }: AdSlotProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!slotId) return;
    // 百度联盟 SDK 通过 window.BAIDU_CLB_fillSlot 或 window._bdAdConfig 填充
    // 这里做轻量级注册：标记 slot ID 等待 SDK 扫描
    if (typeof window === 'undefined') return;

    // 标记此 slot 已注册；SDK 通过查询 DOM 中 .ad-slot[data-ad-slot-id] 自动填充
    if (ref.current) {
      ref.current.setAttribute('data-ad-slot-id', slotId);
      ref.current.setAttribute('data-ad-position', position);
    }

    // 若 SDK 已加载，触发刷新（不破坏首次渲染的 placeholder）
    const fillSlot = window.BAIDU_CLB_fillSlot;
    if (typeof fillSlot === 'function' && slotId) {
      try {
        fillSlot(slotId);
      } catch {
        // 静默失败
      }
    }
  }, [slotId, position]);

  return (
    <div
      ref={ref}
      className={`ad-slot ad-slot-${position}`}
      style={{ width, height }}
      data-ad-position={position}
      aria-label={label}
    >
      {!slotId && <span className="ad-slot-placeholder">{label}</span>}
    </div>
  );
}