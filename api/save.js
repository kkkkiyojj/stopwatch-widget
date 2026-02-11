export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  try {
    const { subject, minutes } = req.body || {};

    // basic validation
    if (!subject || typeof subject !== "string") {
      return res.status(400).json({ ok: false, error: "invalid subject" });
    }
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
      return res.status(400).json({ ok: false, error: "invalid minutes" });
    }

    const notionToken = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;

    if (!notionToken || !databaseId) {
      return res.status(500).json({ ok: false, error: "missing env" });
    }

    // today range in Asia/Seoul (yyyy-mm-dd)
    const today = getKSTDateString(0);
    const tomorrow = getKSTDateString(1);

    // 1) find today's row by (day within today range AND subject equals selected)
    // NOTE: we use a range filter so it still matches if "day" contains time.
    const queryBody = {
      filter: {
        and: [
          { property: "day", date: { on_or_after: today } },
          { property: "day", date: { before: tomorrow } },
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
    if (!q.ok) {
      return res.status(500).json({ ok: false, error: "notion query failed", detail: qJson });
    }

    const page = (qJson.results || [])[0];
    if (!page) {
      // spec: do not create new row
      return res.status(404).json({ ok: false, error: "row not found" });
    }

    // 2) current focus minutes
    const current = page?.properties?.focus?.number;
    const currentNum = typeof current === "number" && Number.isFinite(current) ? current : 0;

    // 3) update focus by adding minutes (accumulate)
    const addMinutes = Math.floor(minutes);
    const newFocus = currentNum + addMinutes;

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
    if (!u.ok) {
      return res.status(500).json({ ok: false, error: "notion update failed", detail: uJson });
    }

    return res.status(200).json({
      ok: true,
      saved_minutes: addMinutes,
      new_focus: newFocus,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server error" });
  }
}

function notionHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "Notion-Version": "2022-06-28",
  };
}

// Returns yyyy-mm-dd in Asia/Seoul, optionally addDays (0=today, 1=tomorrow)
function getKSTDateString(addDays = 0) {
  const dt = new Date(Date.now() + addDays * 24 * 60 * 60 * 1000);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;

  return `${y}-${m}-${d}`;
}
