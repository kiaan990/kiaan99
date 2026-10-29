#!/usr/bin/env node
/**
 * Brightspace sync for Kiaan Cloud.
 *
 * Signs in to Bentley's Brightspace through Microsoft, then reads courses,
 * assignment due dates (with submission status) and grades from the
 * Brightspace API using the signed-in browser session.
 *
 * Runs inside a Claude automation every 3 hours. The automation talks to this
 * script through files in a working folder, and relays the Microsoft
 * Authenticator step to Kiaan through the kiaan-cloud activity log.
 *
 * Usage:
 *   node brightspace-sync.cjs run   <dir>                 sign in + scrape
 *   node brightspace-sync.cjs wait  <dir> <secs> <phase>  block until status.phase != <phase> (or timeout), print status
 *   node brightspace-sync.cjs pause <secs>                just wait (for polling loops)
 *
 * Files in <dir>:
 *   state.json    saved browser session (read at start if present, rewritten at the end)
 *   status.json   {phase, message, number?, at}  phase: starting|signing_in|approve|need_code|scraping|done|error
 *   code.txt      write the 6-digit Authenticator code here when phase is need_code
 *   results.json  {syncedAt, courses, assignments, grades} when phase is done
 *
 * Needs env vars BRIGHTSPACE_USER (e.g. jsmith1, or a full email) and BRIGHTSPACE_PASS.
 * Optional: BRIGHTSPACE_EMAIL_DOMAIN (default @bentley.edu), BRIGHTSPACE_BASE_URL.
 * Playwright must be resolvable (e.g. NODE_PATH=$(npm root -g)).
 */
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BRIGHTSPACE_BASE_URL || "https://brightspace.bentley.edu";
const [, , mode, ...args] = process.argv;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

async function main() {
  if (mode === "pause") { await sleep(Math.min(Number(args[0]) || 10, 300) * 1000); return; }
  if (mode === "wait") return waitMode(args[0], Number(args[1]) || 240, args[2] || "");
  if (mode === "run") return runMode(args[0]);
  console.error("usage: brightspace-sync.cjs run|wait|pause ...");
  process.exit(2);
}

async function waitMode(dir, secs, phase) {
  const f = path.join(dir, "status.json");
  const end = Date.now() + Math.min(secs, 590) * 1000;
  let s = readJson(f);
  while (Date.now() < end) {
    s = readJson(f);
    if (s && s.phase !== phase) break;
    await sleep(1000);
  }
  console.log(JSON.stringify(s || { phase: "unknown" }));
}

