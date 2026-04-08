import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const linkSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().url().or(z.string().startsWith("goodnotes5://")),
  emoji: z.string().default("📓"),
  sortOrder: z.number().default(0),
});

export async function GET() {
  const links = await prisma.goodNotesLink.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(links);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const data = linkSchema.parse(body);
  const link = await prisma.goodNotesLink.create({ data });
  return NextResponse.json(link, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const body = await req.json();
  const data = linkSchema.partial().parse(body);
  const link = await prisma.goodNotesLink.update({ where: { id }, data });
  return NextResponse.json(link);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.goodNotesLink.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
