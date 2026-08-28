import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import type { ParsedSyllabus } from "@/lib/syllabus-parser";

const commitSchema = z.object({
  course: z.object({
    name: z.string().min(1),
    courseCode: z.string().nullable().optional(),
    professor: z.string().nullable().optional(),
    professorEmail: z.string().nullable().optional(),
    officeHours: z.string().nullable().optional(),
    meetingTimes: z
      .array(
        z.object({
          dayOfWeek: z.string(),
          startTime: z.string(),
          endTime: z.string(),
          location: z.string().nullable().optional(),
        })
      )
      .optional()
      .default([]),
  }),
  gradingComponents: z
    .array(
      z.object({
        name: z.string(),
        weight: z.number().min(0).max(1),
        description: z.string().nullable().optional(),
      })
    )
    .optional()
    .default([]),
  policies: z
    .array(
      z.object({
        category: z.enum(["late_penalty", "attendance", "submission", "other"]),
        content: z.string(),
      })
    )
    .optional()
    .default([]),
  items: z
    .array(
      z.object({
        title: z.string(),
        type: z.enum(["assignment", "reading", "quiz", "exam", "project", "other"]),
        dueDateRaw: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        weight: z.number().nullable().optional(),
        description: z.string().nullable().optional(),
        confidence: z.enum(["high", "medium", "low"]).optional(),
      })
    )
    .optional()
    .default([]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const upload = await prisma.syllabusUpload.findUnique({ where: { id } });
  if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  if (upload.status === "committed") {
    return NextResponse.json({ error: "Already committed" }, { status: 409 });
  }

  let body: ParsedSyllabus;
  try {
    const raw = await req.json();
    body = commitSchema.parse(raw) as ParsedSyllabus;
  } catch (err) {
    return NextResponse.json({ error: "Invalid body", details: String(err) }, { status: 400 });
  }

  // Create the canonical Course record with all nested data in one transaction
  const course = await prisma.course.create({
    data: {
      name: body.course.name,
      courseCode: body.course.courseCode ?? null,
      professor: body.course.professor ?? null,
      professorEmail: body.course.professorEmail ?? null,
      officeHours: body.course.officeHours ?? null,
      semesterId: upload.semesterId ?? null,
      meetingTimes: {
        create: (body.course.meetingTimes ?? []).map((mt) => ({
          dayOfWeek: mt.dayOfWeek,
          startTime: mt.startTime,
          endTime: mt.endTime,
          location: mt.location ?? null,
        })),
      },
      gradingComponents: {
        create: (body.gradingComponents ?? []).map((g) => ({
          name: g.name,
          weight: g.weight,
          description: g.description ?? null,
        })),
      },
      policies: {
        create: (body.policies ?? []).map((p) => ({
          category: p.category,
          content: p.content,
        })),
      },
      syllabusItems: {
        create: (body.items ?? []).map((item) => ({
          title: item.title,
          type: item.type,
          dueDateRaw: item.dueDateRaw ?? null,
          dueDate: item.dueDate ? new Date(item.dueDate) : null,
          weight: item.weight ?? null,
          description: item.description ?? null,
        })),
      },
    },
    include: {
      gradingComponents: true,
      syllabusItems: true,
    },
  });

  await prisma.syllabusUpload.update({
    where: { id },
    data: { status: "committed", courseId: course.id },
  });

  return NextResponse.json({
    success: true,
    courseId: course.id,
    itemsCreated: course.syllabusItems.length,
    gradingComponentsCreated: course.gradingComponents.length,
  });
}
