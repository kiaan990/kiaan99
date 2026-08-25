import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const courseSchema = z.object({
  name: z.string().min(1),
  courseCode: z.string().optional(),
  color: z.string().optional(),
  semesterId: z.string().optional().nullable(),
});

const assignmentSchema = z.object({
  courseId: z.string(),
  title: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  submitted: z.boolean().default(false),
  grade: z.number().optional().nullable(),
  maxGrade: z.number().optional().nullable(),
  weight: z.number().optional().nullable(),
  status: z.enum(["pending", "submitted", "graded", "missing"]).default("pending"),
});

// GET — return courses for the active semester (or all if no active semester / ?all=1)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const showAll = url.searchParams.get("all") === "1";

  let where = {};
  if (!showAll) {
    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } });
    if (activeSemester) {
      where = { semesterId: activeSemester.id };
    }
  }

  const courses = await prisma.brightspaceCourse.findMany({
    where,
    include: {
      assignments: { orderBy: { dueDate: "asc" } },
      grades: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ courses });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  if (type === "course") {
    const body = await req.json();
    const data = courseSchema.parse(body);

    // Auto-assign active semester if not specified
    if (!data.semesterId) {
      const active = await prisma.semester.findFirst({ where: { isActive: true } });
      if (active) (data as typeof data & { semesterId: string }).semesterId = active.id;
    }

    const course = await prisma.brightspaceCourse.create({ data });
    return NextResponse.json(course, { status: 201 });
  }

  if (type === "assignment") {
    const body = await req.json();
    const data = assignmentSchema.parse(body);
    const assignment = await prisma.brightspaceAssignment.create({
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      },
    });
    return NextResponse.json(assignment, { status: 201 });
  }

  if (type === "scrape") {
    if (!process.env.BRIGHTSPACE_USER || !process.env.BRIGHTSPACE_PASS) {
      return NextResponse.json(
        { error: "BRIGHTSPACE_USER and BRIGHTSPACE_PASS not configured" },
        { status: 400 }
      );
    }

    // Guard against concurrent scrapes
    const running = await prisma.oAuthToken.findUnique({ where: { provider: "__scrape_lock" } });
    if (running) {
      return NextResponse.json({ error: "Scrape already in progress" }, { status: 409 });
    }

    // Set a scrape lock (expires in 5 minutes)
    await prisma.oAuthToken.create({
      data: {
        provider: "__scrape_lock",
        accessToken: "locked",
        refreshToken: null,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    try {
      const { scrapeBrightspace } = await import("@/lib/brightspace");
      const result = await scrapeBrightspace();

      const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } });

      for (const course of result.courses) {
        await prisma.brightspaceCourse.upsert({
          where: { id: course.id },
          create: {
            id: course.id,
            name: course.name,
            courseCode: course.courseCode,
            semesterId: activeSemester?.id ?? null,
          },
          update: {
            name: course.name,
            courseCode: course.courseCode,
            ...(activeSemester && { semesterId: activeSemester.id }),
          },
        });
      }

      for (const a of result.assignments) {
        const assignId = `${a.courseId}-${a.title.replace(/\s/g, "-").slice(0, 40)}`;
        await prisma.brightspaceAssignment.upsert({
          where: { id: assignId },
          create: {
            id: assignId,
            courseId: a.courseId,
            title: a.title,
            dueDate: a.dueDate,
            submitted: a.submitted,
            status: a.status,
          },
          update: {
            dueDate: a.dueDate,
            submitted: a.submitted,
            status: a.status,
          },
        });
      }

      // Save grades (previously discarded)
      for (const g of result.grades) {
        const gradeId = `${g.courseId}-${g.category.replace(/\s/g, "-").slice(0, 40)}`;
        await prisma.brightspaceGrade.upsert({
          where: { id: gradeId },
          create: {
            id: gradeId,
            courseId: g.courseId,
            category: g.category,
            earned: g.earned ?? null,
            possible: g.possible ?? null,
            weight: g.weight ?? null,
          },
          update: {
            earned: g.earned ?? null,
            possible: g.possible ?? null,
            weight: g.weight ?? null,
          },
        });
      }

      return NextResponse.json({
        success: true,
        coursesImported: result.courses.length,
        assignmentsImported: result.assignments.length,
        gradesImported: result.grades.length,
      });
    } catch (error) {
      return NextResponse.json(
        { error: "Scrape failed", details: String(error) },
        { status: 500 }
      );
    } finally {
      await prisma.oAuthToken.deleteMany({ where: { provider: "__scrape_lock" } });
    }
  }

  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const type = url.searchParams.get("type");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json();

  if (type === "course") {
    const data = courseSchema.partial().parse(body);
    const course = await prisma.brightspaceCourse.update({ where: { id }, data });
    return NextResponse.json(course);
  }

  if (type === "assignment") {
    const data = assignmentSchema.partial().parse(body);
    const assignment = await prisma.brightspaceAssignment.update({
      where: { id },
      data: {
        ...data,
        ...(data.dueDate !== undefined && {
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
        }),
      },
    });
    return NextResponse.json(assignment);
  }

  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const type = url.searchParams.get("type");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (type === "course") {
    await prisma.brightspaceCourse.delete({ where: { id } });
  } else if (type === "assignment") {
    await prisma.brightspaceAssignment.delete({ where: { id } });
  }

  return NextResponse.json({ success: true });
}
