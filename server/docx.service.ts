import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { randomUUID } from 'crypto';

export const fileBufferStore = new Map<string, Buffer>();
export const paragraphMappings = new Map<string, { [key: string]: number }>();
export const paragraphStyles = new Map<string, { [key: string]: string | null }>();
export const documentTimestamps = new Map<string, number>();


export const cleanupExpiredDocuments = () => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  for (const [documentId, timestamp] of Array.from(documentTimestamps.entries())) {
    if (timestamp < oneHourAgo) {
      fileBufferStore.delete(documentId);
      paragraphMappings.delete(documentId);
      paragraphStyles.delete(documentId);
      documentTimestamps.delete(documentId);
    }
  }
};

// Set up automatic cleanup every 30 minutes
setInterval(cleanupExpiredDocuments, 30 * 60 * 1000);

// XML helpers
const parseXml = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const serializeXml = (doc: Document) => new XMLSerializer().serializeToString(doc);

// Helper function to safely clone paragraph properties
const cloneParagraphProperties = (xmlDoc: Document, sourcePPr: Element): Element => {
  const clonedPPr = sourcePPr.cloneNode(true) as Element;
  
  // Ensure all important alignment and spacing properties are preserved
  // This includes: w:jc (justification/alignment), w:spacing, w:ind (indentation), etc.
  
  return clonedPPr;
};

// Helper function to safely clone run properties
const cloneRunProperties = (xmlDoc: Document, sourceRPr: Element): Element => {
  const clonedRPr = sourceRPr.cloneNode(true) as Element;
  
  // Ensure all formatting properties are preserved
  // This includes: w:rFonts, w:sz (size), w:color, w:b (bold), w:i (italic), etc.
  
  return clonedRPr;
};
const createTextRuns = (xmlDoc: Document, text: string, rPr?: Element) => {
  const runs: Element[] = [];
  
  // Split text by line breaks
  const lines = text.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Create run for text
    if (line.length > 0) {
      const r = xmlDoc.createElement("w:r");
      if (rPr) {
        const clonedRPr = rPr.cloneNode(true) as Element;
        r.appendChild(clonedRPr);
      }
      
      const t = xmlDoc.createElement("w:t");
      t.setAttribute("xml:space", "preserve");
      t.textContent = line;
      r.appendChild(t);
      runs.push(r);
    }
    
    // Add line break if not the last line
    if (i < lines.length - 1) {
      const r = xmlDoc.createElement("w:r");
      if (rPr) {
        const clonedRPr = rPr.cloneNode(true) as Element;
        r.appendChild(clonedRPr);
      }
      
      const br = xmlDoc.createElement("w:br");
      r.appendChild(br);
      runs.push(r);
    }
  }
  
  // If no text content, create at least one empty run to maintain structure
  if (runs.length === 0) {
    const r = xmlDoc.createElement("w:r");
    if (rPr) {
      const clonedRPr = rPr.cloneNode(true) as Element;
      r.appendChild(clonedRPr);
    }
    
    const t = xmlDoc.createElement("w:t");
    t.setAttribute("xml:space", "preserve");
    t.textContent = "";
    r.appendChild(t);
    runs.push(r);
  }
  
  return runs;
};

