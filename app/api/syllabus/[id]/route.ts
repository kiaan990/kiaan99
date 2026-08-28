import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const upload = await prisma.syllabusUpload.findUnique({ where: { id } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    ...upload,
    parsed: upload.parsedJson ? JSON.parse(upload.parsedJson) : null,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.syllabusUpload.update({ where: { id }, data: { status: "rejected" } });
  return NextResponse.json({ success: true });
}
