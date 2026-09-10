// GET  /api/postings  -> all student postings, newest first, PUBLIC-SAFE FIELDS ONLY
// POST /api/postings  -> a student's new "looking for a tutor" posting, with a
//                        generated code like ST01, ST02, ...
//
// Requires environment variables (set them in your hosting provider's dashboard,
// never in this file): AIRTABLE_PAT, AIRTABLE_BASE_ID
// See ../README.md for the exact Airtable table/field setup this expects.
//
// PRIVACY: StudentNickname, LineID and Phone are all collected for internal use only
// and are deliberately left OUT of the whitelist below — none of them are ever sent
// back to the public site, only visible by opening the Airtable base directly.

const TABLE = 'Postings';

async function airtableFetch(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

module.exports = async function handler(req, res) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const token = process.env.AIRTABLE_PAT;

  if (!baseId || !token) {
    return res.status(500).json({ error: 'Server missing AIRTABLE_BASE_ID / AIRTABLE_PAT' });
  }

  const jsonHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    try {
      const url =
        `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}` +
        `?sort[0][field]=CreatedAt&sort[0][direction]=desc&maxRecords=100`;

      const { ok, status, data } = await airtableFetch(url, { headers: jsonHeaders });
      if (!ok) return res.status(status).json(data);

      // Whitelist only what the public site is allowed to see.
      const postings = (data.records || []).map((rec) => ({
        id: rec.id,
        PostCode: rec.fields.PostCode,
        Subject: rec.fields.Subject,
        Level: rec.fields.Level,
        Budget: rec.fields.Budget,
        Format: rec.fields.Format,
        Detail: rec.fields.Detail,
      }));
      return res.status(200).json({ postings });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch postings' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { subject, level, budget, format, detail, nickname, lineId, phone } = body;

      if (!subject || !level || !budget || !format || !nickname || !lineId) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const createUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}`;
      const createRes = await airtableFetch(createUrl, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          fields: {
            Subject: String(subject).slice(0, 200),
            Level: String(level).slice(0, 200),
            Budget: String(budget).slice(0, 100),
            Format: String(format).slice(0, 100),
            Detail: String(detail || 'ไม่ระบุรายละเอียดเพิ่มเติม').slice(0, 2000),
            StudentNickname: String(nickname).slice(0, 100),
            LineID: String(lineId).slice(0, 100),
            Phone: phone ? String(phone).slice(0, 100) : undefined,
          },
        }),
      });
      if (!createRes.ok) return res.status(createRes.status).json(createRes.data);

      const recordId = createRes.data.id;
      const seqNum = createRes.data.fields.SeqNum;
      const postCode = 'ST' + String(seqNum).padStart(2, '0');

      const patchUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}/${recordId}`;
      const patchRes = await airtableFetch(patchUrl, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ fields: { PostCode: postCode } }),
      });

      // The posting itself already succeeded at this point — a code-patch hiccup
      // isn't worth failing the whole submission over, unlike the tutor flow.
      return res.status(200).json({ ok: true, id: recordId, code: patchRes.ok ? postCode : null });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to submit posting' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
};
