import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { randomUUID } from 'crypto';

export const fileBufferStore = new Map<string, Buffer>();
export const paragraphMappings = new Map<string, { [key: string]: number }>();

// XML helpers
const parseXml = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const serializeXml = (doc: Document) => new XMLSerializer().serializeToString(doc);

// Get all paragraphs with their text runs
const getParagraphs = (doc: Document) => {
  const paragraphs = Array.from(doc.getElementsByTagName("w:p"));
  return paragraphs.map((p) => {
    const runs = Array.from(p.getElementsByTagName("w:r"));
    const textNodes = runs.map((r) => {
      const tNodes = Array.from(r.getElementsByTagName("w:t"));
      return tNodes.map((t) => t.textContent || "").join("");
    });
    return {
      element: p,
      text: textNodes.join(""),
    };
  });
};

export class DocxService {
  // Unzip and parse
  async parse(buffer: Buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const documentEntry = zip.file("word/document.xml");
    if (!documentEntry) {
      throw new Error("document.xml missing");
    }

    const xml = await documentEntry.async("string");
    const xmlDoc = parseXml(xml);
    const paragraphs = getParagraphs(xmlDoc);

    const paragraphMap: { [key: string]: number } = {};
    const nodes = paragraphs.map((para, index) => {
      const id = randomUUID();
      paragraphMap[id] = index;
      return { 
        id, 
        text: para.text,
        isEmpty: para.text.trim() === ""
      };
    });

    return { nodes, paragraphMap };
  }

  // Unzip, replace nodes, zip
  async rebuild(originalBuffer: Buffer, edits: { id: string | null; text: string }[], paragraphMap: { [key: string]: number }) {
    const zip = await JSZip.loadAsync(originalBuffer);
    const documentEntry = zip.file("word/document.xml");
    const xml = await documentEntry!.async("string");
    const xmlDoc = parseXml(xml);

    const paragraphs = getParagraphs(xmlDoc);
    const body = xmlDoc.getElementsByTagName("w:body")[0];

    // Create a new document structure based on the edits array order
    // This ensures new paragraphs appear in the correct positions
    
    // First, collect all existing paragraph elements for reuse
    const existingParagraphs = new Map<number, Element>();
    paragraphs.forEach((para, index) => {
      existingParagraphs.set(index, para.element);
    });
    
    // Clear the body to rebuild it in the correct order
    while (body.firstChild) {
      body.removeChild(body.firstChild);
    }
    
    // Process edits in order and rebuild the document
    edits.forEach((edit) => {
      if (edit.id && paragraphMap[edit.id] !== undefined) {
        // Update existing paragraph and add it to the document
        const index = paragraphMap[edit.id];
        const paraElement = existingParagraphs.get(index);
        
        if (paraElement) {
          // Update the paragraph content
          const runs = Array.from(paraElement.getElementsByTagName("w:r"));
          
          if (runs.length > 0) {
            // Clear existing runs except the first one
            for (let i = runs.length - 1; i > 0; i--) {
              runs[i].parentNode!.removeChild(runs[i]);
            }
            
            // Update the first run with new text
            const firstRun = runs[0];
            const tNodes = Array.from(firstRun.getElementsByTagName("w:t"));
            tNodes.forEach((t) => {
              t.parentNode!.removeChild(t);
            });
            
            const newText = xmlDoc.createElement("w:t");
            newText.setAttribute("xml:space", "preserve");
            newText.textContent = edit.text || "";
            firstRun.appendChild(newText);
          } else {
            // Create new run if none exists
            const newRun = xmlDoc.createElement("w:r");
            const newText = xmlDoc.createElement("w:t");
            newText.setAttribute("xml:space", "preserve");
            newText.textContent = edit.text || "";
            newRun.appendChild(newText);
            paraElement.appendChild(newRun);
          }
          
          // Add the updated paragraph to the body
          body.appendChild(paraElement);
        }
      } else if (edit.id === null) {
        // Create new paragraph and add it in the current position
        const p = xmlDoc.createElement("w:p");
        const r = xmlDoc.createElement("w:r");
        const t = xmlDoc.createElement("w:t");
        t.setAttribute("xml:space", "preserve");
        t.textContent = edit.text || "";
        r.appendChild(t);
        p.appendChild(r);
        
        // Add the new paragraph to the body in the current order
        body.appendChild(p);
      }
    });

    const updatedXml = serializeXml(xmlDoc);
    zip.file("word/document.xml", updatedXml);
    return zip.generateAsync({ type: "nodebuffer" });
  }
}

export const docxService = new DocxService();
