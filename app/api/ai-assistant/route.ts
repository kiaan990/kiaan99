import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const SYSTEM_PROMPT = `You are JoeGPT — the personal AI assistant built into this dashboard. You have full control over every part of it:

- **To-Do list**: add, complete, delete tasks
- **Calendar**: add events, read upcoming events
- **GPA tracker**: add/remove courses and grades
- **GoodNotes**: add/remove notebook links
- **Brightspace**: add courses and assignments, mark assignments submitted

You are proactive, concise, and smart. You understand context — if someone says "I have a test Friday", you can add it as a calendar event AND a high-priority task. If they paste a screenshot, extract everything relevant.

Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

When calling tools, batch as many actions as makes sense. Always confirm what you did briefly. Use a natural, direct tone — not robotic.`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const tools: Anthropic.Tool[] = [
  // ── TODOS ──────────────────────────────────────────────────────────
  {
    name: "list_todos",
    description: "Get all current todos",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "create_todos",
    description: "Create one or more tasks in the to-do list",
    input_schema: {
      type: "object" as const,
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              dueDate: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["title", "priority"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "complete_todo",
    description: "Mark a task as complete or incomplete",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        completed: { type: "boolean" },
      },
      required: ["id", "completed"],
    },
  },
  {
    name: "delete_todo",
    description: "Delete a task by id",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },

  // ── CALENDAR ───────────────────────────────────────────────────────
  {
    name: "list_calendar_events",
    description: "Get upcoming calendar events",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "create_calendar_event",
    description: "Add an event to the calendar",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "ISO datetime or YYYY-MM-DD for all-day" },
        end: { type: "string", description: "ISO datetime or YYYY-MM-DD for all-day" },
        allDay: { type: "boolean" },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "start", "end"],
    },
  },

  // ── GPA ────────────────────────────────────────────────────────────
  {
    name: "list_gpa_courses",
    description: "Get all GPA courses and current GPA",
    input_schema: {
      type: "object" as const,
      properties: { semester: { type: "string" } },
    },
  },
  {
    name: "add_gpa_course",
    description: "Add a course to the GPA tracker",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        courseCode: { type: "string" },
        credits: { type: "number" },
        letterGrade: { type: "string", description: "A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F" },
        semester: { type: "string", description: "e.g. Spring 2026" },
      },
      required: ["name", "credits", "letterGrade", "semester"],
    },
  },
  {
    name: "delete_gpa_course",
    description: "Remove a course from the GPA tracker",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },

  // ── GOODNOTES ──────────────────────────────────────────────────────
  {
    name: "list_goodnotes_links",
    description: "Get all GoodNotes notebook links",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "add_goodnotes_link",
    description: "Add a GoodNotes notebook link",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        url: { type: "string", description: "https:// or goodnotes5:// URL" },
        emoji: { type: "string" },
        description: { type: "string" },
      },
      required: ["name", "url"],
    },
  },
  {
    name: "delete_goodnotes_link",
    description: "Remove a GoodNotes link",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },

  // ── BRIGHTSPACE ────────────────────────────────────────────────────
  {
    name: "list_brightspace",
    description: "Get all Brightspace courses and assignments",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "add_brightspace_course",
    description: "Add a Brightspace course",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        courseCode: { type: "string" },
        color: { type: "string", description: "hex color" },
      },
      required: ["name"],
    },
  },
  {
    name: "add_brightspace_assignment",
    description: "Add an assignment to a Brightspace course",
    input_schema: {
      type: "object" as const,
      properties: {
        courseId: { type: "string" },
        title: { type: "string" },
        dueDate: { type: ["string", "null"], description: "ISO datetime or null" },
        status: { type: "string", enum: ["pending", "submitted", "graded", "missing"] },
        weight: { type: "number" },
      },
      required: ["courseId", "title"],
    },
  },
  {
    name: "update_assignment_status",
    description: "Mark an assignment as submitted/pending/missing/graded",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["pending", "submitted", "graded", "missing"] },
        submitted: { type: "boolean" },
      },
      required: ["id", "status"],
    },
  },
];

type RefreshPanel = "todos" | "calendar" | "gpa" | "goodnotes" | "brightspace";

