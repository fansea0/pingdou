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

  test('上传后右侧色号对照表显示', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });
  });

  test('hover 对照表行时该行加 highlighted 类', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('.legend-row').first();
    await firstRow.hover();
    await expect(firstRow).toHaveClass(/highlighted/);
  });

  test('点击"导出合成图"下载 composite PNG', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.export-panel button.primary').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^pingdou-\d+x\d+-composite\.png$/);
  });
});