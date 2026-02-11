export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method not allowed" });

  try {
    const { subject, minutes } = req.body || {};
    if (!subject || typeof subject !== "string") return res.status(400).json({ ok: false, error: "invalid subject" });
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
      return res.status(400).json({ ok: false, error: "invalid minutes" });
    }

    const notionToken = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!notionToken || !databaseId) return res.status(500).json({ ok: false, error: "missing env" });

    // today in Asia/Seoul (yyyy-mm-dd)
    const today = getKSTDateString();

    // 1) find today's row by (day == today AND subject == selected)
    const queryBody = {
      filter: {
        and: [
          { property: "day", date: { equals: today } },
          { property: "subject", select: { equals: subject } },
        ],
      },
      page_size: 1,
    };

    const q = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: notionHeaders(notionToken),
      body: JSON.stringify(queryBody),
    });

    const qJson = await q.json();
    if (!q.ok) return res.status(500).json({ ok: false, error: "notion query failed", detail: qJson });

    const page = (qJson.results || [])[0];
    if (!page) {
      // spec: do not create new row
      return res.status(404).json({ ok: false, error: "row not found" });
    }

    // 2) current focus minutes
    const current = page?.properties?.focus?.number;
    const currentNum = typeof current === "number" && Number.isFinite(current) ? current : 0;

    // 3) update focus by adding minutes
    const newFocus = currentNum + Math.floor(minutes);

    const u = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
      method: "PATCH",
      headers: notionHeaders(notionToken),
      body: JSON.stringify({
        properties: {
          focus: { number: newFocus },
        },
      }),
    });

    const uJson = await u.json();
    if (!u.ok) return res.status(500).json({ ok: false, error: "notion update failed", detail: uJson });

    return res.status(200).json({ ok: true, saved_minutes: Math.floor(minutes), new_focus: newFocus });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server error" });
  }
}

function notionHeaders(token) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "Notion-Version": "2022-06-28",
  };
}

function getKSTDateString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return `${y}-${m}-${d}`; // yyyy-mm-dd
}
