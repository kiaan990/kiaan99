import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } });

  const courses = await prisma.course.findMany({
    where: activeSemester ? { semesterId: activeSemester.id } : {},
    include: {
      meetingTimes: { orderBy: { dayOfWeek: "asc" } },
      gradingComponents: { orderBy: { weight: "desc" } },
      policies: true,
      syllabusItems: { orderBy: { dueDate: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ courses });
}
