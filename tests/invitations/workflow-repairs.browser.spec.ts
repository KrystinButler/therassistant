import { expect, test, type Page } from '@playwright/test';
async function staff(page: Page) {
  await page.addInitScript(() => localStorage.setItem('therassistant.auth.session.v1', JSON.stringify({access_token:'synthetic',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'synthetic-user',email:'staff@example.test'}})));
  await page.route('http://127.0.0.1:54399/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/user') ? {id:'synthetic-user',email:'staff@example.test'} : path.endsWith('/tenant_users') ? [{tenant_id:'synthetic-tenant',status:'active'}] : path.endsWith('/tenants') ? [{id:'synthetic-tenant',name:'Synthetic Practice',timezone:'America/Denver',settings:{}}] : path.endsWith('/tenant_user_roles') ? [{role:'practice_admin'}] : path.endsWith('/get_my_client_portal_context') ? null : [];
    return route.fulfill({json:data});
  });
}
test('organization setup stays reachable after membership exists and follows requested order', async ({page}) => {
  await staff(page); await page.goto('/organization-setup');
  await expect(page.getByRole('heading',{name:'Set up your practice'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Practice setup steps'}).getByRole('button')).toHaveText(['1. Add Users','2. Providers','3. Practice Configuration','4. Credentialing','5. Add Patient']);
});
test('practice forms open in named drawers', async ({page}) => {
  await staff(page); await page.goto('/administration/practices');
  await expect(page.getByLabel('Practice Entity / Legal Name')).toHaveCount(0);
  await page.getByRole('button',{name:'Practice Entity',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Practice Entity / Legal Name')).toBeVisible();
});
test('participation HTML fallback shows a service error without crashing the page', async ({page}) => {
  await staff(page); await page.route('**/api/v1/payers',route => route.fulfill({contentType:'text/html',body:'<!doctype html><html>SPA fallback</html>'}));
  await page.goto('/credentialing/participation');
  await expect(page.getByRole('heading',{name:'Verify Participation',exact:true})).toBeVisible();
  await expect(page.getByText(/verification service is not connected/)).toBeVisible();
  await expect(page.getByText('Something went wrong',{exact:true})).toHaveCount(0);
});
