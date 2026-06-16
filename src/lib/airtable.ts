// Minimal Airtable REST client used by the importer and the sync worker.
// Uses returnFieldsByFieldId=true so we key on stable field IDs, not names.

const API = "https://api.airtable.com/v0";

export interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

function authHeaders(): HeadersInit {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) throw new Error("AIRTABLE_PAT is not set");
  return { Authorization: `Bearer ${pat}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch a SINGLE page of records. Returns the page plus the next offset cursor. */
export async function fetchPage(
  tableId: string,
  offset?: string,
  opts: { baseId?: string; pageSize?: number; filterByFormula?: string } = {}
): Promise<{ records: AirtableRecord[]; offset?: string }> {
  const baseId = opts.baseId || process.env.AIRTABLE_BASE_ID;
  if (!baseId) throw new Error("AIRTABLE_BASE_ID is not set");
  const pageSize = opts.pageSize ?? 100;

  const url = new URL(`${API}/${baseId}/${tableId}`);
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("returnFieldsByFieldId", "true");
  if (opts.filterByFormula) url.searchParams.set("filterByFormula", opts.filterByFormula);
  if (offset) url.searchParams.set("offset", offset);

  let res = await fetch(url, { headers: authHeaders() });
  if (res.status === 429) {
    await sleep(1500);
    res = await fetch(url, { headers: authHeaders() });
  }
  if (!res.ok) {
    throw new Error(`Airtable ${tableId} -> ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { records: AirtableRecord[]; offset?: string };
  // Throttle to stay under Airtable's 5 req/sec/base limit.
  await sleep(220);
  return { records: json.records, offset: json.offset };
}

/** List ALL records of a table by following the offset cursor. */
export async function listAllRecords(
  tableId: string,
  opts: { baseId?: string; pageSize?: number; onPage?: (n: number) => void } = {}
): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const page = await fetchPage(tableId, offset, opts);
    all.push(...page.records);
    offset = page.offset;
    opts.onPage?.(all.length);
  } while (offset);
  return all;
}
