import { parseHours, type OpenInterval } from "./hours";

export type PriceTier = 1 | 2 | 3 | 4;

/** One entry from data/restaurants.txt, with the fixed fields parsed. */
export interface SourceRestaurant {
  id: number;
  name: string;
  address: string;
  city: string;
  cuisines: string[];
  priceTier: PriceTier;
  hoursText: string;
  hours: OpenInterval[];
  context: string;
}

const ENTRY_HEADER = /^(\d+)\. (.+)$/;

/**
 * Parses the brief's restaurant file. Entries are blank-line separated blocks:
 * "N. Name", address, then "Cuisine:", "Price:", "Hours:", "Context:" lines,
 * where Context may wrap across several lines.
 */
export function parseRestaurantFile(text: string): SourceRestaurant[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim().split("\n"))
    .filter((lines) => ENTRY_HEADER.test(lines[0]))
    .map(parseEntry);
}

function parseEntry(lines: string[]): SourceRestaurant {
  const [, idText, name] = ENTRY_HEADER.exec(lines[0])!;
  const address = lines[1].trim();
  const field = (label: string) => readField(lines, label, name);
  const hoursText = field("Hours");

  return {
    id: Number(idText),
    name,
    address,
    city: cityFromAddress(address, name),
    cuisines: field("Cuisine").split(",").map((cuisine) => cuisine.trim()),
    priceTier: parsePriceTier(field("Price"), name),
    hoursText,
    hours: parseHours(hoursText),
    context: field("Context"),
  };
}

/** Reads "Label: value", joining any continuation lines up to the next labeled line. */
function readField(lines: string[], label: string, entryName: string): string {
  const start = lines.findIndex((line) => line.startsWith(`${label}:`));
  if (start === -1) throw new Error(`"${entryName}" is missing ${label}`);
  const valueLines = [lines[start].slice(label.length + 1)];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Z][a-z]+:/.test(line)) break;
    valueLines.push(line);
  }
  return valueLines.map((line) => line.trim()).join(" ");
}

/** "1832 W 1st St, Santa Ana, CA 92703" -> "Santa Ana" */
function cityFromAddress(address: string, entryName: string): string {
  const parts = address.split(", ");
  if (parts.length !== 3) throw new Error(`Unexpected address format for "${entryName}": ${address}`);
  return parts[1];
}

function parsePriceTier(price: string, entryName: string): PriceTier {
  if (!/^\${1,4}$/.test(price)) throw new Error(`Unexpected price "${price}" for "${entryName}"`);
  return price.length as PriceTier;
}
