import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeCourseGrade, LETTER_GRADE_POINTS } from "@/lib/grade-math";
import type { CourseGradeResult } from "@/lib/grade-math";
import { calculateGPA } from "@/lib/gpa";

export type { CourseGradeResult } from "@/lib/grade-math";

export interface GradeIntelligenceResponse {
  courses: CourseGradeResult[];
  projectedGPA: number | null;
  projectedGPAWithHistory: number | null;
}

export async function GET() {
  // Load all courses in the active semester (or all if no active semester)
  const activeSemester = await prisma.semester.findFirst({
    where: { isActive: true },
  });

  const courses = await prisma.course.findMany({
    where: activeSemester ? { semesterId: activeSemester.id } : {},
    include: {
      gradingComponents: true,
      syllabusItems: {
        orderBy: { dueDate: "asc" },
      },
    },
  });

  const results: CourseGradeResult[] = courses.map((course) =>
    computeCourseGrade(
      course.id,
      course.name,
      course.courseCode ?? null,
      course.gradingComponents.map((gc) => ({
        id: gc.id,
        name: gc.name,
        weight: gc.weight,
        items: [],
      })),
      course.syllabusItems.map((si) => ({
        id: si.id,
        title: si.title,
        type: si.type,
        dueDate: si.dueDate ?? null,
        weight: si.weight ?? null,
        earnedPoints: si.earnedPoints ?? null,
        maxPoints: si.maxPoints ?? null,
      }))
    )
  );

  // Projected GPA for current semester (courses with projectedFinal)
  const currentCredits = 3; // assume 3 credits per syllabus course — adjust when credit tracking lands
  const gradedCourses = results.filter((r) => r.projectedFinal != null);

  const projectedGPA =
    gradedCourses.length > 0
      ? (() => {
          const totalPoints = gradedCourses.reduce((s, r) => {
            const letter = r.projectedLetter ?? "F";
            return s + (LETTER_GRADE_POINTS[letter] ?? 0) * currentCredits;
          }, 0);
          return Math.round((totalPoints / (gradedCourses.length * currentCredits)) * 100) / 100;
        })()
      : null;

  // Combined with historical GPA courses
  let projectedGPAWithHistory: number | null = null;
  if (projectedGPA != null) {
    const historyCourses = await prisma.gpaCourse.findMany({
      where: activeSemester
        ? { NOT: { semester: activeSemester.name } }
        : {},
    });

    const combined = calculateGPA([
      ...historyCourses,
      ...gradedCourses.map((r) => ({
        credits: currentCredits,
        letterGrade: r.projectedLetter ?? "F",
      })),
    ]);
    projectedGPAWithHistory = combined;
  }

  return NextResponse.json({
    courses: results,
    projectedGPA,
    projectedGPAWithHistory,
  } satisfies GradeIntelligenceResponse);
}
