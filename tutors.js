// GET  /api/tutors   -> list of Approved tutors, for the public site
// POST /api/tutors   -> a tutor's application, saved to Airtable with Status = "Pending"
//
// Requires environment variables (set them in your hosting provider's dashboard,
// never in this file): AIRTABLE_PAT, AIRTABLE_BASE_ID
// See ../README.md for the exact Airtable table/field setup this expects.

const TABLE = 'Tutors';

export default async function handler(req, res) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const token = process.env.AIRTABLE_PAT;

  if (!baseId || !token) {
    return res.status(500).json({ error: 'Server missing AIRTABLE_BASE_ID / AIRTABLE_PAT' });
  }

  if (req.method === 'GET') {
    try {
      const formula = encodeURIComponent("{Status}='Approved'");
      const url =
        `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}` +
        `?filterByFormula=${formula}&sort[0][field]=CreatedAt&sort[0][direction]=desc`;

      const airtableRes = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await airtableRes.json();
      if (!airtableRes.ok) {
        return res.status(airtableRes.status).json(data);
      }

      const tutors = (data.records || []).map((rec) => ({ id: rec.id, ...rec.fields }));
      return res.status(200).json({ tutors });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch tutors' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { name, phone, subject, rate, education, bio } = body;

      if (!name || !phone || !subject || !rate || !education || !bio) {
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
            Name: String(name).slice(0, 200),
            Phone: String(phone).slice(0, 100),
            Subject: String(subject).slice(0, 200),
            Rate: Number(rate) || 0,
            Education: String(education).slice(0, 300),
            Bio: String(bio).slice(0, 2000),
            Status: 'Pending', // tutor never sets this themselves — always starts Pending
          },
        }),
      });
      const data = await airtableRes.json();
      if (!airtableRes.ok) {
        return res.status(airtableRes.status).json(data);
      }
      return res.status(200).json({ ok: true, id: data.id });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to submit application' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
}
