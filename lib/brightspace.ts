/**
 * Brightspace (D2L) scraper for Bentley University
 * Uses D2L's internal JSON API endpoints after authenticating via Microsoft SSO.
 */

const BASE_URL = process.env.BRIGHTSPACE_BASE_URL ?? "https://brightspace.bentley.edu";
const API_LP = `${BASE_URL}/d2l/api/lp/1.9`;
const API_LE = `${BASE_URL}/d2l/api/le/1.53`;

export interface ScrapedCourse {
  id: string;
  name: string;
  courseCode: string;
}

export interface ScrapedAssignment {
  courseId: string;
  courseName: string;
  title: string;
  dueDate: Date | null;
  submitted: boolean;
  status: "pending" | "submitted" | "graded" | "missing";
}

export interface ScrapedGrade {
  courseId: string;
  courseName: string;
  category: string;
  earned: number | null;
  possible: number | null;
  weight: number | null;
}

export interface ScrapeResult {
  courses: ScrapedCourse[];
  assignments: ScrapedAssignment[];
  grades: ScrapedGrade[];
}

async function getBrowser() {
  const { chromium } = await import("playwright");
  return chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}

async function apiGet(page: import("playwright").Page, url: string): Promise<unknown> {
  const resp = await page.goto(url, { timeout: 20000 });
  if (!resp?.ok()) return null;
  const text = await page.textContent("body");
  try { return JSON.parse(text ?? "null"); } catch { return null; }
}

