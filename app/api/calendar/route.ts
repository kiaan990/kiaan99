import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  // Check if Apple credentials are configured
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_PASS) {
    return NextResponse.json(
      {
        error: "unconfigured",
        message: "Set APPLE_ID and APPLE_APP_PASS in .env.local",
        events: [],
      },
      { status: 200 }
    );
  }

  try {
    const { fetchCalendarEvents } = await import("@/lib/caldav");
    const events = await fetchCalendarEvents(14); // 2 weeks ahead

    // Serialize dates for JSON
    const serialized = events.map((e) => ({
      ...e,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
    }));

    return NextResponse.json({ events: serialized });
  } catch (error) {
    console.error("[Calendar] Error:", error);
    return NextResponse.json(
      { error: "fetch_failed", message: String(error), events: [] },
      { status: 200 }
    );
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
