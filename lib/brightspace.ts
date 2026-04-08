/**
 * Brightspace (D2L) scraper for Bentley University
 * https://brightspace.bentley.edu/d2l/home
 *
 * Uses Playwright (headless Chromium) to authenticate and extract:
 * - Enrolled courses
 * - Upcoming assignments + due dates
 * - Current grades per course
 *
 * Required env vars:
 *   BRIGHTSPACE_USER  - your Bentley username (e.g. jsmith1)
 *   BRIGHTSPACE_PASS  - your Bentley password
 *
 * IMPORTANT: This scraper is provided for personal/educational use.
 * Review Bentley University's Acceptable Use Policy before running.
 */

const BASE_URL = "https://brightspace.bentley.edu";

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
  // Dynamic import to avoid build issues in environments without Playwright
  const { chromium } = await import("playwright");
  return chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
}

export async function scrapeBrightspace(): Promise<ScrapeResult> {
  if (!process.env.BRIGHTSPACE_USER || !process.env.BRIGHTSPACE_PASS) {
    throw new Error(
      "BRIGHTSPACE_USER and BRIGHTSPACE_PASS environment variables are required"
    );
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    // Step 1: Navigate to Brightspace login
    await page.goto(`${BASE_URL}/d2l/login`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Step 2: Handle SSO — Bentley uses Microsoft SSO
    // Wait for redirect to Microsoft login
    await page.waitForSelector('input[type="email"], input[name="loginfmt"]', {
      timeout: 15000,
    });

    await page.fill(
      'input[type="email"], input[name="loginfmt"]',
      `${process.env.BRIGHTSPACE_USER}@bentley.edu`
    );
    await page.click('input[type="submit"], button[type="submit"]');

    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.fill('input[type="password"]', process.env.BRIGHTSPACE_PASS);
    await page.click('input[type="submit"], button[type="submit"]');

    // Handle "Stay signed in?" prompt if it appears
    try {
      await page.waitForSelector(
        'input[id="idBtn_Back"], input[value="No"]',
        { timeout: 5000 }
      );
      await page.click('input[id="idBtn_Back"], input[value="No"]');
    } catch {
      // Prompt didn't appear, continue
    }

    // Wait for Brightspace home
    await page.waitForURL(`${BASE_URL}/d2l/home`, { timeout: 20000 });

    // Step 3: Scrape enrolled courses from the course widget
    const courses: ScrapedCourse[] = await page.evaluate(() => {
      const courseCards = document.querySelectorAll(
        "[data-courseorgunitid], .d2l-my-courses-tile, [data-org-unit-id]"
      );
      return Array.from(courseCards)
        .map((el) => {
          const id =
            el.getAttribute("data-courseorgunitid") ||
            el.getAttribute("data-org-unit-id") ||
            "";
          const nameEl = el.querySelector(
            "h2, h3, .d2l-card-title, [class*='title']"
          );
          const name = nameEl?.textContent?.trim() ?? "";
          const codeMatch = name.match(/^([A-Z]{2,4}\s*\d{3,4})/);
          return {
            id,
            name,
            courseCode: codeMatch?.[1] ?? "",
          };
        })
        .filter((c) => c.id && c.name);
    });

    const assignments: ScrapedAssignment[] = [];
    const grades: ScrapedGrade[] = [];

    // Step 4: For each course, scrape assignments and grades
    for (const course of courses.slice(0, 10)) {
      // Limit to prevent timeout
      // Assignments
      try {
        await page.goto(
          `${BASE_URL}/d2l/lms/dropbox/user/folders_list.d2l?ou=${course.id}`,
          { waitUntil: "networkidle", timeout: 20000 }
        );

        type RawAssignment = Omit<ScrapedAssignment, "dueDate"> & { dueDate: string | null };
        const rawAssignments: RawAssignment[] = await page.evaluate(
          (courseMeta) => {
            const rows = document.querySelectorAll(
              "tr.d2l-grid-row, .d2l-table-row, tr"
            );
            return Array.from(rows)
              .map((row) => {
                const cells = row.querySelectorAll("td");
                if (cells.length < 2) return null;

                const titleEl = cells[0]?.querySelector("a, strong");
                const title = titleEl?.textContent?.trim() ?? "";
                if (!title) return null;

                const dueDateText = cells[1]?.textContent?.trim() ?? "";
                let dueDate: string | null = null;

                // Parse various date formats D2L uses
                const dateMatch = dueDateText.match(
                  /(\w+ \d+,?\s*\d+(?::\d+ [AP]M)?)/i
                );
                if (dateMatch) {
                  const parsed = new Date(dateMatch[1]);
                  if (!isNaN(parsed.getTime())) {
                    dueDate = parsed.toISOString();
                  }
                }

                const statusText =
                  cells[2]?.textContent?.trim().toLowerCase() ?? "";
                const submitted = statusText.includes("submitted") || statusText.includes("turned in");
                const status: "pending" | "submitted" | "graded" | "missing" =
                  statusText.includes("graded")
                    ? "graded"
                    : statusText.includes("missing") || statusText.includes("late")
                    ? "missing"
                    : submitted
                    ? "submitted"
                    : "pending";

                return {
                  courseId: courseMeta.id,
                  courseName: courseMeta.name,
                  title,
                  dueDate,
                  submitted,
                  status,
                };
              })
              .filter(Boolean) as RawAssignment[];
          },
          course
        );

        assignments.push(
          ...rawAssignments.map((a) => ({
            ...a,
            dueDate: a.dueDate ? new Date(a.dueDate) : null,
          }))
        );
      } catch {
        // Assignment page unavailable for this course
      }

      // Grades
      try {
        await page.goto(
          `${BASE_URL}/d2l/lms/grades/my_grades/main.d2l?ou=${course.id}`,
          { waitUntil: "networkidle", timeout: 20000 }
        );

        const courseGrades: ScrapedGrade[] = await page.evaluate(
          (courseMeta) => {
            const rows = document.querySelectorAll(
              "tr.d2l-grid-row, .d2l-table-row, tr"
            );
            return Array.from(rows)
              .map((row) => {
                const cells = row.querySelectorAll("td");
                if (cells.length < 2) return null;

                const category = cells[0]?.textContent?.trim() ?? "";
                if (!category) return null;

                const gradeText = cells[1]?.textContent?.trim() ?? "";
                const weightText = cells[2]?.textContent?.trim() ?? "";

                // Parse "earned / possible" pattern
                const gradeMatch = gradeText.match(
                  /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/
                );
                const weightMatch = weightText.match(/(\d+(?:\.\d+)?)\s*%/);

                return {
                  courseId: courseMeta.id,
                  courseName: courseMeta.name,
                  category,
                  earned: gradeMatch ? parseFloat(gradeMatch[1]) : null,
                  possible: gradeMatch ? parseFloat(gradeMatch[2]) : null,
                  weight: weightMatch ? parseFloat(weightMatch[1]) : null,
                };
              })
              .filter(Boolean) as ScrapedGrade[];
          },
          course
        );

        grades.push(...courseGrades);
      } catch {
        // Grade page unavailable for this course
      }
    }

    return { courses, assignments, grades };
  } finally {
    await context.close();
    await browser.close();
  }
}
