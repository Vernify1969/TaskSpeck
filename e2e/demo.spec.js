import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PASSWORD = 'demo-help-2026';
const MAYA = 'maya.demo@taskspeck.test';
const SAM = 'sam.demo@taskspeck.test';
const CASEY = 'casey.demo@taskspeck.test';
const SHOTS = '/opt/cursor/artifacts/screenshots/demo';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const HOME = ['Moving help', 'Packing & unpacking', 'Cleaning', 'Gardening', 'Handyman', 'Furniture assembly', 'Pickup & delivery', 'Hard rubbish', 'Painting', 'Other'];

async function settle(page) {
  await page.locator('#toast.show').waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
}

async function login(page, email, password = PASSWORD) {
  await page.goto('/');
  await page.locator('#em').waitFor();
  await page.locator('#em').fill(email);
  await page.locator('#pw').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Fair help, without a booking fee|Tasks near you/ })).toBeVisible({ timeout: 15000 });
  await settle(page);
}

async function passSafety(page) {
  const guide = page.getByRole('button', { name: /Complete the 5-minute safety guide/ });
  if (await guide.count()) {
    await guide.click();
    await page.locator('input[data-in="sgOk"]').check();
    await page.getByRole('button', { name: 'Finish' }).click();
    await settle(page);
  }
}

async function answerQuestions(page) {
  const hours = page.getByRole('button', { name: '1–2 hours', exact: true });
  if (await hours.count()) await hours.click();
  const home = page.getByRole('button', { name: 'Yes, I will be home', exact: true });
  if (await home.count()) await home.click();
  const noButtons = page.getByRole('button', { name: 'No', exact: true });
  const count = await noButtons.count();
  for (let i = 0; i < count; i++) {
    const button = page.getByRole('button', { name: 'No', exact: true }).nth(i);
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  }
  await page.getByRole('button', { name: 'Choose a date' }).click();
  await page.getByRole('button', { name: 'Flexible', exact: true }).click();
}