export async function scrapeBrightspace(): Promise<ScrapeResult> {
  if (!process.env.BRIGHTSPACE_USER || !process.env.BRIGHTSPACE_PASS) {
    throw new Error("BRIGHTSPACE_USER and BRIGHTSPACE_PASS are required");
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    // ── Login via Microsoft SSO ──────────────────────────────────────
    await page.goto(`${BASE_URL}/d2l/login`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForSelector('input[type="email"], input[name="loginfmt"]', { timeout: 15000 });

    const email = process.env.BRIGHTSPACE_USER.includes("@")
      ? process.env.BRIGHTSPACE_USER
      : `${process.env.BRIGHTSPACE_USER}@falcon.bentley.edu`;

    await page.fill('input[type="email"], input[name="loginfmt"]', email);
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.fill('input[type="password"]', process.env.BRIGHTSPACE_PASS);
    await page.click('input[type="submit"], button[type="submit"]');

    // Handle "Stay signed in?" if it appears
    try {
      await page.waitForSelector('input[id="idBtn_Back"]', { timeout: 5000 });
      await page.click('input[id="idBtn_Back"]');
    } catch { /* no prompt */ }

    // Long timeout for MFA
    await page.waitForURL(`${BASE_URL}/d2l/home`, { timeout: 90000 });
    await page.waitForTimeout(1500);

    // ── Fetch enrollments via API ────────────────────────────────────
    const enrollData = await apiGet(page, `${API_LP}/enrollments/myenrollments/?orgUnitTypeId=3&isActive=1`) as {
      Items: { OrgUnit: { Id: number; Name: string; Code: string }; Access: { CanAccess: boolean } }[]
    } | null;

    if (!enrollData?.Items?.length) {
      return { courses: [], assignments: [], grades: [] };
    }

    const courses: ScrapedCourse[] = enrollData.Items
      .filter((item) => {
        if (!item.Access.CanAccess) return false;
        // Filter by semester if BRIGHTSPACE_SEMESTER is set (e.g. "spring 2026"), otherwise include all accessible courses
        const semFilter = process.env.BRIGHTSPACE_SEMESTER?.toLowerCase();
        if (!semFilter) return true;
        const name = item.OrgUnit.Name.toLowerCase();
        const code = item.OrgUnit.Code.toLowerCase();
        return name.includes(semFilter) || code.includes(semFilter.replace(/\s+/g, ""));
      })
      .map((item) => {
        const name = item.OrgUnit.Name;
        const codeMatch = name.match(/^([A-Z]{2,4}\s*\d{3,4})/i);
        return {
          id: String(item.OrgUnit.Id),
          name,
          courseCode: codeMatch?.[1]?.toUpperCase() ?? item.OrgUnit.Code,
        };
      });

    const assignments: ScrapedAssignment[] = [];
    const grades: ScrapedGrade[] = [];

    // ── For each course, fetch assignments + grades ──────────────────
    for (const course of courses.slice(0, 12)) {
      const ouId = course.id;

      // Assignments (dropbox folders)
      try {
        const folders = await apiGet(page, `${API_LE}/${ouId}/dropbox/folders/`) as {
          Id: number; Name: string; DueDate: string | null;
        }[] | null;

        if (Array.isArray(folders)) {
          for (const folder of folders) {
            // Check my submissions for this folder
            let submitted = false;
            let status: "pending" | "submitted" | "graded" | "missing" = "pending";

            try {
              const subs = await apiGet(page, `${API_LE}/${ouId}/dropbox/folders/${folder.Id}/submissions/mysubmissions/`) as {
                Feedback: unknown; Files: unknown[]
              }[] | null;

              if (Array.isArray(subs) && subs.length > 0) {
                submitted = true;
                status = subs[0].Feedback ? "graded" : "submitted";
              }
            } catch { /* no submission data */ }

            const dueDate = folder.DueDate ? new Date(folder.DueDate) : null;
            if (dueDate && dueDate < new Date() && !submitted) status = "missing";

            assignments.push({
              courseId: ouId,
              courseName: course.name,
              title: folder.Name,
              dueDate,
              submitted,
              status,
            });
          }
        }
      } catch { /* course has no dropbox */ }

      // Calendar events — pick up assignments not in dropbox
      try {
        const now = new Date().toISOString();
        const future = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
        const calEvents = await apiGet(page, `${API_LE}/${ouId}/calendar/events/?startDateTime=${now}&endDateTime=${future}`) as {
          Title: string;
          StartDateTime: string | null;
          EndDateTime: string | null;
          StartDay: string | null;
          EndDay: string | null;
          IsAllDayEvent: boolean;
        }[] | null;

        if (Array.isArray(calEvents)) {
          const existingTitles = new Set(assignments.filter((a) => a.courseId === ouId).map((a) => a.title.toLowerCase().trim()));

          for (const ev of calEvents) {
            const title = ev.Title?.trim();
            if (!title) continue;
            if (existingTitles.has(title.toLowerCase())) continue; // already from dropbox

            const rawDate = ev.EndDateTime ?? ev.StartDateTime ?? ev.EndDay ?? ev.StartDay;
            const dueDate = rawDate ? new Date(rawDate) : null;

            // Skip if in the past
            if (dueDate && dueDate < new Date()) continue;

            assignments.push({
              courseId: ouId,
              courseName: course.name,
              title,
              dueDate,
              submitted: false,
              status: "pending",
            });
            existingTitles.add(title.toLowerCase());
          }
        }
      } catch { /* calendar unavailable */ }

      // Grades
      try {
        const gradeItems = await apiGet(page, `${API_LE}/${ouId}/grades/`) as {
          Id: number; Name: string; Weight: number | null; MaxPoints: number | null;
        }[] | null;

        if (Array.isArray(gradeItems)) {
          for (const item of gradeItems.slice(0, 20)) {
            try {
              const myGrade = await apiGet(page, `${API_LE}/${ouId}/grades/${item.Id}/values/myGradeValue`) as {
                DisplayedGrade: string | null; PointsNumerator: number | null; PointsDenominator: number | null;
              } | null;

              grades.push({
                courseId: ouId,
                courseName: course.name,
                category: item.Name,
                earned: myGrade?.PointsNumerator ?? null,
                possible: myGrade?.PointsDenominator ?? item.MaxPoints ?? null,
                weight: item.Weight ?? null,
              });
            } catch { /* grade not available */ }
          }
        }
      } catch { /* course has no grades */ }
    }

    return { courses, assignments, grades };
  } finally {
    await context.close();
    await browser.close();
  }
}
