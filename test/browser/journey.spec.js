import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('setup, login, mobile master data, planning, stale results and deletion', async ({ page }) => {
  const errors = [], tileRequests = [];
  await page.route('https://tile.openstreetmap.org/**', async route => {
    tileRequests.push(route.request().url());
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4x8AAAAASUVORK5CYII=', 'base64'),
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Einrichtungstoken').fill('synthetic-browser-setup-token-000000');
  await page.getByLabel('Benutzername', { exact: true }).fill('testadmin');
  await page.getByLabel('Passwort', { exact: true }).fill('synthetic-browser-password-123');
  await page.getByLabel('Passwort wiederholen').fill('synthetic-browser-password-123');
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByRole('heading', { name: 'Schön, dass du da bist.' })).toBeVisible();
  await page.getByLabel('Benutzername', { exact: true }).fill('testadmin');
  await page.getByLabel('Passwort', { exact: true }).fill('synthetic-browser-password-123');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Heute sicher nach Hause.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Heimfahrten berechnen' })).toBeDisabled();
  await page.getByRole('button', { name: 'Standort', exact: true }).click();
  await page.getByRole('button', { name: 'Standort festlegen' }).click();
  await page
    .getByRole('dialog')
    .locator('[name=address]')
    .fill('Synthetic Test Road 10, Test Town');
  await page.getByRole('button', { name: 'Adresse suchen' }).click();
  await page
    .getByRole('button', { name: 'Synthetic Test Road 10, Test Town', exact: true })
    .click();
  await page.getByRole('checkbox', { name: /Ich habe Adresse/ }).check();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Kinder', exact: true }).click();
  for (const name of ['Testkind Alpha', 'Testkind Beta', 'Testkind Gamma']) {
    await page.getByRole('button', { name: '+ Kind anlegen', exact: true }).click();
    await page.getByLabel('Name des Kindes').fill(name);
    await page
      .getByRole('dialog')
      .locator('[name=address]')
      .fill('Synthetic Test Road 10, Test Town');
    await page.getByRole('dialog').locator('[name=lat]').fill('49.8');
    await page.getByRole('dialog').locator('[name=lon]').fill('8.7');
    await page.getByRole('checkbox', { name: /Ich habe Adresse/ }).check();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.getByRole('button', { name: 'Fahrzeuge', exact: true }).click();
  for (const [name, seats] of [
    ['Test-MTF', '4'],
    ['Test-PKW', '3'],
  ]) {
    await page.getByRole('button', { name: '+ Fahrzeug anlegen', exact: true }).click();
    await page.getByLabel('Fahrzeugbezeichnung').fill(name);
    await page.getByLabel('Gesamtzahl der Sitzplätze').fill(seats);
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.getByRole('button', { name: 'Tagesplanung', exact: true }).click();
  await page.getByRole('checkbox', { name: /Testkind Alpha/ }).check();
  await page.getByRole('checkbox', { name: /Testkind Beta/ }).check();
  await page.getByRole('checkbox', { name: /Testkind Gamma/ }).check();
  await page.getByRole('checkbox', { name: 'Test-MTF verfügbar' }).check();
  const secondSupervisor = page.getByRole('button', { name: 'Zweiter Betreuer für Test-MTF', exact: true });
  await expect(secondSupervisor).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.vehicle-visual svg')).toHaveCount(2);
  await secondSupervisor.click();
  await expect(secondSupervisor).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.vehicle-card').filter({ hasText: 'Test-MTF' })).toContainText('2 Kinderplätze');
  await secondSupervisor.press('Space');
  await expect(secondSupervisor).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.vehicle-card').filter({ hasText: 'Test-MTF' })).toContainText('3 Kinderplätze');
  await secondSupervisor.press('Space');
  await expect(secondSupervisor).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Es fehlen noch 1 Kinderplätze.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Test-PKW verfügbar' }).check();
  await page.getByRole('button', { name: 'Heimfahrten berechnen' }).click();
  await expect(page.getByRole('heading', { name: 'So kommt ihr gut nach Hause.' })).toBeVisible();
  await expect(
    page.getByText('3 Kinder sind vollständig zugeordnet.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.route-map-canvas')).toHaveCount(2);
  await expect(page.locator('.map-route-line')).toHaveCount(2);
  await expect(page.locator('.map-stop-marker')).toHaveCount(3);
  await expect(page.locator('.map-station-marker')).toHaveCount(2);
  expect(tileRequests).toHaveLength(0);
  const lineBeforeZoom = await page.locator('.map-route-line').first().getAttribute('points');
  await page.getByRole('button', { name: 'Karte vergrößern', exact: true }).first().click();
  expect(await page.locator('.map-route-line').first().getAttribute('points')).not.toBe(lineBeforeZoom);
  await page.getByRole('button', { name: 'Gesamte Route anzeigen', exact: true }).first().click();
  await page.getByRole('button', { name: 'Kartenhintergrund laden', exact: true }).first().click();
  await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
  await expect(page.locator('.route-map-consent:visible')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/planning-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/planning-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('checkbox', { name: /Testkind Beta/ }).uncheck();
  await expect(page.getByText('Diese Routen sind veraltet.', { exact: false })).toBeVisible();
  await page.getByText('Optionen für diese Heimfahrt').click();
  await page.getByRole('checkbox', { name: 'Rückfahrt zur Feuerwehr separat anzeigen' }).check();
  await page.route('**/api/route-map', route => route.fulfill({
    status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic routing unavailable.' }),
  }));
  await page.getByRole('button', { name: 'Routen neu berechnen' }).click();
  await expect(page.locator('.route-map-error')).toHaveCount(1);
  await expect(page.locator('.stop-list')).toHaveCount(1);
  await page.unroute('**/api/route-map');
  await page.getByRole('button', { name: 'Karte erneut laden', exact: true }).first().click();
  await expect(page.locator('.map-return-line')).toHaveCount(1);
  await expect(
    page.getByText('2 Kinder sind vollständig zugeordnet.', { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('0 ausgewählt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kinder', exact: true }).click();
  page.on('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('article')
    .filter({ hasText: 'Testkind Beta' })
    .getByRole('button', { name: 'Löschen' })
    .click();
  await expect(page.getByText('Testkind Beta', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'CSV importieren', exact: true }).click();
  await page
    .getByLabel('CSV-Datei')
    .setInputFiles({
      name: 'synthetic-children.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name;address\nSynthetic CSV Child;Synthetic CSV Street 10'),
    });
  await page.getByRole('button', { name: 'Vorschau laden' }).click();
  await expect(page.getByText('1 neu · 0 Änderungen · 1 Adressen noch zu prüfen')).toBeVisible();
  await page.getByRole('checkbox', { name: /Ich habe die Vorschau/ }).check();
  await page.getByRole('button', { name: 'Import bestätigen', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Synthetic CSV Child' })).toContainText(
    'Adresse noch prüfen',
  );
  const childDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren', exact: true }).click();
  expect(await readFile(await (await childDownload).path(), 'utf8')).toContain(
    'Synthetic CSV Child',
  );
  await page.getByRole('button', { name: 'Tagesplanung', exact: true }).click();
  await page.getByRole('checkbox', { name: /Synthetic CSV Child/ }).check();
  await expect(
    page.getByText(/Mindestens eine ausgewählte Kinderadresse ist noch zu prüfen/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fahrzeuge', exact: true }).click();
  await page.getByRole('button', { name: 'CSV importieren', exact: true }).click();
  await page
    .getByLabel('CSV-Datei')
    .setInputFiles({
      name: 'synthetic-vehicles.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name;seats\nSynthetic CSV Vehicle;9'),
    });
  await page.getByRole('button', { name: 'Vorschau laden' }).click();
  await page.getByRole('checkbox', { name: /Ich habe die Vorschau/ }).check();
  await page.getByRole('button', { name: 'Import bestätigen', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('article').filter({ hasText: 'Synthetic CSV Vehicle' }),
  ).toContainText('9 Sitzplätze');
  const vehicleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren', exact: true }).click();
  expect(await readFile(await (await vehicleDownload).path(), 'utf8')).toContain(
    'Synthetic CSV Vehicle',
  );
  await page.getByRole('button', { name: 'Benutzer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Benutzer', exact: true })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'testadmin (du)' }).getByRole('button', { name: 'Sperren', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '+ Benutzer anlegen', exact: true }).click();
  await page.getByLabel('Benutzername', { exact: true }).fill('testcoach');
  await page.getByLabel('Neues Passwort', { exact: true }).fill('synthetic-coach-password-123');
  await page.getByLabel('Passwort wiederholen', { exact: true }).fill('synthetic-coach-password-123');
  await page.getByRole('button', { name: 'Benutzer erstellen', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const coach = page.getByRole('article').filter({ hasText: 'testcoach' });
  await expect(coach).toContainText('Benutzer · Aktiv');
  await coach.getByRole('button', { name: 'Sperren', exact: true }).click();
  await expect(coach).toContainText('Gesperrt');
  await coach.getByRole('button', { name: 'Entsperren', exact: true }).click();
  await expect(coach).toContainText('Aktiv');
  await coach.getByRole('button', { name: 'Passwort zurücksetzen', exact: true }).click();
  await page.getByLabel('Neues Passwort', { exact: true }).fill('synthetic-coach-new-password-123');
  await page.getByLabel('Passwort wiederholen', { exact: true }).fill('synthetic-coach-new-password-123');
  await page.getByRole('button', { name: 'Passwort speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.topbar').getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Schön, dass du da bist.' })).toBeVisible();
  await expect(page.locator('.route-map-canvas')).toHaveCount(0);
  await page.getByLabel('Benutzername', { exact: true }).fill('testcoach');
  await page.getByLabel('Passwort', { exact: true }).fill('synthetic-coach-new-password-123');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Heute sicher nach Hause.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Benutzer', exact: true })).toHaveCount(0);
  await page.locator('.topbar').getByRole('button', { name: 'Abmelden' }).click();
  expect(errors).toEqual([]);
});
