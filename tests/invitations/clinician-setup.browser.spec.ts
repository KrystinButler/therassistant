import { expect, test } from '@playwright/test';
test('administrator explicitly assigns the rendering provider to an active clinician', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('therassistant.auth.session.v1', JSON.stringify({access_token:'synthetic',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'admin-user',email:'admin@example.test'}})));
  let linked = false;
  await page.route('http://127.0.0.1:54399/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/admin_link_clinician_provider')) {
      expect(route.request().postDataJSON()).toEqual({p_tenant_id:'test-tenant',p_user_id:'clinician-user',p_provider_id:'provider-one'});
      linked=true; return route.fulfill({json:{linked:true}});
    }
    const data = path.endsWith('/user') ? {id:'admin-user',email:'admin@example.test'} : path.endsWith('/tenant_users') ? [{tenant_id:'test-tenant',status:'active'}] : path.endsWith('/tenants') ? [{id:'test-tenant',name:'Test Practice',timezone:'America/Denver'}] : path.endsWith('/tenant_user_roles') ? [{role:'practice_admin'}] : path.endsWith('/list_tenant_users_admin') ? [{user_id:'clinician-user',tenant_user_id:'membership',display_name:'Test Clinician',email:'login@example.test',status:'active',roles:['clinician']}] : path.endsWith('/providers') ? [{id:'provider-one',first_name:'Test',last_name:'Clinician',provider_status:'active',email:'different@example.test'}] : path.endsWith('/provider_user_links') ? (linked ? [{id:'link-one',user_id:'clinician-user',provider_id:'provider-one',status:'active'}] : []) : path.endsWith('/get_my_client_portal_context') ? null : [];
    return route.fulfill({json:data});
  });
  await page.goto('/administration/users');
  await page.getByLabel('Rendering provider for Test Clinician').selectOption('provider-one');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Link Provider',exact:true}).click();
  await expect(page.getByText('Provider linked for Test Clinician.')).toBeVisible();
  expect(linked).toBe(true);
});
