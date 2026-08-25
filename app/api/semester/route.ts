import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const semesterSchema = z.object({
  name: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  isActive: z.boolean().optional(),
});

const breakSchema = z.object({
  semesterId: z.string(),
  name: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
});

export async function GET() {
  const semesters = await prisma.semester.findMany({
    include: { breaks: { orderBy: { startDate: "asc" } } },
    orderBy: { startDate: "desc" },
  });
  return NextResponse.json({ semesters });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  if (type === "break") {
    const body = await req.json();
    const data = breakSchema.parse(body);
    const b = await prisma.semesterBreak.create({
      data: {
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
      },
    });
    return NextResponse.json(b, { status: 201 });
  }

  const body = await req.json();
  const data = semesterSchema.parse(body);

  // If this semester is being set active, deactivate all others first
  if (data.isActive) {
    await prisma.semester.updateMany({ data: { isActive: false } });
  }

  const semester = await prisma.semester.create({
    data: {
      name: data.name,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      isActive: data.isActive ?? false,
    },
  });
  return NextResponse.json(semester, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const type = url.searchParams.get("type");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (type === "activate") {
    // Set this semester as active, deactivate all others
    await prisma.semester.updateMany({ data: { isActive: false } });
    const semester = await prisma.semester.update({
      where: { id },
      data: { isActive: true },
      include: { breaks: true },
    });
    return NextResponse.json(semester);
  }

  const body = await req.json();
  const data = semesterSchema.partial().parse(body);

  if (data.isActive) {
    await prisma.semester.updateMany({ data: { isActive: false } });
  }

  const semester = await prisma.semester.update({
    where: { id },
    data: {
      ...data,
      ...(data.startDate && { startDate: new Date(data.startDate) }),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
    },
    include: { breaks: true },
  });
  return NextResponse.json(semester);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const type = url.searchParams.get("type");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (type === "break") {
    await prisma.semesterBreak.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }

  // Archive: detach courses from this semester instead of cascade-deleting them
  await prisma.brightspaceCourse.updateMany({
    where: { semesterId: id },
    data: { semesterId: null },
  });
  await prisma.semester.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
