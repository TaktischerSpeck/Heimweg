import { test, expect } from '@playwright/test';

for (const autoLoad of [false, true]) {
  test(`external map background ${autoLoad ? 'loads automatically' : 'waits for a click'}`, async ({ page }) => {
    const requests = [];
    await page.route('https://tile.openstreetmap.org/**', async route => {
      requests.push(route.request().url());
      await route.fulfill({ contentType: 'image/png', body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4x8AAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto('/');
    await expect(page.getByLabel('Benutzername', { exact: true })).toBeVisible();
    await page.evaluate(async autoLoad => {
      const maps = await import('/route-map.js');
      maps.resetRouteMaps({ logout: true });
      const root = document.createElement('main');
      const host = document.createElement('div');
      host.dataset.routeMap = '0';
      root.append(host);
      document.body.replaceChildren(root);
      maps.mountRouteMaps({ root,
        plan: { revision: 'synthetic', includeReturn: false,
          station: { lat: 49.8, lon: 8.7, address: 'Synthetic station' } },
        variant: { routes: [{ vehicle: { id: 'synthetic-vehicle', name: 'Synthetic vehicle' },
          stops: [{ id: 'synthetic-stop', lat: 49.81, lon: 8.71,
            name: 'Synthetic stop', address: 'Synthetic address' }] }] },
        stale: false,
        tiles: { external: true, autoLoad, origin: 'https://tile.openstreetmap.org',
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors' },
        api: async () => ({ geometry: { type: 'LineString', coordinates: [[8.7, 49.8], [8.71, 49.81]] } }),
      });
    }, autoLoad);
    await expect(page.locator('.map-route-line')).toHaveCount(1);
    if (autoLoad) {
      await expect.poll(() => requests.length).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: 'Kartenhintergrund laden', exact: true })).toHaveCount(0);
      await expect(page.locator('.route-map-provider-notice')).toContainText('automatisch geladen');
    } else {
      expect(requests).toHaveLength(0);
      await page.getByRole('button', { name: 'Kartenhintergrund laden', exact: true }).click();
      await expect.poll(() => requests.length).toBeGreaterThan(0);
    }
  });
}
