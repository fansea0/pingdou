import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const FIXTURE = path.resolve('tests/fixtures/sample.png');

test.describe('拼豆图生成器 - 主流程', () => {
  test('页面加载并显示标题', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '拼豆图生成器' })).toBeVisible();
  });

  test('上传图片后预览出现', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '拼豆图生成器' })).toBeVisible();

    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('canvas.preview')).toBeVisible({ timeout: 10000 });
  });
});
