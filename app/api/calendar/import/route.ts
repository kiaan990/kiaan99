import { NextRequest, NextResponse } from "next/server";
import ICAL from "ical.js";
import { prisma } from "@/lib/prisma";

// Color palette for auto-assigning to imported calendars
const COLORS = [
  "#c9a84c", "#3b82f6", "#10b981", "#f59e0b",
  "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899",
];

function pickColor(index: number) {
  return COLORS[index % COLORS.length];
}

export async function GET() {
  const calendars = await prisma.importedCalendar.findMany({
    orderBy: { importedAt: "desc" },
    select: { id: true, name: true, color: true, fileName: true, importedAt: true },
  });
  return NextResponse.json({ calendars });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const existingCount = await prisma.importedCalendar.count();
  const results: { name: string; count: number }[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const text = await file.text();

    let comp: ICAL.Component;
    try {
      comp = new ICAL.Component(ICAL.parse(text));
    } catch {
      continue; // skip malformed files
    }

    // Derive calendar name from X-WR-CALNAME or filename
    const calName =
      comp.getFirstPropertyValue<string>("x-wr-calname") ||
      file.name.replace(/\.ics$/i, "");

    const color = pickColor(existingCount + i);

    const vevents = comp.getAllSubcomponents("vevent");
    const eventsToCreate: {
      uid: string;
      title: string;
      start: Date;
      end: Date;
      allDay: boolean;
      location?: string;
      description?: string;
    }[] = [];

    for (const vevent of vevents) {
      try {
        const ev = new ICAL.Event(vevent);
        const uid = ev.uid || `${calName}-${ev.summary}-${ev.startDate}`;
        const dtstart = ev.startDate;
        const dtend = ev.endDate ?? ev.startDate;

        const allDay = dtstart.isDate;
        const start = dtstart.toJSDate();
        const end = dtend.toJSDate();

        // For all-day events end is exclusive in ICS, keep as-is
        eventsToCreate.push({
          uid,
          title: ev.summary || "(No title)",
          start,
          end,
          allDay,
          location: ev.location || undefined,
          description: ev.description || undefined,
        });
      } catch {
        // skip malformed events
      }
    }

    // Upsert calendar (replace if same filename)
    const existing = await prisma.importedCalendar.findFirst({
      where: { fileName: file.name },
    });

    if (existing) {
      // Delete old events and re-import
      await prisma.importedCalEvent.deleteMany({ where: { calendarId: existing.id } });
      await prisma.importedCalEvent.createMany({
        data: eventsToCreate.map((e) => ({ calendarId: existing.id, ...e })),
      });
      await prisma.importedCalendar.update({
        where: { id: existing.id },
        data: { name: calName, color, importedAt: new Date() },
      });
    } else {
      const cal = await prisma.importedCalendar.create({
        data: { name: calName, color, fileName: file.name },
      });
      await prisma.importedCalEvent.createMany({
        data: eventsToCreate.map((e) => ({ calendarId: cal.id, ...e })),
      });
    }

    results.push({ name: calName, count: eventsToCreate.length });
  }

  return NextResponse.json({ imported: results }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.importedCalendar.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
