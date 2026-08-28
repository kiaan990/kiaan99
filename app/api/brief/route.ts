import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { differenceInDays, startOfDay, format } from "date-fns";

export interface BriefItem {
  id: string;
  title: string;
  courseName: string;
  courseCode: string | null;
  courseColor: string;
  type: string;
  dueDate: string; // ISO
  daysUntilDue: number;
  weight: number; // 0–1 fraction of course grade
  priorityScore: number;
  estimatedHours: number; // recommended hours for today
  source: "syllabus" | "brightspace";
}

export interface ScheduleEntry {
  courseId: string;
  courseName: string;
  courseCode: string | null;
  startTime: string;
  endTime: string;
  location: string | null;
  professor: string | null;
}

export interface BriefResponse {
  today: string;
  workOnNow: BriefItem | null;
  upcoming: BriefItem[];
  todaySchedule: ScheduleEntry[];
  overdue: BriefItem[];
}

// ─── Weight inference ────────────────────────────────────────────────────────

const DEFAULT_WEIGHT: Record<string, number> = {
  exam: 0.2,
  project: 0.15,
  assignment: 0.1,
  quiz: 0.05,
  reading: 0.04,
  other: 0.08,
};

function inferWeight(
  title: string,
  type: string,
  gradingComponents: { name: string; weight: number }[]
): number {
  if (gradingComponents.length === 0) return DEFAULT_WEIGHT[type] ?? 0.08;

  // Try to match title to a grading component by keyword overlap
  const titleLower = title.toLowerCase();
  let best: { weight: number; score: number } | null = null;

  for (const gc of gradingComponents) {
    const gcWords = gc.name.toLowerCase().split(/\s+/);
    const score = gcWords.filter((w) => titleLower.includes(w) && w.length > 3).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { weight: gc.weight, score };
    }
  }

  return best?.weight ?? DEFAULT_WEIGHT[type] ?? 0.08;
}

// ─── Urgency multiplier ──────────────────────────────────────────────────────

function urgency(daysUntilDue: number): number {
  if (daysUntilDue <= 0) return 4.0;
  if (daysUntilDue === 1) return 3.0;
  if (daysUntilDue === 2) return 2.0;
  if (daysUntilDue === 3) return 1.5;
  if (daysUntilDue <= 5) return 1.2;
  return 1.0;
}

// ─── Session hours to recommend today ────────────────────────────────────────

function recommendedHoursToday(type: string, weight: number, daysUntilDue: number): number {
  const totalEstimate = (() => {
    switch (type) {
      case "exam":    return Math.min(12, Math.max(2, weight * 40));
      case "project": return Math.min(10, Math.max(2, weight * 30));
      case "assignment": return Math.min(6, Math.max(1, weight * 20));
      case "quiz":    return Math.min(2, Math.max(0.5, weight * 10));
      case "reading": return Math.min(3, Math.max(0.5, weight * 8));
      default:        return Math.min(4, Math.max(1, weight * 15));
    }
  })();

  // Spread recommended hours across remaining days
  const fraction =
    daysUntilDue <= 0 ? 1.0 :
    daysUntilDue === 1 ? 0.7 :
    daysUntilDue <= 3 ? 0.4 :
    0.25;

  return Math.max(0.5, Math.round(totalEstimate * fraction * 2) / 2);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET() {
  const today = startOfDay(new Date());
  const horizon = new Date(today.getTime() + 8 * 24 * 60 * 60 * 1000); // 8 days

  const items: BriefItem[] = [];

  // ── Syllabus items ────────────────────────────────────────────────────────
  const syllabusItems = await prisma.syllabusItem.findMany({
    where: {
      dueDate: { lte: horizon },
    },
    include: {
      course: {
        include: { gradingComponents: true },
      },
    },
    orderBy: { dueDate: "asc" },
  });

  for (const si of syllabusItems) {
    if (!si.dueDate) continue;
    const daysUntilDue = differenceInDays(si.dueDate, today);
    const weight =
      si.weight ??
      inferWeight(si.title, si.type, si.course.gradingComponents);
    const u = urgency(daysUntilDue);
    items.push({
      id: si.id,
      title: si.title,
      courseName: si.course.name,
      courseCode: si.course.courseCode ?? null,
      courseColor: "#c8922a", // courses don't have colors yet; use gold
      type: si.type,
      dueDate: si.dueDate.toISOString(),
      daysUntilDue,
      weight,
      priorityScore: weight * u,
      estimatedHours: recommendedHoursToday(si.type, weight, daysUntilDue),
      source: "syllabus",
    });
  }

  // ── Brightspace assignments ───────────────────────────────────────────────
  const bsAssignments = await prisma.brightspaceAssignment.findMany({
    where: {
      status: "pending",
      submitted: false,
      dueDate: { lte: horizon },
    },
    include: { course: true },
    orderBy: { dueDate: "asc" },
  });

  for (const a of bsAssignments) {
    if (!a.dueDate) continue;
    const daysUntilDue = differenceInDays(a.dueDate, today);
    const type = a.title.toLowerCase().includes("exam") ? "exam"
      : a.title.toLowerCase().includes("quiz") ? "quiz"
      : a.title.toLowerCase().includes("project") ? "project"
      : "assignment";
    const weight = a.weight ?? DEFAULT_WEIGHT[type] ?? 0.08;
    const u = urgency(daysUntilDue);
    items.push({
      id: a.id,
      title: a.title,
      courseName: a.course.name,
      courseCode: a.course.courseCode ?? null,
      courseColor: a.course.color,
      type,
      dueDate: a.dueDate.toISOString(),
      daysUntilDue,
      weight,
      priorityScore: weight * u,
      estimatedHours: recommendedHoursToday(type, weight, daysUntilDue),
      source: "brightspace",
    });
  }

  // Sort by priority score descending
  items.sort((a, b) => b.priorityScore - a.priorityScore);

  const overdue = items.filter((i) => i.daysUntilDue < 0);
  const upcoming = items.filter((i) => i.daysUntilDue >= 0);

  // ── Today's class schedule ────────────────────────────────────────────────
  const todayName = format(today, "EEEE"); // "Monday", "Tuesday", etc.

  const meetings = await prisma.courseMeetingTime.findMany({
    where: { dayOfWeek: todayName },
    include: { course: true },
    orderBy: { startTime: "asc" },
  });

  const todaySchedule: ScheduleEntry[] = meetings.map((m) => ({
    courseId: m.courseId,
    courseName: m.course.name,
    courseCode: m.course.courseCode ?? null,
    startTime: m.startTime,
    endTime: m.endTime,
    location: m.location ?? null,
    professor: m.course.professor ?? null,
  }));

  return NextResponse.json({
    today: today.toISOString(),
    workOnNow: upcoming[0] ?? null,
    upcoming: upcoming.slice(0, 8),
    todaySchedule,
    overdue,
  } satisfies BriefResponse);
}
