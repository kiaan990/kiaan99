import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // Fetch ICS-imported events from DB (always available)
  const importedCals = await prisma.importedCalendar.findMany({
    include: { events: true },
  });

  const importedEvents = importedCals.flatMap((cal) =>
    cal.events.map((e) => ({
      id: `ics-${e.id}`,
      title: e.title,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
      allDay: e.allDay,
      location: e.location ?? undefined,
      calendarName: cal.name,
      calendarColor: cal.color,
    }))
  );

  // If Apple credentials not configured, return only ICS events
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_PASS) {
    return NextResponse.json({ events: importedEvents });
  }

  try {
    const { fetchCalendarEvents } = await import("@/lib/caldav");
    const caldavEvents = await fetchCalendarEvents(14); // 2 weeks ahead

    const serialized = caldavEvents.map((e) => ({
      ...e,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
    }));

    return NextResponse.json({ events: [...serialized, ...importedEvents] });
  } catch (error) {
    console.error("[Calendar] Error:", error);
    // Still return ICS events even if CalDAV fails
    return NextResponse.json({ events: importedEvents });
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_PASS) {
    return NextResponse.json({ error: "unconfigured" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { createCalendarEvent } = await import("@/lib/caldav");

    await createCalendarEvent({
      title: body.title,
      start: new Date(body.start),
      end: new Date(body.end),
      allDay: body.allDay ?? false,
      notes: body.notes,
      location: body.location,
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
