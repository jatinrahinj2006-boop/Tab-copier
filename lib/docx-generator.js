/**
 * docx-generator.js
 * Generates a valid .docx (OOXML) file with clickable hyperlinks.
 * Works in popup window and background service worker.
 */

function escXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function generateDocx(tabs, outputType = 'blob', numbered = true) {
  const _JSZip = (typeof JSZip !== 'undefined' && JSZip) ||
                 (typeof self !== 'undefined' && self.JSZip) ||
                 (typeof window !== 'undefined' && window.JSZip) ||
                 (typeof globalThis !== 'undefined' && globalThis.JSZip);

  if (!_JSZip) throw new Error('JSZip is not available');

  const zip   = new _JSZip();
  const ts    = new Date().toLocaleString();
  const count = tabs.length;

  // ─── [Content_Types].xml ─────────────────────────────────────────────────
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

  // ─── _rels/.rels ─────────────────────────────────────────────────────────
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`);

  // ─── word/styles.xml ─────────────────────────────────────────────────────
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
        <w:sz w:val="22"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="360" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="44"/>
      <w:color w:val="2F5496"/>
    </w:rPr>
  </w:style>

  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr>
      <w:color w:val="0563C1"/>
      <w:u w:val="single"/>
    </w:rPr>
  </w:style>
</w:styles>`);

  // ─── word/_rels/document.xml.rels ────────────────────────────────────────
  const relEntries = [
    `  <Relationship Id="rId0"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>`
  ];
  tabs.forEach((tab, i) => {
    relEntries.push(
      `  <Relationship Id="rId${i + 1}"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
    Target="${escXml(tab.url)}"
    TargetMode="External"/>`
    );
  });

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relEntries.join('\n')}
</Relationships>`);

  // ─── word/document.xml ───────────────────────────────────────────────────
  const paragraphs = tabs.map((tab, i) => {
    const numPrefix = numbered ? `${i + 1}. ` : '';
    const safeTitle = escXml(numPrefix + (tab.title || tab.url));
    const safeUrl   = escXml(tab.url);
    const incogNote = tab.incognito ? ' [incognito]' : '';
    return `
    <w:p>
      <w:hyperlink r:id="rId${i + 1}" w:history="1">
        <w:r>
          <w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>
          <w:t xml:space="preserve">${safeTitle}${escXml(incogNote)}</w:t>
        </w:r>
      </w:hyperlink>
    </w:p>
    <w:p>
      <w:pPr><w:ind w:left="360"/></w:pPr>
      <w:r>
        <w:rPr><w:color w:val="888888"/><w:sz w:val="18"/></w:rPr>
        <w:t xml:space="preserve">${safeUrl}</w:t>
      </w:r>
    </w:p>`;
  }).join('\n');

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>

    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Tab Links</w:t></w:r>
    </w:p>

    <w:p>
      <w:r>
        <w:rPr><w:color w:val="888888"/><w:sz w:val="18"/></w:rPr>
        <w:t xml:space="preserve">Exported on ${escXml(ts)} · ${count} tab${count !== 1 ? 's' : ''}</w:t>
      </w:r>
    </w:p>

    <w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>

${paragraphs}

    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"
               w:header="720"  w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`);

  return zip.generateAsync({
    type: outputType,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}
