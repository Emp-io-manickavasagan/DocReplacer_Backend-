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

// Helper function to normalize paragraph properties for consistency
const normalizeParagraphProperties = (xmlDoc: Document, pPr: Element): Element => {
  const normalizedPPr = pPr.cloneNode(true) as Element;
  
  // Ensure consistent spacing and alignment
  const spacing = normalizedPPr.getElementsByTagName("w:spacing")[0];
  if (spacing) {
    // Normalize spacing values to prevent inconsistencies
    const before = spacing.getAttribute("w:before");
    const after = spacing.getAttribute("w:after");
    const line = spacing.getAttribute("w:line");
    
    // Ensure spacing values are consistent
    if (before) spacing.setAttribute("w:before", before);
    if (after) spacing.setAttribute("w:after", after);
    if (line) spacing.setAttribute("w:line", line);
  }
  
  // Ensure indentation is properly preserved
  const ind = normalizedPPr.getElementsByTagName("w:ind")[0];
  if (ind) {
    const left = ind.getAttribute("w:left");
    const right = ind.getAttribute("w:right");
    const firstLine = ind.getAttribute("w:firstLine");
    
    if (left) ind.setAttribute("w:left", left);
    if (right) ind.setAttribute("w:right", right);
    if (firstLine) ind.setAttribute("w:firstLine", firstLine);
  }
  
  return normalizedPPr;
};

