import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Manual course management (always available)
const courseSchema = z.object({
  name: z.string().min(1),
  courseCode: z.string().optional(),
  color: z.string().optional(),
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

// GET — return all courses + assignments + grades
export async function GET() {
  const courses = await prisma.brightspaceCourse.findMany({
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
    // Trigger Playwright scraper
    if (!process.env.BRIGHTSPACE_USER || !process.env.BRIGHTSPACE_PASS) {
      return NextResponse.json(
        { error: "BRIGHTSPACE_USER and BRIGHTSPACE_PASS not configured" },
        { status: 400 }
      );
    }

    try {
      const { scrapeBrightspace } = await import("@/lib/brightspace");
      const result = await scrapeBrightspace();

      // Upsert scraped data into DB
      for (const course of result.courses) {
        await prisma.brightspaceCourse.upsert({
          where: { id: course.id },
          create: {
            id: course.id,
            name: course.name,
            courseCode: course.courseCode,
          },
          update: {
            name: course.name,
            courseCode: course.courseCode,
          },
        });
      }

      for (const a of result.assignments) {
        await prisma.brightspaceAssignment.upsert({
          where: {
            id: `${a.courseId}-${a.title.replace(/\s/g, "-").slice(0, 40)}`,
          },
          create: {
            id: `${a.courseId}-${a.title.replace(/\s/g, "-").slice(0, 40)}`,
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

      return NextResponse.json({
        success: true,
        coursesImported: result.courses.length,
        assignmentsImported: result.assignments.length,
      });
    } catch (error) {
      return NextResponse.json(
        { error: "Scrape failed", details: String(error) },
        { status: 500 }
      );
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
