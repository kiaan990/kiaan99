import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const scoreSchema = z.object({
  earnedPoints: z.number().min(0).nullable(),
  maxPoints: z.number().min(0).nullable(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = scoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { earnedPoints, maxPoints } = parsed.data;

  const item = await prisma.syllabusItem.update({
    where: { id },
    data: { earnedPoints, maxPoints },
  });

  return NextResponse.json(item);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  await prisma.syllabusItem.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
