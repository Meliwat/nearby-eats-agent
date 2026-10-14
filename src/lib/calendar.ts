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
  ].join("\r\n");
}

/** RFC 5545 text escaping: backslash, semicolon, comma, and newlines. */
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
