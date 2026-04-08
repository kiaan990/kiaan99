export const GRADE_POINTS: Record<string, number> = {
  "A+": 4.0,
  A: 4.0,
  "A-": 3.7,
  "B+": 3.3,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.3,
  C: 2.0,
  "C-": 1.7,
  "D+": 1.3,
  D: 1.0,
  "D-": 0.7,
  F: 0.0,
};

export const GRADE_LABELS = Object.keys(GRADE_POINTS);

export function calculateGPA(
  courses: { credits: number; letterGrade: string }[]
): number {
  if (courses.length === 0) return 0;

  const totalPoints = courses.reduce((sum, c) => {
    const points = GRADE_POINTS[c.letterGrade] ?? 0;
    return sum + points * c.credits;
  }, 0);

  const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
  if (totalCredits === 0) return 0;

  return Math.round((totalPoints / totalCredits) * 100) / 100;
}

export function gpaToColor(gpa: number): string {
  if (gpa >= 3.7) return "#22c55e"; // green
  if (gpa >= 3.0) return "#f59e0b"; // amber
  if (gpa >= 2.0) return "#f97316"; // orange
  return "#ef4444"; // red
}

export function gpaToLabel(gpa: number): string {
  if (gpa >= 3.9) return "Summa Cum Laude";
  if (gpa >= 3.7) return "Magna Cum Laude";
  if (gpa >= 3.5) return "Cum Laude";
  if (gpa >= 3.0) return "Good Standing";
  if (gpa >= 2.0) return "Satisfactory";
  return "At Risk";
}
