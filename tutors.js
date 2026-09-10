// GET  /api/tutors   -> list of Approved tutors, PUBLIC-SAFE FIELDS ONLY, for the public site
// POST /api/tutors   -> a tutor's application (with ID verification image), saved to Airtable
//                       with Status = "Pending" and a generated code like TT01, TT02, ...
//
// Requires environment variables (set them in your hosting provider's dashboard,
// never in this file): AIRTABLE_PAT, AIRTABLE_BASE_ID
// See ../README.md for the exact Airtable table/field setup this expects.
//
// PRIVACY: Phone, LineID and the IDCardImage attachment are collected for internal
// verification only. The GET handler below explicitly whitelists which fields are
// ever sent back to the browser — never spread `...rec.fields` here, or private
// fields will leak to anyone who calls this endpoint directly.

const TABLE = 'Tutors';

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

  const authHeaders = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    try {
      const formula = encodeURIComponent("{Status}='Approved'");
      const url =
        `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}` +
        `?filterByFormula=${formula}&sort[0][field]=CreatedAt&sort[0][direction]=desc`;

      const { ok, status, data } = await airtableFetch(url, { headers: authHeaders });
      if (!ok) return res.status(status).json(data);

      // Whitelist only what the public site is allowed to see.
      const tutors = (data.records || []).map((rec) => ({
        id: rec.id,
        Name: rec.fields.Name,
        Subject: rec.fields.Subject,
        Rate: rec.fields.Rate,
        Education: rec.fields.Education,
        Bio: rec.fields.Bio,
        TutorCode: rec.fields.TutorCode,
      }));
      return res.status(200).json({ tutors });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch tutors' });
    }
  }

  if (req.method === 'POST') {
    let recordId = null;
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const {
        name, phone, lineId, subject, rate, education, bio,
        idCardBase64, idCardFilename, idCardContentType,
      } = body;

      if (!name || !phone || !lineId || !subject || !rate || !education || !bio || !idCardBase64) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // 1) Create the record (without the code yet — the code is derived from
      //    Airtable's own Autonumber field, which only exists once the row is created).
      const createUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}`;
      const createRes = await airtableFetch(createUrl, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          fields: {
            Name: String(name).slice(0, 200),
            Phone: String(phone).slice(0, 100),
            LineID: String(lineId).slice(0, 100),
            Subject: String(subject).slice(0, 200),
            Rate: Number(rate) || 0,
            Education: String(education).slice(0, 300),
            Bio: String(bio).slice(0, 2000),
            Status: 'Pending', // tutor never sets this themselves — always starts Pending
          },
        }),
      });
      if (!createRes.ok) return res.status(createRes.status).json(createRes.data);

      recordId = createRes.data.id;
      const seqNum = createRes.data.fields.SeqNum;
      const tutorCode = 'TT' + String(seqNum).padStart(2, '0');

      // 2) Write the human-friendly code back onto the record.
      const patchUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}/${recordId}`;
      const patchRes = await airtableFetch(patchUrl, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ fields: { TutorCode: tutorCode } }),
      });
      if (!patchRes.ok) throw new Error('patch_failed');

      // 3) Upload the ID verification image as an attachment on this record.
      //    Airtable's attachment upload endpoint lives on a different host
      //    (content.airtable.com) and takes raw base64 file content directly —
      //    no public URL needed.
      const base64Content = String(idCardBase64).includes(',')
        ? String(idCardBase64).split(',').pop()
        : String(idCardBase64);
      const uploadUrl = `https://content.airtable.com/v0/${baseId}/${recordId}/IDCardImage/uploadAttachment`;
      const uploadRes = await airtableFetch(uploadUrl, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          contentType: idCardContentType || 'image/jpeg',
          file: base64Content,
          filename: idCardFilename || 'id-card.jpg',
        }),
      });
      if (!uploadRes.ok) throw new Error('upload_failed');

      return res.status(200).json({ ok: true, id: recordId, code: tutorCode });
    } catch (err) {
      // Roll back the half-created record so failed submissions don't clutter
      // the approval queue with incomplete profiles.
      if (recordId) {
        try {
          const delUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}/${recordId}`;
          await fetch(delUrl, { method: 'DELETE', headers: authHeaders });
        } catch (cleanupErr) {
          // best-effort cleanup only
        }
      }
      return res.status(500).json({ error: 'Failed to submit application' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
};
