import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
});

const urgentWarningCases = [
  ['hamstring-strain-exercises', ['same-day sports-medicine or orthopedic assessment', 'new neurologic symptoms', 'Stop the current exercise for a new pop or tearing sensation', 'Seek emergency assessment', 'coughing blood', 'whole-leg swelling']],
  ['peroneal-tendinopathy-exercises', ['same-day urgent assessment', 'a wound with spreading redness', 'tendon displacement']],
  ['tibialis-posterior-tendinopathy-exercises', ['same-day urgent assessment', 'especially with diabetes or reduced sensation', 'new arch collapse']],
  ['thumb-cmc-osteoarthritis-exercises', ['same-day care', 'Remove a brace immediately', 'after the brace is removed']],
  ['de-quervain-tenosynovitis-exercises', ['same-day care', 'an open wound', 'major loss of motion after trauma']],
  ['lateral-elbow-tendinopathy-exercises', ['same-day urgent care', 'a sudden pop with bruising or deformity', 'marked or progressive weakness']],
  ['medial-elbow-tendinopathy-exercises', ['same-day urgent care', 'a sudden pop with bruising or deformity', 'acute throwing-related instability']],
  ['achilles-tendinopathy-exercises', ['same-day urgent assessment', 'calf warmth or swelling', 'perform a heel raise']],
  ['rotator-cuff-pain-exercises', ['same-day urgent assessment', 'rapidly progressive weakness', 'new or worsening numbness']],
  ['adhesive-capsulitis-exercises', ['same-day urgent assessment', 'new or worsening numbness', 'rapidly progressive weakness']],
  ['knee-osteoarthritis-exercises', ['same-day urgent assessment', 'rapid deformity', 'one-sided calf swelling']],
  ['knee-osteoarthritis-advanced-exercises', ['same-day urgent assessment', 'rapid deformity', 'one-sided calf swelling']],
  ['patellofemoral-pain-exercises', ['same-day urgent assessment', 'loss of knee extension', 'rapidly worsening pain']],
  ['gluteal-tendinopathy-exercises', ['same-day urgent assessment', 'pronounced hip drop or limp', 'new neurologic symptoms']],
  ['lateral-ankle-sprain-exercises', ['immediate emergency evaluation', 'same-day urgent assessment', 'posterior edge or tip of either ankle bone', 'fifth metatarsal or navicular']],
  ['patellar-tendinopathy-exercises', ['same-day urgent assessment', 'one-sided calf swelling', 'a locked knee', 'with or without fever']],
  ['low-back-pain-exercises', ['Call 911', 'severe abdominal or chest pain', 'emergency care for new loss of bladder or bowel control', 'same-day urgent assessment', 'immunosuppressed or uses injected drugs']],
  ['hip-osteoarthritis-exercises', ['same-day urgent assessment', 'visible deformity after trauma', 'one-sided leg swelling']],
  ['plantar-fasciitis-exercises', ['Call 911', 'coughing blood', 'Seek emergency care now', 'same-day urgent assessment', 'especially with diabetes', 'inability to bear weight after trauma']],
  ['meniscus-tear-rehabilitation-exercises', ['same-day urgent assessment', 'a newly locked knee', 'with or without fever', 'one-sided calf swelling']],
  ['advanced-meniscus-rehabilitation-exercises', ['same-day urgent assessment', 'a newly locked knee', 'with or without fever', 'one-sided calf swelling']],
  ['iliotibial-band-syndrome-exercises', ['same-day urgent assessment after major trauma', 'inability to bear weight', 'with or without fever']],
  ['ankle-sprain-return-to-sport-exercises', ['immediate emergency evaluation', 'same-day urgent assessment', 'one-sided calf swelling']],
  ['patellofemoral-pain-return-to-running-exercises', ['same-day urgent assessment', 'kneecap dislocation', 'true locking or inability to straighten the knee', 'with or without fever']],
  ['achilles-tendinopathy-return-to-sport-exercises', ['same-day urgent assessment', 'loss of push-off', 'one-sided calf warmth or swelling']],
];

for (const [slug, instructions] of urgentWarningCases) {
  test(`${slug} preserves urgent actions in static, guided, and printed warnings`, async ({ page }) => {
    await page.goto(`/${slug}/`);
    const staticWarning = page.locator('#response .symptom-red');
    await expect(staticWarning).toBeVisible();
    await page.locator('#guided-session .hep-session-safety summary').click();
    const guidedWarning = page.locator('#guided-session .hep-session-rules section').filter({ hasText: 'Red light' });
    await expect(guidedWarning).toBeVisible();
    for (const instruction of instructions) {
      await expect(staticWarning).toContainText(instruction);
      await expect(guidedWarning).toContainText(instruction);
    }
    await page.emulateMedia({ media: 'print' });
    await expect(staticWarning).toBeVisible();
    for (const instruction of instructions) await expect(staticWarning).toContainText(instruction);
  });
}

