const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const TO_EMAIL = 'apexwebredesign@gmail.com';
const FROM_EMAIL = 'Apexwebdesign <poptavka@apexwebdesign.cz>';
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'heic',
  'heif',
  'zip'
]);

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8'
};

export async function onRequest({ request, env = {} }) {
  if (request.method !== 'POST') {
    return json({ error: 'Endpoint přijímá pouze POST request.' }, 405, {
      Allow: 'POST'
    });
  }

  if (!env.RESEND_API_KEY) {
    return json({ error: 'Chybí nastavení e-mailové služby.' }, 500);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (error) {
    return json({ error: 'Formulář se nepodařilo zpracovat.' }, 400);
  }

  const name = readField(formData, 'name', 120);
  const contact = readField(formData, 'contact', 180);
  const company = readField(formData, 'company', 180);
  const need = readField(formData, 'need', 160);
  const hasWebsite = readField(formData, 'hasWebsite', 40);
  const message = readField(formData, 'message', 4000);
  const currentUrl = readField(formData, 'current_url', 300);
  const budget = readField(formData, 'budget', 100);
  let attachmentData;

  if (!name || !contact || !message) {
    return json({ error: 'Vyplňte prosím jméno, e-mail nebo telefon a zprávu.' }, 400);
  }

  try {
    attachmentData = await readAttachments(formData);
  } catch (error) {
    return json({ error: error.message }, 400);
  }

  const replyTo = extractEmail(contact);
  const rows = [
    ['Jméno', name],
    ['Kontakt', contact],
    ['Firma nebo značka', company],
    ['Co potřebuje', need],
    ['Má aktuální web', hasWebsite],
    ['Aktuální web', currentUrl],
    ['Rozpočet', budget],
    ['Přílohy', attachmentData.labels.join('\n')],
    ['Představa klienta', message]
  ].filter(([, value]) => value);

  const payload = {
    from: FROM_EMAIL,
    to: [TO_EMAIL],
    subject: `Nová poptávka: ${sanitizeSubject(name)}`,
    html: buildHtml(rows),
    text: buildText(rows)
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  if (attachmentData.attachments.length) {
    payload.attachments = attachmentData.attachments;
  }

  try {
    const resendResponse = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resendResponse.ok) {
      return json({ error: 'E-mail se nepodařilo odeslat. Zkuste to prosím znovu.' }, 502);
    }

    return json({ success: true });
  } catch (error) {
    return json({ error: 'E-mailová služba je momentálně nedostupná.' }, 502);
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...extraHeaders
    }
  });
}

function readField(formData, key, maxLength) {
  const value = formData.get(key);
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

async function readAttachments(formData) {
  const files = formData.getAll('attachments').filter(isUploadedFile).filter(file => file.size > 0);

  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`Nahrajte prosím maximálně ${MAX_ATTACHMENTS} souborů.`);
  }

  let totalBytes = 0;
  const attachments = [];
  const labels = [];

  for (const file of files) {
    const filename = sanitizeFilename(file.name);

    if (!isAllowedAttachment(filename)) {
      throw new Error(`Soubor ${filename} nemá podporovaný formát. Nahrajte PDF, PNG, JPG, WEBP, HEIC nebo ZIP.`);
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Soubor ${filename} je moc velký. Jeden soubor může mít maximálně ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
    }

    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error(`Přílohy jsou moc velké. Celkem mohou mít maximálně ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}.`);
    }

    attachments.push({
      filename,
      content: arrayBufferToBase64(await file.arrayBuffer())
    });
    labels.push(`${filename} (${formatBytes(file.size)})`);
  }

  return { attachments, labels };
}

function isUploadedFile(value) {
  return value
    && typeof value === 'object'
    && typeof value.name === 'string'
    && typeof value.size === 'number'
    && typeof value.arrayBuffer === 'function';
}

function sanitizeFilename(value) {
  const filename = value
    .replace(/[\\/\0\r\n\t]/g, '_')
    .replace(/["<>]/g, '')
    .trim()
    .slice(0, 120);

  return filename || 'priloha';
}

function isAllowedAttachment(filename) {
  const extension = filename.split('.').pop().toLowerCase();
  return ALLOWED_ATTACHMENT_EXTENSIONS.has(extension);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function extractEmail(value) {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function sanitizeSubject(value) {
  return value
    .replace(/[<>]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlWithBreaks(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function buildHtml(rows) {
  const tableRows = rows.map(([label, value]) => `
    <tr>
      <th style="text-align:left;vertical-align:top;padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#4b5563;width:180px;">${escapeHtml(label)}</th>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;">${escapeHtmlWithBreaks(value)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="cs">
  <body style="margin:0;padding:24px;background:#f7f7f5;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="padding:22px 24px;background:#0e1217;color:#ffffff;">
        <h1 style="margin:0;font-size:22px;line-height:1.25;">Nová poptávka z webu Apexwebdesign</h1>
      </div>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.5;">
        ${tableRows}
      </table>
    </div>
  </body>
</html>`;
}

function buildText(rows) {
  return rows.map(([label, value]) => `${label}: ${value}`).join('\n\n');
}