// Helper function to normalize run properties for consistency
const normalizeRunProperties = (xmlDoc: Document, rPr: Element): Element => {
  const normalizedRPr = rPr.cloneNode(true) as Element;
  
  // Ensure font properties are consistent
  const rFonts = normalizedRPr.getElementsByTagName("w:rFonts")[0];
  if (rFonts) {
    // Preserve font family settings
    const ascii = rFonts.getAttribute("w:ascii");
    const hAnsi = rFonts.getAttribute("w:hAnsi");
    const cs = rFonts.getAttribute("w:cs");
    
    if (ascii) rFonts.setAttribute("w:ascii", ascii);
    if (hAnsi) rFonts.setAttribute("w:hAnsi", hAnsi);
    if (cs) rFonts.setAttribute("w:cs", cs);
  }
  
  // Ensure size properties are consistent
  const sz = normalizedRPr.getElementsByTagName("w:sz")[0];
  if (sz) {
    const val = sz.getAttribute("w:val");
    if (val) sz.setAttribute("w:val", val);
  }
  
  const szCs = normalizedRPr.getElementsByTagName("w:szCs")[0];
  if (szCs) {
    const val = szCs.getAttribute("w:val");
    if (val) szCs.setAttribute("w:val", val);
  }
  
  return normalizedRPr;
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

// Helper function to ensure proper document structure
const ensureDocumentStructure = (xmlDoc: Document, body: Element) => {
  // Ensure proper sectPr (section properties) at the end
  let sectPr = body.getElementsByTagName("w:sectPr")[0];
  if (sectPr) {
    // Remove sectPr from its current position
    sectPr.parentNode!.removeChild(sectPr);
    // Add it back at the end
    body.appendChild(sectPr);
  }
  
  // Ensure consistent paragraph spacing throughout the document
  const paragraphs = Array.from(body.getElementsByTagName("w:p"));
  paragraphs.forEach((p, index) => {
    const pPr = p.getElementsByTagName("w:pPr")[0];
    if (pPr) {
      // Ensure spacing is consistent
      let spacing = pPr.getElementsByTagName("w:spacing")[0];
      if (!spacing) {
        spacing = xmlDoc.createElement("w:spacing");
        pPr.appendChild(spacing);
      }
      
      // Set default spacing if not present
      if (!spacing.getAttribute("w:after")) {
        spacing.setAttribute("w:after", "0");
      }
      if (!spacing.getAttribute("w:line")) {
        spacing.setAttribute("w:line", "276");
        spacing.setAttribute("w:lineRule", "auto");
      }
    }
  });
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

    // Get all child elements of the body (paragraphs, shapes, tables, etc.)
    const allBodyElements = Array.from(body.childNodes).filter(node => node.nodeType === 1) as Element[];
    
    // Separate paragraphs from other elements
    const paragraphElements = allBodyElements.filter(el => el.tagName === "w:p");
    const nonParagraphElements = allBodyElements.filter(el => el.tagName !== "w:p");
    
    // Create a map of original paragraph positions to preserve document order
    const elementPositions = new Map<Element, number>();
    allBodyElements.forEach((el, index) => {
      elementPositions.set(el, index);
    });

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
    
    // Create updated paragraphs based on edits
    const updatedParagraphs: { element: Element; originalIndex?: number }[] = [];
    
    // Process edits in order and create updated paragraphs
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
            const originalRPr = firstRun.getElementsByTagName("w:rPr")[0];
            let normalizedRPr: Element | undefined;
            
            if (originalRPr) {
              normalizedRPr = normalizeRunProperties(xmlDoc, originalRPr);
            }
            
            // Clear all existing runs
            runs.forEach(run => run.parentNode!.removeChild(run));
            
            // Create new runs with proper line break handling and normalized formatting
            const newRuns = createTextRuns(xmlDoc, edit.text || "", normalizedRPr);
            newRuns.forEach(run => paraElement.appendChild(run));
          } else {
            // Create new runs if none exist
            const newRuns = createTextRuns(xmlDoc, edit.text || "");
            newRuns.forEach(run => paraElement.appendChild(run));
          }
          
          // Store the updated paragraph with its original position
          updatedParagraphs.push({ 
            element: paraElement, 
            originalIndex: index 
          });
        }
      } else if (edit.id === null) {
        // Create new paragraph and add it in the current position
        const p = xmlDoc.createElement("w:p");
        
        // If inheritStyleFrom is provided, copy the style from that paragraph
        if (edit.inheritStyleFrom && paragraphMap[edit.inheritStyleFrom] !== undefined) {
          const sourceIndex = paragraphMap[edit.inheritStyleFrom];
          const sourceElement = existingParagraphs.get(sourceIndex);
          
          if (sourceElement) {
            // Copy paragraph properties with normalization
            const sourcePPr = sourceElement.getElementsByTagName("w:pPr")[0];
            if (sourcePPr) {
              const normalizedPPr = normalizeParagraphProperties(xmlDoc, sourcePPr);
              p.appendChild(normalizedPPr);
            }
            
            // Get and normalize run properties from the first run of source paragraph
            const sourceRuns = Array.from(sourceElement.getElementsByTagName("w:r"));
            let normalizedRPr: Element | undefined;
            
            if (sourceRuns.length > 0) {
              const originalRPr = sourceRuns[0].getElementsByTagName("w:rPr")[0];
              if (originalRPr) {
                normalizedRPr = normalizeRunProperties(xmlDoc, originalRPr);
              }
            }
            
            // Create runs with proper line break handling and normalized formatting
            const newRuns = createTextRuns(xmlDoc, edit.text || "", normalizedRPr);
            newRuns.forEach(run => p.appendChild(run));
          } else {
            // Fallback: create basic paragraph
            const newRuns = createTextRuns(xmlDoc, edit.text || "");
            newRuns.forEach(run => p.appendChild(run));
          }
        } else {
          // Create basic paragraph without style inheritance
          const newRuns = createTextRuns(xmlDoc, edit.text || "");
          newRuns.forEach(run => p.appendChild(run));
        }
        
        // Store the new paragraph (no original index)
        updatedParagraphs.push({ element: p });
      }
    });

    // Now rebuild the document maintaining the original order of all elements
    // Create a combined list of all elements in their proper positions
    const finalElements: Element[] = [];
    let paragraphIndex = 0;
    
    // Go through original positions and place elements accordingly
    for (let i = 0; i < allBodyElements.length; i++) {
      const originalElement = allBodyElements[i];
      
      if (originalElement.tagName === "w:p") {
        // This was a paragraph position - insert updated paragraph if available
        if (paragraphIndex < updatedParagraphs.length) {
          const updatedPara = updatedParagraphs[paragraphIndex];
          finalElements.push(updatedPara.element);
          paragraphIndex++;
        }
      } else {
        // This is a non-paragraph element (shape, table, etc.) - preserve it
        finalElements.push(originalElement);
      }
    }
    
    // Add any remaining new paragraphs at the end
    while (paragraphIndex < updatedParagraphs.length) {
      finalElements.push(updatedParagraphs[paragraphIndex].element);
      paragraphIndex++;
    }
    
    // Add all elements back to the body in the correct order
    finalElements.forEach(element => {
      body.appendChild(element);
    });

    // Ensure proper document structure and consistency
    ensureDocumentStructure(xmlDoc, body);

    const updatedXml = serializeXml(xmlDoc);
    zip.file("word/document.xml", updatedXml);
    return zip.generateAsync({ type: "nodebuffer" });
  }
}

export const docxService = new DocxService();
