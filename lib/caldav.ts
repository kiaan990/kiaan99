/**
 * iCloud CalDAV integration using tsdav
 * Connects to both Calendar and Reminders (for Apple Reminders sync)
 *
 * Required env vars:
 *   APPLE_ID         - your Apple ID email
 *   APPLE_APP_PASS   - app-specific password from appleid.apple.com
 */

import { DAVClient, DAVObject } from "tsdav";
import ICAL from "ical.js";

// tsdav types some fields as `string | Record<string, unknown>` — coerce safely
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface CalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  notes?: string;
  calendarName: string;
  calendarColor: string;
  url: string; // needed for updates/deletes
  etag: string;
}

function parseIcalDate(dtStr: string): Date {
  // Handle both DATE and DATE-TIME values
  if (dtStr.length === 8) {
    const y = parseInt(dtStr.slice(0, 4));
    const m = parseInt(dtStr.slice(4, 6)) - 1;
    const d = parseInt(dtStr.slice(6, 8));
    return new Date(y, m, d);
  }
  return new Date(dtStr);
}

function extractEventsFromObjects(
  objects: DAVObject[],
  calendarName: string,
  calendarColor: string
): CalEvent[] {
  const events: CalEvent[] = [];

  for (const obj of objects) {
    if (!obj.data) continue;
    try {
      const jcal = ICAL.parse(obj.data as string);
      const comp = new ICAL.Component(jcal);
      const vevents = comp.getAllSubcomponents("vevent");

      for (const vevent of vevents) {
        const event = new ICAL.Event(vevent);
        const dtstart = event.startDate;
        const dtend = event.endDate;

        events.push({
          id: event.uid || obj.url || "",
          title: event.summary || "Untitled",
          start: dtstart.toJSDate(),
          end: dtend.toJSDate(),
          allDay: dtstart.isDate,
          location: String(vevent.getFirstPropertyValue("location") ?? "") || undefined,
          notes: String(vevent.getFirstPropertyValue("description") ?? "") || undefined,
          calendarName,
          calendarColor,
          url: obj.url ?? "",
          etag: obj.etag ?? "",
        });
      }
    } catch {
      // Skip malformed iCal objects
    }
  }

  return events;
}

async function getClient(): Promise<DAVClient> {
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_PASS) {
    throw new Error("APPLE_ID and APPLE_APP_PASS environment variables are required");
  }

  const client = new DAVClient({
    serverUrl: "https://caldav.icloud.com",
    credentials: {
      username: process.env.APPLE_ID,
      password: process.env.APPLE_APP_PASS,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  await client.login();
  return client;
}

export async function fetchCalendarEvents(
  daysAhead = 30
): Promise<CalEvent[]> {
  const client = await getClient();
  const calendars = await client.fetchCalendars();

  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const past = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

  const allEvents: CalEvent[] = [];

  for (const calendar of calendars) {
    // Skip Reminders calendars here (handled separately)
    if (str(calendar.displayName).toLowerCase().includes("reminder")) continue;

    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: {
        start: past.toISOString(),
        end: future.toISOString(),
      },
    });

    const color = (calendar as { calendarColor?: string }).calendarColor ?? "#f59e0b";
    const name = str(calendar.displayName) || "Calendar";
    const events = extractEventsFromObjects(objects, name, color);
    allEvents.push(...events);
  }

  return allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function createCalendarEvent(params: {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  notes?: string;
  location?: string;
}): Promise<void> {
  const client = await getClient();
  const calendars = await client.fetchCalendars();

  // Use the first non-Reminders calendar
  const targetCal = calendars.find(
    (c) => !str(c.displayName).toLowerCase().includes("reminder")
  );
  if (!targetCal) throw new Error("No writable calendar found");

  const uid = `${Date.now()}-dashboard@kiaan`;
  const now = new Date();

  const formatDT = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kiaan Dashboard//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatDT(now)}`,
    params.allDay
      ? `DTSTART;VALUE=DATE:${params.start.toISOString().slice(0, 10).replace(/-/g, "")}`
      : `DTSTART:${formatDT(params.start)}`,
    params.allDay
      ? `DTEND;VALUE=DATE:${params.end.toISOString().slice(0, 10).replace(/-/g, "")}`
      : `DTEND:${formatDT(params.end)}`,
    `SUMMARY:${params.title}`,
    params.notes ? `DESCRIPTION:${params.notes}` : "",
    params.location ? `LOCATION:${params.location}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  await client.createCalendarObject({
    calendar: targetCal,
    filename: `${uid}.ics`,
    iCalString: ical,
  });
}

// Apple Reminders via CalDAV (VTODO components)
export interface AppleReminder {
  id: string;
  title: string;
  completed: boolean;
  dueDate?: Date;
  priority: number; // 0=none, 1-4=high, 5=medium, 6-9=low
  notes?: string;
  url: string;
  etag: string;
}

export async function fetchAppleReminders(): Promise<AppleReminder[]> {
  const client = await getClient();
  const calendars = await client.fetchCalendars();

  const reminderCals = calendars.filter((c) =>
    (c.components as string[] | undefined)?.includes("VTODO")
  );

  const reminders: AppleReminder[] = [];

  for (const cal of reminderCals) {
    const objects = await client.fetchCalendarObjects({ calendar: cal });

    for (const obj of objects) {
      if (!obj.data) continue;
      try {
        const jcal = ICAL.parse(obj.data as string);
        const comp = new ICAL.Component(jcal);
        const vtodos = comp.getAllSubcomponents("vtodo");

        for (const vtodo of vtodos) {
          const due = vtodo.getFirstPropertyValue("due");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const val = (key: string) => String((vtodo.getFirstPropertyValue(key) as any) ?? "");
          reminders.push({
            id: val("uid") || obj.url || "",
            title: val("summary") || "Reminder",
            completed: val("status") === "COMPLETED",
            dueDate: due ? new Date(due.toString()) : undefined,
            priority: Number(val("priority")) || 0,
            notes: val("description") || undefined,
            url: obj.url ?? "",
            etag: obj.etag ?? "",
          });
        }
      } catch {
        // Skip malformed objects
      }
    }
  }

  return reminders;
}
