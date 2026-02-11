export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const startedAt = Date.now();

  try {
    const { subject, minutes } = req.body || {};

    if (!subject || typeof subject !== "string") {
      return res.status(400).json({ ok: false, error: "invalid subject" });
    }
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
      return res.status(400).json({ ok: false, error: "invalid minutes" });
    }

    const notionToken = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;

    if (!notionToken || !databaseId) {
      console.error("missing env", { hasToken: !!notionToken, hasDb: !!databaseId });
      return res.status(500).json({ ok: false, error: "missing env" });
    }

    const today = getKSTDateString(0);
    const tomorrow = getKSTDateString(1);

    const queryBody = {
      filter: {
        and: [
          { property: "day", date: { on_or_after: today } },
          { property: "day", date: { before: tomorrow } },
        ],
      },
      page_size: 100,
    };

    const qResp = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: notionHeaders(notionToken),
      body: JSON.stringify(queryBody),
    });

    const qText = await qResp.text();
    let qJson = null;
    try { qJson = JSON.parse(qText); } catch {}

    if (!qResp.ok) {
      console.error("notion query failed", {
        status: qResp.status,
        body: qJson || qText,
      });
      return res.status(500).json({
        ok: false,
        error: "notion query failed",
        status: qResp.status,
      });
    }

    const results = Array.isArray(qJson?.results) ? qJson.results : [];
    if (results.length === 0) {
      return res.status(404).json({ ok: false, error: "no rows for today" });
    }

    const target = normalize(subject);

    const page = results.find((p) => normalize(p?.properties?.subject?.select?.name) === target);

    if (!page) {
      const available = results
        .map((p) => p?.properties?.subject?.select?.name)
        .filter(Boolean)
        .map(String);
      return res.status(404).json({ ok: false, error: "row not found", available_subjects: available });
    }

    const current = page?.properties?.focus?.number;
    const currentNum = typeof current === "number" && Number.isFinite(current) ? current : 0;

    const addMinutes = Math.floor(minutes);
    const newFocus = currentNum + addMinutes;

    const uResp = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
      method: "PATCH",
      headers: notionHeaders(notionToken),
      body: JSON.stringify({
        properties: { focus: { number: newFocus } },
      }),
    });

    const uText = await uResp.text();
    let uJson = null;
    try { uJson = JSON.parse(uText); } catch {}

    if (!uResp.ok) {
      console.error("notion update failed", {
        status: uResp.status,
        body: uJson || uText,
      });
      return res.status(500).json({
        ok: false,
        error: "notion update failed",
        status: uResp.status,
      });
    }

    return res.status(200).json({
      ok: true,
      saved_minutes: addMinutes,
      new_focus: newFocus,
      ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("server error", e);
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

function normalize(s) {
  return String(s ?? "").trim();
}

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
