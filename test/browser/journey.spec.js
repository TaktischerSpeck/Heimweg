import { test, expect } from '@playwright/test';

test('setup, login, mobile master data, planning, stale results and deletion', async ({ page }) => {
  const errors = [];
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
  await page.getByLabel('Betreuer für Test-MTF').selectOption('2');
  await expect(page.getByText('Es fehlen noch 1 Kinderplätze.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Test-PKW verfügbar' }).check();
  await page.getByRole('button', { name: 'Heimfahrten berechnen' }).click();
  await expect(page.getByRole('heading', { name: 'So kommt ihr gut nach Hause.' })).toBeVisible();
  await expect(
    page.getByText('3 Kinder sind vollständig zugeordnet.', { exact: false }),
  ).toBeVisible();
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
  await page.getByRole('button', { name: 'Routen neu berechnen' }).click();
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
  await page.locator('.topbar').getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Schön, dass du da bist.' })).toBeVisible();
  expect(errors).toEqual([]);
});
