import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  dueDate: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
});

const updateSchema = createSchema.partial().extend({
  completed: z.boolean().optional(),
});

export async function GET() {
  const todos = await prisma.todo.findMany({
    orderBy: [
      { completed: "asc" },
      {
        priority: "asc", // We'll sort client-side for priority ordering
      },
      { createdAt: "desc" },
    ],
  });

  const parsed = todos.map((t) => ({
    ...t,
    tags: JSON.parse(t.tags) as string[],
  }));

  return NextResponse.json(parsed);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const data = createSchema.parse(body);

  const todo = await prisma.todo.create({
    data: {
      title: data.title,
      description: data.description,
      priority: data.priority,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      tags: JSON.stringify(data.tags),
    },
  });

  return NextResponse.json({ ...todo, tags: data.tags }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json();
  const data = updateSchema.parse(body);

  const todo = await prisma.todo.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.dueDate !== undefined && {
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      }),
      ...(data.tags !== undefined && { tags: JSON.stringify(data.tags) }),
      ...(data.completed !== undefined && { completed: data.completed }),
    },
  });

  return NextResponse.json({
    ...todo,
    tags: JSON.parse(todo.tags) as string[],
  });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.todo.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