async function executeTool(name: string, input: Record<string, unknown>): Promise<{ result: unknown; refresh?: RefreshPanel }> {
  switch (name) {
    // TODOS
    case "list_todos": {
      const todos = await prisma.todo.findMany({ orderBy: { createdAt: "desc" } });
      return { result: todos.map((t) => ({ ...t, tags: JSON.parse(t.tags) })) };
    }
    case "create_todos": {
      const tasks = input.tasks as { title: string; priority: string; dueDate?: string | null; tags?: string[] }[];
      for (const t of tasks) {
        await prisma.todo.create({
          data: {
            title: t.title,
            priority: t.priority,
            dueDate: t.dueDate ? new Date(t.dueDate) : null,
            tags: JSON.stringify(t.tags ?? []),
          },
        });
      }
      return { result: `Created ${tasks.length} task(s)`, refresh: "todos" };
    }
    case "complete_todo": {
      await prisma.todo.update({ where: { id: input.id as string }, data: { completed: input.completed as boolean } });
      return { result: "Updated", refresh: "todos" };
    }
    case "delete_todo": {
      await prisma.todo.delete({ where: { id: input.id as string } });
      return { result: "Deleted", refresh: "todos" };
    }

    // CALENDAR
    case "list_calendar_events": {
      const cals = await prisma.importedCalendar.findMany({ include: { events: true } });
      const events = cals.flatMap((c) => c.events.map((e) => ({ ...e, calendarName: c.name })));
      return { result: events };
    }
    case "create_calendar_event": {
      if (!process.env.APPLE_ID || !process.env.APPLE_APP_PASS) {
        // Store as ICS event in DB under a "Manual" calendar
        let manualCal = await prisma.importedCalendar.findFirst({ where: { fileName: "__manual__" } });
        if (!manualCal) {
          manualCal = await prisma.importedCalendar.create({ data: { name: "Manual", color: "#c9a84c", fileName: "__manual__" } });
        }
        const start = new Date(input.start as string);
        const end = new Date(input.end as string);
        await prisma.importedCalEvent.create({
          data: {
            calendarId: manualCal.id,
            uid: `manual-${Date.now()}`,
            title: input.title as string,
            start,
            end,
            allDay: (input.allDay as boolean) ?? false,
            location: (input.location as string) ?? null,
            description: (input.notes as string) ?? null,
          },
        });
        return { result: "Event created", refresh: "calendar" };
      }
      const { createCalendarEvent } = await import("@/lib/caldav");
      await createCalendarEvent({
        title: input.title as string,
        start: new Date(input.start as string),
        end: new Date(input.end as string),
        allDay: (input.allDay as boolean) ?? false,
        notes: input.notes as string,
        location: input.location as string,
      });
      return { result: "Event created in iCloud Calendar", refresh: "calendar" };
    }

    // GPA
    case "list_gpa_courses": {
      const semester = input.semester as string | undefined;
      const courses = await prisma.gpaCourse.findMany({ where: semester ? { semester } : {} });
      return { result: courses };
    }
    case "add_gpa_course": {
      const course = await prisma.gpaCourse.create({
        data: {
          name: input.name as string,
          courseCode: (input.courseCode as string) ?? null,
          credits: input.credits as number,
          letterGrade: input.letterGrade as string,
          semester: input.semester as string,
        },
      });
      return { result: course, refresh: "gpa" };
    }
    case "delete_gpa_course": {
      await prisma.gpaCourse.delete({ where: { id: input.id as string } });
      return { result: "Deleted", refresh: "gpa" };
    }

    // GOODNOTES
    case "list_goodnotes_links": {
      const links = await prisma.goodNotesLink.findMany({ orderBy: { sortOrder: "asc" } });
      return { result: links };
    }
    case "add_goodnotes_link": {
      const link = await prisma.goodNotesLink.create({
        data: {
          name: input.name as string,
          url: input.url as string,
          emoji: (input.emoji as string) ?? "📓",
          description: (input.description as string) ?? null,
        },
      });
      return { result: link, refresh: "goodnotes" };
    }
    case "delete_goodnotes_link": {
      await prisma.goodNotesLink.delete({ where: { id: input.id as string } });
      return { result: "Deleted", refresh: "goodnotes" };
    }

    // BRIGHTSPACE
    case "list_brightspace": {
      const courses = await prisma.brightspaceCourse.findMany({ include: { assignments: true } });
      return { result: courses };
    }
    case "add_brightspace_course": {
      const course = await prisma.brightspaceCourse.create({
        data: {
          name: input.name as string,
          courseCode: (input.courseCode as string) ?? null,
          color: (input.color as string) ?? "#f59e0b",
        },
      });
      return { result: course, refresh: "brightspace" };
    }
    case "add_brightspace_assignment": {
      const assignment = await prisma.brightspaceAssignment.create({
        data: {
          courseId: input.courseId as string,
          title: input.title as string,
          dueDate: input.dueDate ? new Date(input.dueDate as string) : null,
          status: (input.status as string) ?? "pending",
          weight: (input.weight as number) ?? null,
        },
      });
      return { result: assignment, refresh: "brightspace" };
    }
    case "update_assignment_status": {
      const assignment = await prisma.brightspaceAssignment.update({
        where: { id: input.id as string },
        data: {
          status: input.status as string,
          submitted: (input.submitted as boolean) ?? input.status === "submitted",
        },
      });
      return { result: assignment, refresh: "brightspace" };
    }

    default:
      return { result: "Unknown tool" };
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your-anthropic-api-key") {
    return NextResponse.json({ error: "unconfigured" }, { status: 400 });
  }

  const formData = await req.formData();
  const message = formData.get("message") as string | null;
  const image = formData.get("image") as File | null;
  const historyRaw = formData.get("history") as string | null;
  const history: Anthropic.MessageParam[] = historyRaw ? JSON.parse(historyRaw) : [];

  const content: Anthropic.ContentBlockParam[] = [];
  if (image) {
    const buffer = Buffer.from(await image.arrayBuffer());
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: buffer.toString("base64"),
      },
    });
  }
  if (message) content.push({ type: "text", text: message });
  if (!content.length) return NextResponse.json({ error: "No input" }, { status: 400 });

  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content }];

  let finalText = "";
  const refreshPanels = new Set<RefreshPanel>();

  // Agentic loop
  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    for (const block of response.content) {
      if (block.type === "text") finalText = block.text;
    }

    if (response.stop_reason !== "tool_use") break;

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tool of toolUseBlocks) {
      const { result, refresh } = await executeTool(tool.name, tool.input as Record<string, unknown>);
      if (refresh) refreshPanels.add(refresh);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  // Strip images from history to keep it lean
  const updatedHistory = messages.map((m) => ({
    ...m,
    content: typeof m.content === "string"
      ? m.content
      : (m.content as Anthropic.ContentBlockParam[]).map((b) =>
          b.type === "image" ? { type: "text", text: "[image]" } : b
        ),
  }));

  return NextResponse.json({
    reply: finalText,
    refreshPanels: Array.from(refreshPanels),
    updatedHistory,
  });
}