async function postTask(page, { text, price, stages = false, category = null }) {
  if (category) await page.locator('.home-cats').getByRole('button', { name: category }).click();
  else await page.locator('.post-card').getByRole('button', { name: 'Post a task' }).click();
  await page.locator('#pt').fill(text);
  await page.getByRole('button', { name: 'Fixed price', exact: true }).click();
  await page.locator('#bamt').fill(String(price));
  if (stages) {
    await page.getByRole('button', { name: 'Split the price into two stages' }).click();
    await expect(page.locator('#stage1')).toBeVisible();
    await expect(page.locator('#stage2')).toBeVisible();
  }
  await page.locator('input[data-in="postPhoto"]').setInputFiles({ name: 'job.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.thumbs img').first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await answerQuestions(page);
  await page.getByRole('button', { name: 'Check my task' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Publish task' }).click();
  await expect(page.getByRole('heading', { name: 'Your task is live' })).toBeVisible();
  await settle(page);
}

async function offerOn(page, title, fee) {
  const switcher = page.getByRole('button', { name: 'Tasker', exact: true });
  if (await switcher.count() && await switcher.isVisible()) await switcher.click();
  for (let i = 0; i < 4 && !(await page.locator('#fq').isVisible().catch(() => false)); i++) {
    const back = page.getByRole('button', { name: 'Back', exact: true });
    if (await back.count() && await back.isVisible()) await back.click();
    else break;
  }
  await passSafety(page);
  await page.locator('#fq').fill(title);
  await page.getByRole('button', { name: title }).first().click();
  await page.getByRole('button', { name: 'Make an offer' }).click();
  await page.locator('#fee').fill(String(fee));
  await page.locator('input[data-in="ok"]').check();
  await page.getByRole('button', { name: 'Send offer' }).click();
  await expect(page.getByText('Bid sent')).toBeVisible();
  await settle(page);
}

const widths = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
];

for (const viewport of widths) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('shows demo logins, typical prices, and ten even category tiles', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('#demo-logins')).toContainText('maya.demo@taskspeck.test');
      await expect(page.locator('#demo-logins')).toContainText(PASSWORD);
      await expect(page.locator('#demo-logins')).toContainText('Demo');
      await page.getByRole('button', { name: /Maya Chen/ }).click();
      await expect(page.locator('#em')).toHaveValue(MAYA);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Fair help, without a booking fee.' })).toBeVisible();
      await expect(page.getByText('$500–$950')).toBeVisible();
      await expect(page.getByText('Typical Melbourne examples for 2026')).toBeVisible();
      const view = await page.locator('#view').innerHTML();
      expect(view.indexOf('home-cats')).toBeGreaterThan(-1);
      expect(view.indexOf('home-cats')).toBeLessThan(view.indexOf('How it works'));
      await expect(page.locator('.recent-tasks .card')).toHaveCount(3);
      await expect(page.getByRole('button', { name: 'View all my tasks' })).toBeVisible();
      const tiles = page.locator('.home-cats .cat');
      await expect(tiles).toHaveCount(10);
      const labels = await tiles.allInnerTexts();
      expect(labels.map((text) => text.replace(/\s+/g, ' ').trim())).toEqual(HOME);
      const boxes = await tiles.evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }));
      expect(new Set(boxes.map((b) => b.w)).size).toBe(1);
      expect(new Set(boxes.map((b) => b.h)).size).toBe(1);
      expect(boxes[0].h).toBe(156);
    });

    test('signs up, edits profile, and logs out', async ({ page }) => {
      const email = `new.${viewport.name}.${Date.now()}@taskspeck.test`;
      await page.goto('/');
      await page.getByRole('button', { name: 'Need an account? Sign up' }).click();
      await page.locator('#nm').fill('Taylor Demo');
      await page.locator('#em').fill(email);
      await page.locator('#pw').fill(PASSWORD);
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByRole('heading', { name: 'Fair help, without a booking fee.' })).toBeVisible();
      await page.getByRole('button', { name: 'Profile', exact: true }).click();
      await page.getByRole('button', { name: 'Edit profile' }).click();
      await page.locator('#ps').fill('Carlton');
      await page.locator('#pb').fill('Demo bio from the signup test');
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(page.getByText('Profile saved').or(page.locator('#toast'))).toBeVisible();
      await settle(page);
      await page.getByRole('button', { name: 'Profile', exact: true }).click();
      await page.getByRole('button', { name: 'Log out' }).click();
      await expect(page.locator('#em')).toBeVisible();
      await login(page, email);
      await page.getByRole('button', { name: 'Profile', exact: true }).click();
      await page.getByRole('button', { name: 'Edit profile' }).click();
      await expect(page.locator('#pb')).toHaveValue('Demo bio from the signup test');
    });

    test('opens every home category and blocks licensed work and large painting', async ({ page }) => {
      await login(page, MAYA);
      for (const name of HOME) {
        await page.locator('.home-cats').getByRole('button', { name }).click();
        await expect(page.locator('#pt')).toBeVisible();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(page.locator('.home-cats')).toBeVisible();
      }
      await page.locator('.post-card').getByRole('button', { name: 'Post a task' }).click();
      await page.locator('#pt').fill('Rewire the kitchen power points');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByText(/licensed work/i)).toBeVisible();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.locator('.home-cats').getByRole('button', { name: 'Painting' }).click();
      await page.locator('#pt').fill('Paint two bedrooms, ground floor only');
      await page.getByRole('button', { name: 'Fixed price', exact: true }).click();
      await page.locator('#bamt').fill('12000');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await answerQuestions(page);
      await page.getByRole('button', { name: 'Check my task' }).click();
      await expect(page.getByText(/registered builder/i)).toBeVisible();
    });

    test('posts a task with a photo, a budget, and two payment stages', async ({ page }) => {
      await login(page, MAYA);
      const title = `Pack the spare room ${viewport.name} ${Date.now()}`;
      await postTask(page, { text: `${title}. Pack these items into boxes.`, price: 200, stages: true, category: 'Packing & unpacking' });
    });

    test('browses the list and map, filters, and saves a search', async ({ page }) => {
      await login(page, SAM);
      await page.getByRole('button', { name: 'Tasker', exact: true }).click();
      await passSafety(page);
      await expect(page.getByRole('heading', { name: 'Tasks near you' })).toBeVisible();
      await expect(page.locator('.active-filters')).toHaveCount(0);
      await expect(page.locator('.fbadge')).toHaveCount(0);
      await expect(page.getByText('Assemble a desk and a bookshelf')).toBeVisible();
      await page.getByRole('button', { name: 'Map', exact: true }).click();
      await expect(page.locator('#jobmap')).toBeVisible();
      await page.getByRole('button', { name: 'List', exact: true }).click();
      await expect(page.locator('#fres .card, #fres .map').first()).toBeVisible();
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Any (10 km zone)' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: '2 km', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '5 km', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '10 km', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '25 km', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '50 km', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'General help', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Errands', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Errands & delivery', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Office help', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Pets & plants', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Tech setup', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Pickup & delivery', exact: true })).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Admin & office help', exact: true })).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Pet care', exact: true })).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Tech help', exact: true })).toHaveCount(1);
      await expect(page.locator('.catgrid .fpick')).toHaveCount(14);
      await page.getByRole('button', { name: 'Price low', exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: 'Price low', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Price high', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '5 km', exact: true }).click();
      await page.getByRole('button', { name: 'Gardening', exact: true }).click();
      await page.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Any (10 km zone)' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Gardening', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await page.getByRole('button', { name: 'Gardening', exact: true }).click();
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Remove Gardening filter' })).toBeVisible();
      await expect(page.getByRole('button', { name: /km filter/ })).toHaveCount(0);
      await expect(page.locator('.fbadge')).toHaveText('1');
      await expect(page.getByText('Tidy a small courtyard')).toBeVisible();
      await page.getByRole('button', { name: 'Save this search and alert me' }).click();
      await expect(page.getByText(/Search saved/)).toBeVisible();
      await settle(page);
      await page.getByRole('button', { name: 'Profile', exact: true }).click();
      await page.getByRole('button', { name: /Saved searches/ }).click();
      await expect(page.getByText(/Any wording · Gardening · Any \(10 km zone\)/).first()).toBeVisible();
    });

    test('makes, edits, and withdraws an offer', async ({ page }) => {
      await login(page, SAM);
      await page.getByRole('button', { name: 'Tasker', exact: true }).click();
      await passSafety(page);
      await page.locator('#fq').fill('Collect a parcel');
      await page.getByRole('button', { name: /Collect a parcel/ }).first().click();
      await page.getByRole('button', { name: 'Make an offer' }).click();
      await page.locator('#fee').fill('60');
      await page.locator('input[data-in="ok"]').check();
      await page.getByRole('button', { name: 'Send offer' }).click();
      await expect(page.getByText('Bid sent')).toBeVisible();
      await page.getByRole('button', { name: 'Edit offer' }).click();
      await page.locator('#efee').fill('50');
      await page.getByRole('button', { name: 'Save offer' }).click();
      await settle(page);
      await page.getByRole('button', { name: 'Withdraw offer' }).click();
      await expect(page.getByText(/withdrawn/i).first()).toBeVisible();
    });

    test('accepts an offer, pays in demo, marks the job done, and reviews', async ({ browser }) => {
      test.setTimeout(180000);
      const mayaContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const samContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const maya = await mayaContext.newPage();
      const sam = await samContext.newPage();
      const title = `Carry two lobby boxes ${viewport.name} ${Date.now()}`;
      await login(maya, MAYA);
      await postTask(maya, { text: `${title}. Help carry two boxes from the lobby.`, price: 120, category: 'Moving help' });
      await login(sam, SAM);
      await offerOn(sam, title, 110);
      await maya.reload();
      await expect(maya.getByRole('heading', { name: 'Fair help, without a booking fee.' })).toBeVisible();
      await settle(maya);
      await maya.getByRole('button', { name: title }).click();
      await maya.getByRole('button', { name: /Sam Taylor/ }).first().click();
      await maya.getByRole('button', { name: 'Accept offer' }).click();
      await expect(maya.locator('[data-demo-pay]')).toBeVisible();
      await maya.getByRole('button', { name: /Accept and pay/ }).click();
      await expect(maya.locator('[data-demo-pay]')).toBeVisible();
      if (viewport.width >= 960) await maya.screenshot({ path: path.join(SHOTS, 'pay-desktop.png'), fullPage: true });
      else await maya.screenshot({ path: path.join(SHOTS, 'pay-mobile.png'), fullPage: true });
      await maya.locator('#paybtn').click();
      await expect(maya.getByText(/Payment confirmed/)).toBeVisible({ timeout: 15000 });
      await maya.getByRole('button', { name: /Confirm attendance/ }).click();
      await maya.getByRole('button', { name: /I am on my way/ }).click();
      await maya.getByRole('button', { name: /I have arrived/ }).click();
      const sample = maya.getByRole('button', { name: 'Use a sample photo' });
      if (await sample.count()) await sample.click();
      await maya.getByRole('button', { name: /Mark task complete/ }).click();
      await maya.getByRole('button', { name: 'Confirm completion' }).click();
      await maya.getByRole('button', { name: '5 stars' }).click();
      await maya.locator('textarea[data-in="review"]').fill('Demo review from the click-through test.');
      await maya.getByRole('button', { name: 'Submit review' }).click();
      await expect(maya.getByText(/review has been submitted/i)).toBeVisible();
      await mayaContext.close();
      await samContext.close();
    });

    test('cancels a booking and reports a problem', async ({ browser }) => {
      test.setTimeout(180000);
      const mayaContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const samContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const maya = await mayaContext.newPage();
      const sam = await samContext.newPage();
      const cancelTitle = `Cancel me ${viewport.name} ${Date.now()}`;
      await login(maya, MAYA);
      await postTask(maya, { text: `${cancelTitle}. Help carry one small box.`, price: 80, category: 'Moving help' });
      await login(sam, SAM);
      await offerOn(sam, cancelTitle, 70);
      await maya.reload();
      await expect(maya.getByRole('heading', { name: 'Fair help, without a booking fee.' })).toBeVisible();
      await settle(maya);
      await maya.getByRole('button', { name: cancelTitle }).click();
      await maya.getByRole('button', { name: /Sam Taylor/ }).first().click();
      await maya.getByRole('button', { name: 'Accept offer' }).click();
      await maya.getByRole('button', { name: /Accept and pay/ }).click();
      await maya.locator('#paybtn').click();
      await expect(maya.getByText(/Payment confirmed/)).toBeVisible({ timeout: 15000 });
      await maya.getByRole('button', { name: 'Cancel task' }).click();
      await maya.getByRole('button', { name: 'Changed plans', exact: true }).click();
      await maya.getByRole('button', { name: 'Cancel task' }).last().click();
      await expect(maya.getByText(/Cancelled/)).toBeVisible();

      const disputeTitle = `Dispute me ${viewport.name} ${Date.now()}`;
      await maya.getByRole('button', { name: 'Back', exact: true }).click();
      await postTask(maya, { text: `${disputeTitle}. Help carry one small box.`, price: 90, category: 'Moving help' });
      await offerOn(sam, disputeTitle, 85);
      await maya.reload();
      await expect(maya.getByRole('heading', { name: 'Fair help, without a booking fee.' })).toBeVisible();
      await settle(maya);
      await maya.getByRole('button', { name: disputeTitle }).click();
      await maya.getByRole('button', { name: /Sam Taylor/ }).first().click();
      await maya.getByRole('button', { name: 'Accept offer' }).click();
      await maya.getByRole('button', { name: /Accept and pay/ }).click();
      await maya.locator('#paybtn').click();
      await expect(maya.getByText(/Payment confirmed/)).toBeVisible({ timeout: 15000 });
      await maya.getByRole('button', { name: /Confirm attendance/ }).click();
      await maya.getByRole('button', { name: /I am on my way/ }).click();
      await maya.getByRole('button', { name: /I have arrived/ }).click();
      await maya.getByRole('button', { name: /Mark task complete/ }).click();
      await maya.getByRole('button', { name: 'Report a problem' }).click();
      await maya.getByRole('button', { name: 'Damage', exact: true }).click();
      await maya.getByRole('button', { name: 'Submit report' }).click();
      await expect(maya.getByText(/Problem reported|Damage/)).toBeVisible();
      await mayaContext.close();
      await samContext.close();
    });

    test('opens messages, notifications, a share link, and a CSV', async ({ page }) => {
      await login(page, MAYA);
      await page.getByRole('button', { name: /Notifications/ }).click();
      await expect(page.getByText('In the app, and by email')).toBeVisible();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'Messages', exact: true }).click();
      await page.getByRole('button', { name: /Assemble a desk/ }).click();
      await expect(page.getByText(/Happy to assemble both pieces/)).toBeVisible();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('button', { name: /Job records/ }).click();
      await page.getByRole('button', { name: /Demo apartment/ }).click();
      await page.getByRole('button', { name: 'Create a share link' }).click();
      await expect(page.getByText('Share link')).toBeVisible();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download CSV' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/csv/i);
      if (viewport.width >= 960) await page.screenshot({ path: path.join(SHOTS, 'record-desktop.png'), fullPage: true });
    });

    test('shows coming soon and joins the waitlist outside the zone', async ({ page }) => {
      await login(page, CASEY);
      await expect(page.getByText('Coming soon to your area')).toBeVisible();
      await page.getByRole('button', { name: 'Join the waitlist' }).click();
      await expect(page.getByText(/waitlist/i)).toBeVisible();
    });

    test('switches between requester and tasker', async ({ page }) => {
      await login(page, MAYA);
      await page.getByRole('button', { name: 'Tasker', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Tasks near you' })).toBeVisible();
      await page.getByRole('button', { name: 'Requester', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Fair help, without a booking fee.' })).toBeVisible();
      await page.getByRole('button', { name: 'See all categories' }).click();
      await expect(page.locator('.ttl', { hasText: 'All categories' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Pickup & delivery', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Errands & delivery', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Admin & office help', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Pet care', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tech help', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Other', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Errands', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'General help', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Office help', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Pets & plants', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Tech setup', exact: true })).toHaveCount(0);
      await expect(page.getByText('Events', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Hosting help', { exact: true })).toHaveCount(0);
      await expect(page.locator('#catgrid .cat')).toHaveCount(13);
    });
  });
}
