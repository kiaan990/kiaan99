import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseSyllabus } from "@/lib/syllabus-parser";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("ANTHROPIC_API_KEY not set — syllabus parsing will fail");
}

async function extractText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = (await import("pdf-parse")) as any;
    const fn = pdfParse.default ?? pdfParse;
    const result = await fn(buffer);
    return result.text as string;
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // Plain text fallback
  return buffer.toString("utf-8");
}

// POST — upload a syllabus file, extract text, call Claude, return parsed preview
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const allowed = [".pdf", ".docx", ".txt"];
  if (!allowed.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json({ error: "Only PDF, DOCX, or TXT files accepted" }, { status: 400 });
  }

  // Extract text from document
  let rawText: string;
  try {
    rawText = await extractText(file);
  } catch (err) {
    return NextResponse.json({ error: `Failed to read file: ${String(err)}` }, { status: 422 });
  }

  if (rawText.trim().length < 100) {
    return NextResponse.json({ error: "File appears empty or unreadable" }, { status: 422 });
  }

  // Get active semester for date resolution
  const activeSemester = await prisma.semester.findFirst({
    where: { isActive: true },
    include: { breaks: true },
  });

  // Parse with Claude — fail loudly, never silently
  let parsed;
  try {
    parsed = await parseSyllabus(rawText, activeSemester);
  } catch (err) {
    return NextResponse.json(
      { error: "Parse failed", details: String(err) },
      { status: 422 }
    );
  }

  // Persist the upload record
  const upload = await prisma.syllabusUpload.create({
    data: {
      filename: file.name,
      rawText: rawText.slice(0, 50000),
      parsedJson: JSON.stringify(parsed),
      semesterId: activeSemester?.id ?? null,
    },
  });

  return NextResponse.json({ uploadId: upload.id, parsed });
}

// GET — list recent uploads
export async function GET() {
  const uploads = await prisma.syllabusUpload.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, filename: true, status: true, courseId: true, createdAt: true },
  });
  return NextResponse.json({ uploads });
}
