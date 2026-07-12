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

  test('对照表行是纯静态，无 highlighted 类', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('.legend-row').first();
    expect(await firstRow.getAttribute('class')).not.toMatch(/highlighted/);
  });

  test('点击"导出合成图"下载 composite PNG', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.export-panel button.primary').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^pingdou-\d+x\d+\.png$/);
  });

  test('多选额外尺寸触发多次下载', async ({ page }) => {
    test.skip(!fs.existsSync(FIXTURE), 'fixture 缺失 — 跳过');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await expect(page.locator('.legend-row').first()).toBeVisible({ timeout: 10000 });

    // Current is 100 (auto-checked, disabled). Pick extras 50 and 200.
    const opt50 = page.locator('.size-option', { hasText: '50' }).locator('input');
    const opt200 = page.locator('.size-option', { hasText: '200' }).locator('input');
    await opt50.check();
    await opt200.check();

    await expect(page.locator('.export-panel button.primary')).toHaveText('导出 3 张图片');

    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));

    await page.locator('.export-panel button.primary').click();
    await page.waitForTimeout(1500);

    expect(downloads).toHaveLength(3);
    downloads.forEach(name => {
      expect(name).toMatch(/^pingdou-\d+x\d+\.png$/);
    });
  });
});