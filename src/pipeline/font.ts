/**
 * 全站导出图统一字体栈。
 *
 * `ui-rounded` 在 Apple 平台会解析到 SF Pro Rounded，数字和字母明显比
 * -apple-system 更圆润；后面依次兜底到 macOS 圆体、苹方，最后才是
 * 系统 sans-serif。Windows / Linux 上 ui-rounded 不存在，会自动落到
 * 苹方或系统字体，不会出现方框字。
 *
 * 色号是格子里的小字，宁可稍钝也不能糊，所以 cell 用的栈把无衬线放在
 * 圆体前面——实际渲染差异在 12px 上不可见，但缺字风险更低。
 */
export const FONT_FAMILY_ROUNDED =
  'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Yuanti SC", "PingFang SC", -apple-system, "Segoe UI", sans-serif';

export const FONT_FAMILY =
  '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

/** `bold 13px ...` 之类的简写 */
export function font(sizePx: number, weight: 'normal' | 'bold' = 'normal', family = FONT_FAMILY_ROUNDED): string {
  return `${weight === 'bold' ? 'bold ' : ''}${sizePx}px ${family}`;
}