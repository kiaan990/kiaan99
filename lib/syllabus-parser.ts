import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface MeetingTime {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  location: string | null;
}

export interface ParsedGradingComponent {
  name: string;
  weight: number;
  description: string | null;
}

export interface ParsedPolicy {
  category: "late_penalty" | "attendance" | "submission" | "other";
  content: string;
}

export interface ParsedItem {
  title: string;
  type: "assignment" | "reading" | "quiz" | "exam" | "project" | "other";
  dueDateRaw: string | null;
  dueDate: string | null; // ISO date YYYY-MM-DD or null
  weight: number | null;
  description: string | null;
  confidence: "high" | "medium" | "low";
}

export interface ParsedSyllabus {
  course: {
    name: string;
    courseCode: string | null;
    professor: string | null;
    professorEmail: string | null;
    officeHours: string | null;
    meetingTimes: MeetingTime[];
  };
  gradingComponents: ParsedGradingComponent[];
  policies: ParsedPolicy[];
  items: ParsedItem[];
}

interface SemesterContext {
  name: string;
  startDate: Date;
  endDate: Date;
  breaks: { name: string; startDate: Date; endDate: Date }[];
}

const SCHEMA = `{
  "course": {
    "name": "string — full course title",
    "courseCode": "string | null — e.g. 'MG 116'",
    "professor": "string | null — full name",
    "professorEmail": "string | null",
    "officeHours": "string | null — human-readable summary",
    "meetingTimes": [
      {
        "dayOfWeek": "Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Sunday",
        "startTime": "HH:MM in 24-hour format",
        "endTime": "HH:MM in 24-hour format",
        "location": "string | null — building + room"
      }
    ]
  },
  "gradingComponents": [
    {
      "name": "string — e.g. 'Midterm Exam'",
      "weight": "number — FRACTION (0.25 means 25%). Must sum to ~1.0.",
      "description": "string | null"
    }
  ],
  "policies": [
    {
      "category": "late_penalty | attendance | submission | other",
      "content": "string — concise summary of the policy, max 300 chars"
    }
  ],
  "items": [
    {
      "title": "string — assignment/exam/reading name",
      "type": "assignment | reading | quiz | exam | project | other",
      "dueDateRaw": "string | null — EXACT text from syllabus (e.g. 'Week 4, Wednesday' or 'Oct 15')",
      "dueDate": "string | null — resolved ISO date YYYY-MM-DD, or null if unresolvable",
      "weight": "number | null — fraction of grade if explicitly stated, otherwise null",
      "description": "string | null — brief description of the item",
      "confidence": "high (explicit date) | medium (inferred date) | low (guessed or unclear)"
    }
  ]
}`;

export async function parseSyllabus(
  rawText: string,
  semester: SemesterContext | null
): Promise<ParsedSyllabus> {
  const semesterBlock = semester
    ? `
SEMESTER CALENDAR (use this to resolve relative date references):
- Active semester: ${semester.name}
- First day of classes: ${semester.startDate.toISOString().slice(0, 10)} (this is Week 1 start)
- Last day of classes: ${semester.endDate.toISOString().slice(0, 10)}
- Week N starts: add (N-1) × 7 days to the first day of classes
${
  semester.breaks.length > 0
    ? `- Breaks:\n${semester.breaks.map((b) => `  • ${b.name}: ${b.startDate.toISOString().slice(0, 10)} → ${b.endDate.toISOString().slice(0, 10)}`).join("\n")}`
    : ""
}

When resolving relative references:
- "Week 3 Tuesday" → find Tuesday of the 3rd week counting from semester start
- "After spring break" → the Monday after the break ends
- "By class time" → use the meeting day/time for that week
- If you cannot resolve a date confidently, set dueDate to null and confidence to "low"
`
    : `No semester calendar provided. Leave any relative date references (e.g. "Week 4") with dueDate: null and confidence: "low". Use dueDateRaw to preserve the original text.`;

  const system = `You are a precise syllabus parser for a university student dashboard. Extract ALL structured information from the syllabus and return valid JSON only.

${semesterBlock}

CRITICAL RULES:
1. Return ONLY valid JSON — no prose, no markdown, no code fences, no explanation
2. Match the schema EXACTLY — no extra keys, no missing required keys
3. Extract EVERY dated item from the course schedule: assignments, readings, quizzes, exams, projects
4. weights in gradingComponents must be fractions (0.25 = 25%) and should sum to approximately 1.0
5. dueDate must be YYYY-MM-DD format or null — never a partial date
6. If a field value is genuinely unknown, use null (never guess)
7. For confidence: "high" = date was explicit (e.g. "October 15"), "medium" = inferred from context, "low" = guessed or ambiguous

OUTPUT SCHEMA:
${SCHEMA}`;

  const response = await client.messages.create({
    model: "claude-sonnet-5-20251001",
    max_tokens: 8000,
    system,
    messages: [
      {
        role: "user",
        content: `Parse this syllabus and return JSON:\n\n${rawText.slice(0, 80000)}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";

  // Strip any accidental markdown fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  let parsed: ParsedSyllabus;
  try {
    parsed = JSON.parse(cleaned) as ParsedSyllabus;
  } catch {
    throw new Error(`Claude returned invalid JSON. Raw output: ${text.slice(0, 500)}`);
  }

  // Validate required shape
  if (!parsed.course?.name) throw new Error("Parse result missing course.name");
  if (!Array.isArray(parsed.gradingComponents)) throw new Error("Parse result missing gradingComponents array");
  if (!Array.isArray(parsed.items)) throw new Error("Parse result missing items array");
  if (!Array.isArray(parsed.policies)) parsed.policies = [];
  if (!Array.isArray(parsed.course.meetingTimes)) parsed.course.meetingTimes = [];

  // Clamp weights to sane range
  parsed.gradingComponents = parsed.gradingComponents.map((c) => ({
    ...c,
    weight: Math.max(0, Math.min(1, Number(c.weight) || 0)),
  }));

  return parsed;
}
