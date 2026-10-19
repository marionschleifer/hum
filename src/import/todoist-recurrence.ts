import { weekdays, type Recurrence, type Weekday } from "../recurrence/recurrence.ts";

export function parseTodoistRecurrence(dueString: string): Recurrence {
  const original = dueString.trim();
  const text = original
    .toLowerCase()
    .replace(/^every!/, "every")
    .replace(/\b(starting|from|until|for|ending)\b.*$/, "")
    .replace(/\s+at\s+.*$/, "")
    .replace(/\s+\d{1,2}(:\d{2})?\s*(am|pm)?$/, "")
    .trim();
  return interval(text) ?? monthly(text) ?? days(text) ?? { kind: "unparsed", text: original };
}

const UNIT_WORDS: Record<string, "day" | "week" | "month"> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
};

const DAY_NAMES: Record<string, Weekday> = {
  mon: "mon",
  monday: "mon",
  tue: "tue",
  tues: "tue",
  tuesday: "tue",
  wed: "wed",
  wednesday: "wed",
  thu: "thu",
  thur: "thu",
  thurs: "thu",
  thursday: "thu",
  fri: "fri",
  friday: "fri",
  sat: "sat",
  saturday: "sat",
  sun: "sun",
  sunday: "sun",
};

function interval(text: string): Recurrence | undefined {
  const word = UNIT_WORDS[text];
  if (word) return { kind: "every", interval: 1, unit: word };
  const match = /^every\s+(other\s+|\d+\s+)?(day|week|month)s?$/.exec(text);
  if (!match) return undefined;
  const amount = match[1]?.trim();
  const count = amount === "other" ? 2 : amount ? Number(amount) : 1;
  return { kind: "every", interval: count, unit: match[2] as "day" | "week" | "month" };
}

const POSITIONS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, last: -1 };

function monthly(text: string): Recurrence | undefined {
  const workday = /^every\s+(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+(?:workday|working day|weekday|business day)(?:\s+of\s+the\s+month)?$/.exec(text);
  if (workday) return { kind: "monthly", workday: POSITIONS[workday[1]!]! };
  if (/^every\s+last\s+day(?:\s+of\s+the\s+month)?$/.test(text)) return { kind: "monthly", day: -1 };
  const day =
    /^every\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+the\s+month)?$/.exec(text) ??
    /^every\s+month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?$/.exec(text) ??
    /^monthly\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?$/.exec(text);
  const value = day ? Number(day[1]) : 0;
  return value >= 1 && value <= 31 ? { kind: "monthly", day: value } : undefined;
}

function days(text: string): Recurrence | undefined {
  const match = /^every\s+(.+)$/.exec(text);
  if (!match) return undefined;
  const body = match[1]!;
  if (body === "weekday" || body === "workday") return { kind: "weekdays", days: ["mon", "tue", "wed", "thu", "fri"] };
  if (body === "weekend") return { kind: "weekdays", days: ["sat", "sun"] };
  const parts = body.split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean);
  const found = parts.map((part) => DAY_NAMES[part]);
  if (found.length === 0 || found.some((day) => day === undefined)) return undefined;
  return { kind: "weekdays", days: weekdays.filter((day) => found.includes(day)) };
}
