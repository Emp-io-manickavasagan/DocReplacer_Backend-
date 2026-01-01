import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { randomUUID } from 'crypto';

// In-memory store for file buffers (for this session/MVP)
// In a real production app, this should be S3 or similar, 
// but requirements said "Upload .docx via multer (memory storage)"
export const fileBufferStore = new Map<string, Buffer>();

export class DocxService {
  async parse(buffer: Buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file("word/document.xml")?.async("string");
    
    if (!docXml) {
      throw new Error("Invalid DOCX: missing word/document.xml");
    }

    const doc = new DOMParser().parseFromString(docXml, "text/xml");
    const paragraphs: { id: string; text: string }[] = [];
    const ps = doc.getElementsByTagName("w:p");

    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const id = randomUUID();
      // Simple text extraction. 
      // Note: This strips formatting. A full editor needs more complex XML handling.
      const textContent = p.textContent || "";
      paragraphs.push({ id, text: textContent });
    }
    
    return paragraphs;
  }

  async rebuild(originalBuffer: Buffer, newParagraphs: { id: string; text: string }[]) {
    const zip = await JSZip.loadAsync(originalBuffer);
    const docXml = await zip.file("word/document.xml")?.async("string");
    
    if (!docXml) {
      throw new Error("Invalid DOCX: missing word/document.xml");
    }

    const doc = new DOMParser().parseFromString(docXml, "text/xml");
    const body = doc.getElementsByTagName("w:body")[0];
    const sectPr = body.getElementsByTagName("w:sectPr")[0];

    // Remove existing paragraphs
    // Note: This is a destructive edit that simplifies the structure.
    // It assumes we replace the entire body content with the new list.
    const existingPs = Array.from(doc.getElementsByTagName("w:p"));
    existingPs.forEach(p => {
        if (p.parentNode === body) {
            body.removeChild(p);
        }
    });
    
    // Insert new paragraphs
    newParagraphs.forEach(para => {
        const newP = doc.createElement("w:p");
        const newR = doc.createElement("w:r");
        const newT = doc.createElement("w:t");
        newT.textContent = para.text || "";
        newR.appendChild(newT);
        newP.appendChild(newR);
        
        if (sectPr) {
            body.insertBefore(newP, sectPr);
        } else {
            body.appendChild(newP);
        }
    });
    
    const newXml = new XMLSerializer().serializeToString(doc);
    zip.file("word/document.xml", newXml);
    return zip.generateAsync({ type: "nodebuffer" });
  }
}

export const docxService = new DocxService();