async function runMode(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const statusFile = path.join(dir, "status.json");
  const codeFile = path.join(dir, "code.txt");
  const stateFile = path.join(dir, "state.json");
  const setStatus = (phase, message, extra = {}) =>
    fs.writeFileSync(statusFile, JSON.stringify({ phase, message, ...extra, at: new Date().toISOString() }));

  setStatus("starting", "Starting browser");
  const user = process.env.BRIGHTSPACE_USER, pass = process.env.BRIGHTSPACE_PASS;
  if (!user || !pass) {
    setStatus("error", "Missing login: add BRIGHTSPACE_USER and BRIGHTSPACE_PASS to the cloud environment's settings.");
    return;
  }
  const email = user.includes("@") ? user : user + (process.env.BRIGHTSPACE_EMAIL_DOMAIN || "@bentley.edu");

  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch { setStatus("error", "Playwright is not installed in this environment."); return; }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const saved = readJson(stateFile);
  const context = await browser.newContext({
    storageState: saved && saved.cookies ? saved : undefined,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();

  try {
    setStatus("signing_in", "Opening Brightspace");
    await page.goto(`${BASE}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await signIn(page, { email, pass, setStatus, codeFile });

    setStatus("scraping", "Signed in, reading courses");
    const results = await scrape(page);
    fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(results));
    await context.storageState({ path: stateFile });
    setStatus("done", `Read ${results.courses.length} courses, ${results.assignments.length} assignments, ${results.grades.length} grades`);
  } catch (err) {
    // Keep whatever session we have, so a retry may skip the Authenticator step.
    try { await context.storageState({ path: stateFile }); } catch {}
    setStatus("error", String(err && err.message ? err.message : err).slice(0, 300));
  } finally {
    await browser.close();
  }
}

const visible = async (page, sel) => {
  try { return await page.locator(sel).first().isVisible({ timeout: 200 }); } catch { return false; }
};

async function signIn(page, { email, pass, setStatus, codeFile }) {
  const deadline = Date.now() + 7 * 60 * 1000; // allow time for the Authenticator step
  let filledEmail = false, filledPass = 0, triedOtherWay = false, sentCode = "";
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.startsWith(BASE) && !/\/d2l\/login/.test(url) && (await page.locator("d2l-navigation, .d2l-navigation-s, #d2l_body").count()) > 0) return;

    // Error messages Microsoft shows on the form
    for (const sel of ["#usernameError", "#passwordError", "#idTD_Error"]) {
      if (await visible(page, sel)) {
        const t = (await page.locator(sel).first().innerText()).trim();
        if (t) throw new Error("Microsoft said: " + t);
      }
    }

    if (await visible(page, 'input[name="loginfmt"]') && !filledEmail) {
      await page.fill('input[name="loginfmt"]', email);
      await page.click("#idSIButton9");
      filledEmail = true; setStatus("signing_in", "Entered email");
      await sleep(2500); continue;
    }
    if (await visible(page, 'input[name="passwd"]')) {
      if (filledPass >= 2) throw new Error("The password was not accepted.");
      await page.fill('input[name="passwd"]', pass);
      await page.click("#idSIButton9");
      filledPass++; setStatus("signing_in", "Entered password");
      await sleep(3000); continue;
    }
    // Method picker: prefer typing a code from the Authenticator app
    if (await visible(page, '[data-value="PhoneAppOTP"]')) {
      await page.click('[data-value="PhoneAppOTP"]'); await sleep(2500); continue;
    }
    // Code entry
    if (await visible(page, 'input[name="otc"]')) {
      let code = "";
      try { code = fs.readFileSync(codeFile, "utf8").trim(); } catch {}
      if (/^\d{6,8}$/.test(code) && code !== sentCode) {
        sentCode = code;
        try { fs.unlinkSync(codeFile); } catch {}
        await page.fill('input[name="otc"]', code);
        await page.click('#idSubmit_SAOTCC_Continue, input[type="submit"]');
        setStatus("signing_in", "Checking the code");
        await sleep(4000); continue;
      }
      setStatus("need_code", sentCode ? "That code didn't work. Send a fresh one." : "Microsoft wants the code from your Authenticator app.");
      await sleep(1500); continue;
    }
    // Push approval with number matching
    if (await visible(page, "#idRichContext_DisplaySign")) {
      const num = (await page.locator("#idRichContext_DisplaySign").innerText()).trim();
      if (!triedOtherWay && await visible(page, "#signInAnotherWay")) {
        triedOtherWay = true; await page.click("#signInAnotherWay"); await sleep(2500); continue;
      }
      setStatus("approve", "Approve the sign-in in Microsoft Authenticator", { number: num });
      await sleep(2000); continue;
    }
    if (!triedOtherWay && await visible(page, "#signInAnotherWay")) {
      triedOtherWay = true; await page.click("#signInAnotherWay"); await sleep(2500); continue;
    }
    // "Stay signed in?" — yes, so later runs can skip the Authenticator step
    if (await visible(page, "#KmsiCheckboxField, #KmsiDescription")) {
      try { await page.check("#KmsiCheckboxField", { timeout: 500 }); } catch {}
      await page.click("#idSIButton9"); await sleep(3000); continue;
    }
    // Generic "Next/Yes" on interstitials (e.g. "Approve sign in request" done)
    if (/login\.microsoftonline\.com/.test(url) && await visible(page, "#idSIButton9") && filledPass) {
      await page.click("#idSIButton9"); await sleep(2500); continue;
    }
    await sleep(1000);
  }
  throw new Error("Timed out waiting for sign-in (no Authenticator response within 7 minutes).");
}

async function api(page, p) {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!r.ok) return { __error: r.status };
    return r.json();
  }, p);
}

async function scrape(page) {
  const versions = await api(page, "/d2l/api/versions/");
  if (!Array.isArray(versions)) throw new Error("Brightspace API not reachable after sign-in (" + JSON.stringify(versions).slice(0, 80) + ")");
  const ver = (code, fb) => (versions.find((v) => v.ProductCode === code) || {}).LatestVersion || fb;
  const lp = ver("lp", "1.30"), le = ver("le", "1.60");

  // Courses
  let items = [], bookmark = "";
  for (let i = 0; i < 10; i++) {
    const r = await api(page, `/d2l/api/lp/${lp}/enrollments/myenrollments/?orgUnitTypeId=3${bookmark ? "&bookmark=" + encodeURIComponent(bookmark) : ""}`);
    if (!r || r.__error) throw new Error("Could not list courses (HTTP " + (r && r.__error) + ")");
    items = items.concat(r.Items || []);
    if (!r.PagingInfo || !r.PagingInfo.HasMoreItems) break;
    bookmark = r.PagingInfo.Bookmark;
  }
  const now = Date.now();
  const courses = items
    .filter((it) => it.Access && it.Access.CanAccess !== false)
    .filter((it) => !it.Access.EndDate || new Date(it.Access.EndDate).getTime() > now - 21 * 864e5)
    .filter((it) => !it.Access.StartDate || new Date(it.Access.StartDate).getTime() < now + 30 * 864e5)
    .slice(0, 15)
    .map((it) => ({ id: String(it.OrgUnit.Id), name: it.OrgUnit.Name, code: it.OrgUnit.Code || "" }));

  const assignments = [], grades = [];
  for (const c of courses) {
    const folders = await api(page, `/d2l/api/le/${le}/${c.id}/dropbox/folders/`);
    if (Array.isArray(folders)) {
      for (const f of folders) {
        if (f.IsHidden) continue;
        const due = f.DueDate || (f.Availability && f.Availability.EndDate) || null;
        let submitted = null;
        if (due && Math.abs(new Date(due).getTime() - now) < 45 * 864e5) {
          const subs = await api(page, `/d2l/api/le/${le}/${c.id}/dropbox/folders/${f.Id}/submissions/mysubmissions/`);
          if (Array.isArray(subs)) submitted = subs.some((s) => (s.Submissions || []).length > 0);
        }
        assignments.push({ courseId: c.id, course: c.name, title: f.Name, due, submitted });
      }
    }
    const gv = await api(page, `/d2l/api/le/${le}/${c.id}/grades/values/myGradeValues/`);
    if (Array.isArray(gv)) {
      for (const g of gv) {
        const num = g.PointsNumerator, den = g.PointsDenominator;
        grades.push({
          courseId: c.id, course: c.name, item: g.GradeObjectName,
          score: num ?? null, outOf: den ?? null,
          pct: num != null && den ? Math.round((num / den) * 1000) / 10 : null,
          displayed: g.DisplayedGrade || null,
        });
      }
    }
    const fin = await api(page, `/d2l/api/le/${le}/${c.id}/grades/final/values/myGradeValue`);
    if (fin && !fin.__error) c.final = fin.DisplayedGrade || null;
  }
  return { syncedAt: new Date().toISOString(), courses, assignments, grades };
}

main().catch((e) => { console.error(e); process.exit(1); });