// Get all paragraphs with their text runs and style information
const getParagraphs = (doc: Document) => {
  const paragraphs = Array.from(doc.getElementsByTagName("w:p"));
  return paragraphs.map((p) => {
    const runs = Array.from(p.getElementsByTagName("w:r"));
    const textNodes = runs.map((r) => {
      const tNodes = Array.from(r.getElementsByTagName("w:t"));
      return tNodes.map((t) => t.textContent || "").join("");
    });
    
    // Extract paragraph properties for style inheritance
    const pPr = p.getElementsByTagName("w:pPr")[0];
    const styleInfo = pPr ? new XMLSerializer().serializeToString(pPr) : null;
    
    return {
      element: p,
      text: textNodes.join(""),
      styleInfo: styleInfo
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
    const styleMap: { [key: string]: string | null } = {};
    const nodes = paragraphs.map((para, index) => {
      const id = randomUUID();
      paragraphMap[id] = index;
      styleMap[id] = para.styleInfo;
      return { 
        id, 
        text: para.text,
        isEmpty: para.text.trim() === "",
        styleInfo: para.styleInfo
      };
    });

    return { nodes, paragraphMap, styleMap };
  }

  // Unzip, replace nodes, zip
  async rebuild(originalBuffer: Buffer, edits: { id: string | null; text: string; inheritStyleFrom?: string }[], paragraphMap: { [key: string]: number }) {
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
            // Get run properties from the first run for consistency
            const firstRun = runs[0];
            const rPr = firstRun.getElementsByTagName("w:rPr")[0];
            
            // Clear all existing runs
            runs.forEach(run => run.parentNode!.removeChild(run));
            
            // Create new runs with proper line break handling
            const newRuns = createTextRuns(xmlDoc, edit.text || "", rPr);
            newRuns.forEach(run => paraElement.appendChild(run));
          } else {
            // Create new runs if none exist
            const newRuns = createTextRuns(xmlDoc, edit.text || "");
            newRuns.forEach(run => paraElement.appendChild(run));
          }
          
          // Add the updated paragraph to the body
          body.appendChild(paraElement);
        }
      } else if (edit.id === null) {
        // Create new paragraph and add it in the current position
        const p = xmlDoc.createElement("w:p");
        
        // If inheritStyleFrom is provided, copy the style from that paragraph
        if (edit.inheritStyleFrom && paragraphMap[edit.inheritStyleFrom] !== undefined) {
          const sourceIndex = paragraphMap[edit.inheritStyleFrom];
          const sourceElement = existingParagraphs.get(sourceIndex);
          
          if (sourceElement) {
            // Create a complete copy of the source paragraph structure
            const fullClone = sourceElement.cloneNode(true) as Element;
            
            // Clear all text content from the cloned runs but keep the structure
            const clonedRuns = Array.from(fullClone.getElementsByTagName("w:r"));
            clonedRuns.forEach(run => {
              // Remove all text nodes but keep formatting
              const textNodes = Array.from(run.getElementsByTagName("w:t"));
              textNodes.forEach(textNode => textNode.parentNode!.removeChild(textNode));
              
              // Remove line breaks
              const breaks = Array.from(run.getElementsByTagName("w:br"));
              breaks.forEach(br => br.parentNode!.removeChild(br));
            });
            
            // Now add our new content with the same structure
            if (clonedRuns.length > 0) {
              // Use the first run as template and remove others
              for (let i = clonedRuns.length - 1; i > 0; i--) {
                clonedRuns[i].parentNode!.removeChild(clonedRuns[i]);
              }
              
              const templateRun = clonedRuns[0];
              const rPr = templateRun.getElementsByTagName("w:rPr")[0];
              
              // Remove the template run
              templateRun.parentNode!.removeChild(templateRun);
              
              // Create new runs with our text
              const newRuns = createTextRuns(xmlDoc, edit.text || "", rPr);
              newRuns.forEach(run => fullClone.appendChild(run));
            } else {
              // No runs in source, create basic ones
              const newRuns = createTextRuns(xmlDoc, edit.text || "");
              newRuns.forEach(run => fullClone.appendChild(run));
            }
            
            // Add the fully structured clone to the body
            body.appendChild(fullClone);
          } else {
            // Fallback: create basic paragraph
            const newRuns = createTextRuns(xmlDoc, edit.text || "");
            newRuns.forEach(run => p.appendChild(run));
            body.appendChild(p);
          }
        } else {
          // Create basic paragraph without style inheritance
          const newRuns = createTextRuns(xmlDoc, edit.text || "");
          newRuns.forEach(run => p.appendChild(run));
          body.appendChild(p);
        }
      }
    });

    const updatedXml = serializeXml(xmlDoc);
    zip.file("word/document.xml", updatedXml);
    return zip.generateAsync({ type: "nodebuffer" });
  }
}

export const docxService = new DocxService();
