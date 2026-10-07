import { expect, test, type Page } from '@playwright/test';
const callback = '#access_token=synthetic-invite&refresh_token=synthetic-refresh&type=invite&expires_in=3600';
const email = 'invited@example.test';
async function mockAuth(page: Page, patient: boolean, lookupFails = false) {
  const writes: string[] = [];
  await page.route('http://127.0.0.1:54399/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PUT') writes.push(path);
    if (path === '/auth/v1/user') return route.fulfill({ json: { id: 'synthetic-user', email } });
    if (path.endsWith('/get_my_client_portal_context')) return route.fulfill({
      status: lookupFails ? 503 : 200,
      json: lookupFails ? { message: 'Temporarily unavailable' } : patient ? { status: 'invited', invited_email: email } : null,
    });
    if (request.method() !== 'GET') writes.push(path);
    return route.fulfill({ json: [] });
  });
  return writes;
}
for (const path of ['/', '/patient-portal/activate']) {
  test(`staff invitation sets password without requiring a patient record at ${path}`, async ({ page }) => {
    const writes = await mockAuth(page, false);
    await page.goto(path + callback);
    await expect(page.getByRole('heading', { name: 'Activate EHR account' })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('Synthetic-password-123!');
    await page.getByLabel('Confirm password', { exact: true }).fill('Synthetic-password-123!');
    await page.getByRole('button', { name: 'Activate EHR account' }).click();
    await expect(page.getByRole('heading', { name: 'Account access not configured' })).toBeVisible();
    expect(writes).toEqual(['/auth/v1/user']);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  });
}
test('patient invitation still requires patient activation', async ({ page }) => {
  await mockAuth(page, true);
  await page.goto('/' + callback);
  await expect(page.getByRole('heading', { name: 'Activate patient portal' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Activate EHR account' })).toHaveCount(0);
});
test('failed invitation lookup does not classify a patient as staff', async ({ page }) => {
  await mockAuth(page, false, true);
  await page.goto('/' + callback);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
});
