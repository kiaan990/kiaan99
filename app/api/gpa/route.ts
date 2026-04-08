import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { calculateGPA, GRADE_LABELS } from "@/lib/gpa";

const courseSchema = z.object({
  name: z.string().min(1),
  courseCode: z.string().optional(),
  credits: z.number().min(0).max(6),
  letterGrade: z.enum(GRADE_LABELS as [string, ...string[]]),
  semester: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const semester = url.searchParams.get("semester");

  const where = semester ? { semester } : {};
  const courses = await prisma.gpaCourse.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  const gpa = calculateGPA(courses);

  // Get distinct semesters
  const semesters = await prisma.gpaCourse.findMany({
    distinct: ["semester"],
    select: { semester: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    courses,
    gpa,
    semesters: semesters.map((s) => s.semester),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const data = courseSchema.parse(body);

  const course = await prisma.gpaCourse.create({ data });
  return NextResponse.json(course, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json();
  const data = courseSchema.partial().parse(body);

  const course = await prisma.gpaCourse.update({ where: { id }, data });
  return NextResponse.json(course);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.gpaCourse.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
