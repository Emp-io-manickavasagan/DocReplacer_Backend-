import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { randomUUID } from 'crypto';

// Storage
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

// Upload: Unzip and parse
export async function parseDocx(buffer: Buffer) {
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

  const documentId = randomUUID();
  fileBufferStore.set(documentId, buffer);
  paragraphMappings.set(documentId, paragraphMap);

  return { documentId, paragraphs: nodes };
}

// Export: Unzip, replace nodes, zip
export async function exportDocx(documentId: string, edits: { id: string; text: string }[]) {
  const buffer = fileBufferStore.get(documentId);
  const paragraphMap = paragraphMappings.get(documentId);
  
  if (!buffer || !paragraphMap) {
    throw new Error("Document not found");
  }

  const zip = await JSZip.loadAsync(buffer);
  const documentEntry = zip.file("word/document.xml");
  const xml = await documentEntry!.async("string");
  const xmlDoc = parseXml(xml);

  const paragraphs = getParagraphs(xmlDoc);
  const body = xmlDoc.getElementsByTagName("w:body")[0];

  // Track which paragraphs to keep
  const paragraphsToKeep = new Set<number>();
  
  edits.forEach((edit) => {
    if (edit.id && paragraphMap[edit.id] !== undefined) {
      const index = paragraphMap[edit.id];
      paragraphsToKeep.add(index);
      
      const paraElement = paragraphs[index].element;
      
      // Get all runs in this paragraph
      const runs = Array.from(paraElement.getElementsByTagName("w:r"));
      
      if (runs.length > 0) {
        // Keep the first run, remove all others
        for (let i = runs.length - 1; i > 0; i--) {
          runs[i].parentNode!.removeChild(runs[i]);
        }
        
        // Clear all text nodes in the first run
        const firstRun = runs[0];
        const tNodes = Array.from(firstRun.getElementsByTagName("w:t"));
        tNodes.forEach((t) => {
          t.parentNode!.removeChild(t);
        });
        
        // Add new text node to the first run
        const newText = xmlDoc.createElement("w:t");
        newText.setAttribute("xml:space", "preserve");
        newText.textContent = edit.text || "";
        firstRun.appendChild(newText);
      } else {
        // No runs exist, create a new one
        const newRun = xmlDoc.createElement("w:r");
        const newText = xmlDoc.createElement("w:t");
        newText.setAttribute("xml:space", "preserve");
        newText.textContent = edit.text || "";
        newRun.appendChild(newText);
        paraElement.appendChild(newRun);
      }
    }
    // Create new paragraph
    else if (edit.id === null) {
      const p = xmlDoc.createElement("w:p");
      const r = xmlDoc.createElement("w:r");
      const t = xmlDoc.createElement("w:t");
      t.setAttribute("xml:space", "preserve");
      t.textContent = edit.text || "";
      r.appendChild(t);
      p.appendChild(r);
      body.appendChild(p);
    }
  });

  // Delete paragraphs that were not in the edits (deleted by user)
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    if (!paragraphsToKeep.has(i)) {
      const paraElement = paragraphs[i].element;
      paraElement.parentNode!.removeChild(paraElement);
    }
  }

  const updatedXml = serializeXml(xmlDoc);
  zip.file("word/document.xml", updatedXml);
  return zip.generateAsync({ type: "nodebuffer" });
}