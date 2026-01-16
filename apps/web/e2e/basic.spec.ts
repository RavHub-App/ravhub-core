import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('/');
    // modern projects may use a simple title; accept either of the common titles
    await expect(page).toHaveTitle(/RavHub|web/);
});

test('redirects to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/.*\/login/);
});
