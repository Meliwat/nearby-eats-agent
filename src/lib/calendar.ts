const MAX_LINE_OCTETS = 75;
const LOS_ANGELES = "America/Los_Angeles";

/** Definition of the TZID the event uses (US Pacific rules since 2007), so every calendar app agrees on the time. */
const LOS_ANGELES_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${LOS_ANGELES}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0800",
  "TZOFFSETTO:-0700",
  "TZNAME:PDT",
  "DTSTART:20070311T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0800",
  "TZNAME:PST",
  "DTSTART:20071104T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** Builds a one-event iCalendar (.ics) file for a restaurant visit in local restaurant time. */
export function buildVisitIcs(visit: {
  restaurant: string;
  address: string;
  description: string;
  /** "2026-10-16" */
  date: string;
  /** "19:00" */
  time: string;
  timeZone: string;
  uid: string;
  now: Date;
}): string {
  const start = `${visit.date.replaceAll("-", "")}T${visit.time.replace(":", "")}00`;
  const stamp = visit.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nearby//Restaurant pick//EN",
    ...(visit.timeZone === LOS_ANGELES ? LOS_ANGELES_VTIMEZONE : []),
    "BEGIN:VEVENT",
    `UID:${visit.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${visit.timeZone}:${start}`,
    "DURATION:PT1H30M",
    `SUMMARY:${escapeText(`Eat at ${visit.restaurant}`)}`,
    `LOCATION:${escapeText(visit.address)}`,
    `DESCRIPTION:${escapeText(visit.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(foldLine)
    .join("\r\n");
}

/** RFC 5545 text escaping: backslash, semicolon, comma, and newlines. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding: lines longer than 75 octets continue on the next line after a space. */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= MAX_LINE_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1; // continuation lines start with a space
    if (new TextEncoder().encode(current + char).length > limit) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}