test('orthobiologics overview explicitly directs same-day post-injection assessment', async ({ page }) => {
  await page.goto('/orthobiologics/');
  const warning = page.locator('.note-panel').filter({ hasText: 'Autologous does not mean risk-free.' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Seek same-day urgent medical assessment');
  await expect(warning).toContainText('Do not wait for a routine reply.');
});

for (const media of ['screen', 'print']) {
  test(`ankle emergency urgency is preserved in the ${media} stop box`, async ({ page }) => {
    await page.goto('/ankle-sprain-return-to-sport-exercises/');
    await page.emulateMedia({ media });
    const stopBox = page.locator('#response .symptom-red');
    await expect(stopBox).toBeVisible();
    await expect(stopBox).toContainText('Seek immediate emergency evaluation for a newly cold, pale, blue, or numb foot.');
    await expect(stopBox).toContainText('Seek same-day urgent assessment');
    await expect(stopBox).toContainText('a new pop with weakness or loss of push-off');
    await expect(stopBox).toContainText('severe or rapidly increasing swelling');
    await expect(stopBox).toContainText('Arrange prompt reassessment for new sharp pain or repeated giving way');
    await expect(stopBox).not.toContainText('Arrange prompt assessment rather than pushing through.');
  });
}

test('patellar video guidance matches the stage-dependent starting prescription', async ({ page }) => {
  await page.goto('/patellar-tendinopathy-exercises/');
  const program = page.locator('#program');
  const video = page.locator('#video');
  for (const section of [program, video]) {
    await expect(section).toContainText('Begin with the isometric on higher-irritability days or two slow-strength movements on nonconsecutive loading days.');
    await expect(section).toContainText('Once slow strength begins, use the isometric on alternate or recovery days, or as a brief warm-up only when it reliably helps.');
  }
  await expect(video).not.toContainText('Start with the isometric and only two slow-strength movements.');
  await expect(video).toContainText('Never improvise a Spanish-squat anchor');
  await expect(video).toContainText('at least 48 hours between early high-load sessions');
});

test('pre-injection warning distinguishes same-day symptoms from diagnostic review', async ({ page }) => {
  await page.goto('/knee-osteoarthritis-injection-comparison/');
  const warning = page.locator('#candidacy .urgent-panel');
  await expect(warning).toBeVisible();
  const paragraphs = warning.locator('p');
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.first()).toContainText('Seek same-day urgent medical assessment');
  await expect(paragraphs.first()).toContainText('with or without fever');
  await expect(paragraphs.first()).toContainText('new inability to bear weight');
  await expect(paragraphs.first()).toContainText('Do not wait for an elective injection appointment.');
  await expect(paragraphs.last()).toContainText('major diagnostic uncertainty also requires evaluation before choosing an elective injection');
  await expect(paragraphs.last()).not.toContainText('emergency');
});

test('knee OA overview accurately counts the beginner exercise options', async ({ page }) => {
  await page.goto('/knee-osteoarthritis/');
  await expect(page.getByText('Four strength movements plus walking or cycling, with a next-morning symptom rule.', { exact: true })).toBeVisible();
  await expect(page.getByText('Five practical movements plus walking or cycling', { exact: false })).toHaveCount(0);
  await page.goto('/knee-osteoarthritis-exercises/');
  await expect(page.locator('#program .exercise-item')).toHaveCount(5);
  await expect(page.locator('#program .exercise-item').last()).toContainText(/walking|cycling/i);
});

test('hamstring video preserves the written plan and exclusions', async ({ page }) => {
  await page.goto('/hamstring-strain-exercises/');
  const video = page.locator('#video');
  await expect(video.locator('[data-video-resource]')).toHaveAttribute('data-video-id', '7D50I7sdlXg');
  await expect(video).toContainText("Follow this page's more conservative pain rules, readiness checks, and exercise doses");
  await expect(video).toContainText('use video examples as alternatives rather than extra volume');
  await expect(video).toContainText('tendon avulsion');
  await expect(video).toContainText('postoperative rehabilitation');
  await expect(video).toContainText('Sprinting and high-speed sport work should be pain-free.');
});

for (const media of ['screen', 'print']) {
  test(`Achilles athlete recovery and progression rules agree in ${media}`, async ({ page }) => {
    await page.goto('/achilles-tendinopathy-return-to-sport-exercises/');
    await page.emulateMedia({ media });
    const response = page.locator('#response');
    await expect(response.locator('.symptom-green')).toBeVisible();
    await expect(response.locator('.symptom-green')).toContainText('next-morning pain, stiffness, and function remain at the usual baseline');
    await expect(response.locator('.symptom-green')).toContainText('delayed 24- to 72-hour response');
    await expect(response.locator('.symptom-yellow')).toContainText('Do not increase the next exposure.');
    await expect(response.locator('.symptom-yellow')).toContainText('Progress only once symptoms and function have returned to the usual baseline.');
    await expect(response).not.toContainText('recover toward the usual baseline');
  });
}
