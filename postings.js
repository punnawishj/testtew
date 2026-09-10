// GET  /api/postings  -> all student postings, newest first (no approval needed)
// POST /api/postings  -> a student's new "looking for a tutor" posting
//
// Requires environment variables (set them in your hosting provider's dashboard,
// never in this file): AIRTABLE_PAT, AIRTABLE_BASE_ID
// See ../README.md for the exact Airtable table/field setup this expects.

const TABLE = 'Postings';

module.exports = async function handler(req, res) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const token = process.env.AIRTABLE_PAT;

  if (!baseId || !token) {
    return res.status(500).json({ error: 'Server missing AIRTABLE_BASE_ID / AIRTABLE_PAT' });
  }

  if (req.method === 'GET') {
    try {
      const url =
        `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}` +
        `?sort[0][field]=CreatedAt&sort[0][direction]=desc&maxRecords=100`;

      const airtableRes = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await airtableRes.json();
      if (!airtableRes.ok) {
        return res.status(airtableRes.status).json(data);
      }

      const postings = (data.records || []).map((rec) => ({ id: rec.id, ...rec.fields }));
      return res.status(200).json({ postings });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch postings' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { subject, level, budget, format, detail } = body;

      if (!subject || !level || !budget || !format) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}`;
      const airtableRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            Subject: String(subject).slice(0, 200),
            Level: String(level).slice(0, 200),
            Budget: String(budget).slice(0, 100),
            Format: String(format).slice(0, 100),
            Detail: String(detail || 'ไม่ระบุรายละเอียดเพิ่มเติม').slice(0, 2000),
          },
        }),
      });
      const data = await airtableRes.json();
      if (!airtableRes.ok) {
        return res.status(airtableRes.status).json(data);
      }
      return res.status(200).json({ ok: true, id: data.id });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to submit posting' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
};
