const NUMBER = String.raw`(\d+(?:[.,]\d+)?|[.,]\d+)`;
const HOURS_ONLY = new RegExp(String.raw`^${NUMBER}\s*(?:h|hr|hrs|hours?)?$`);
const MINUTES_ONLY = new RegExp(String.raw`^(\d+)\s*(?:m|min|mins|minutes?)$`);
const HOURS_AND_MINUTES = new RegExp(String.raw`^(\d+)\s*(?:h|hr|hrs|hours?)\s*(\d+)\s*(?:m|min|mins|minutes?)?$`);
const CLOCK = /^(\d+):([0-5]\d)$/;

export function parseDuration(text: string): number | undefined {
  const input = text.trim().toLowerCase();
  if (input === "") return 0;
  const clock = CLOCK.exec(input);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const both = HOURS_AND_MINUTES.exec(input);
  if (both) return Number(both[1]) * 60 + Number(both[2]);
  const minutes = MINUTES_ONLY.exec(input);
  if (minutes) return Number(minutes[1]);
  const hours = HOURS_ONLY.exec(input);
  if (hours) return Math.round(Number(hours[1]!.replace(",", ".")) * 60);
  return undefined;
}
