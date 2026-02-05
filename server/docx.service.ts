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
  try {
    const paragraphs = Array.from(doc.getElementsByTagName("w:p"));
    return paragraphs.map((p) => {
      try {
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
          text: textNodes.join("") || "", // Ensure text is never null/undefined
          styleInfo: styleInfo
        };
      } catch (paraError) {
        // Return a safe default paragraph on error
        return {
          element: p,
          text: "",
          styleInfo: null
        };
      }
    });
  } catch (error) {
    // Return at least one empty paragraph to prevent complete failure
    return [{
      element: null,
      text: "",
      styleInfo: null
    }];
  }
};

export class DocxService {
  // Unzip and parse
  async parse(buffer: Buffer) {
    try {
      // Validate buffer
      if (!buffer || buffer.length === 0) {
        throw new Error("Empty or invalid file buffer");
      }

      // Check if it looks like a ZIP file (DOCX is a ZIP)
      const zipSignature = buffer.slice(0, 4);
      const isZip = zipSignature[0] === 0x50 && zipSignature[1] === 0x4B;
      if (!isZip) {
        throw new Error("File is not a valid ZIP/DOCX format");
      }

      const zip = await JSZip.loadAsync(buffer);
      
      // Check for required DOCX structure
      const documentEntry = zip.file("word/document.xml");
      if (!documentEntry) {
        throw new Error("document.xml missing - not a valid DOCX file");
      }

      const xml = await documentEntry.async("string");
      if (!xml || xml.trim().length === 0) {
        throw new Error("document.xml is empty or corrupted");
      }

      let xmlDoc;
      try {
        xmlDoc = parseXml(xml);
      } catch (parseError) {
        throw new Error("Invalid XML structure in document.xml");
      }

      if (!xmlDoc || xmlDoc.documentElement.nodeName === 'parsererror') {
        throw new Error("Invalid XML structure in document.xml");
      }

      const paragraphs = getParagraphs(xmlDoc);

      const paragraphMap: { [key: string]: number } = {};
      const styleMap: { [key: string]: string | null } = {};
      const nodes = paragraphs.map((para, index) => {
        const id = randomUUID();
        paragraphMap[id] = index;
        styleMap[id] = para.styleInfo;
        return { 
          id, 
          text: para.text || "", // Ensure text is never null
          isEmpty: !para.text || para.text.trim() === "",
          styleInfo: para.styleInfo
        };
      });

      // Ensure we have at least one paragraph
      if (nodes.length === 0) {
        nodes.push({
          id: randomUUID(),
          text: "",
          isEmpty: true,
          styleInfo: null
        });
      }

      return { nodes, paragraphMap, styleMap };
    } catch (error: any) {
      // Provide specific error messages
      if (error.message?.includes('End of data reached') || error.message?.includes('Invalid or unsupported zip format')) {
        throw new Error("Corrupted DOCX file - unable to extract content");
      }
      if (error.message?.includes('not a valid ZIP')) {
        throw new Error("File is not a valid DOCX format");
      }
      if (error.message?.includes('document.xml missing')) {
        throw new Error("Invalid DOCX structure - missing document content");
      }
      
      // Re-throw with original message for debugging
      throw new Error(`DOCX parsing failed: ${error.message}`);
    }
  }

  // Unzip, replace nodes, zip
  async rebuild(originalBuffer: Buffer, edits: { id: string | null; text: string; inheritStyleFrom?: string; isEmpty?: boolean }[], paragraphMap: { [key: string]: number }) {
    const zip = await JSZip.loadAsync(originalBuffer);
    const documentEntry = zip.file("word/document.xml");
    const xml = await documentEntry!.async("string");
    const xmlDoc = parseXml(xml);

    const paragraphs = getParagraphs(xmlDoc);

    // ULTRA-MINIMAL APPROACH: Only update text content, preserve everything else
    // This approach maintains the exact XML structure to preserve shapes, drawings, etc.
    
    // Update existing paragraphs only - preserve all formatting and structure
    edits.forEach((edit) => {
      if (edit.id && paragraphMap[edit.id] !== undefined) {
        const index = paragraphMap[edit.id];
        const paraElement = paragraphs[index].element;
        
        if (paraElement) {
          // Find all w:t elements (text nodes) in this paragraph
          const textNodes = Array.from(paraElement.getElementsByTagName("w:t"));
          
          if (textNodes.length > 0) {
            // Update only the first text node, preserve all formatting
            const firstTextNode = textNodes[0];
            
            // Handle line breaks by creating proper w:br elements
            if (edit.text.includes('\n')) {
              const parentRun = firstTextNode.parentNode as Element;
              const runProps = parentRun.getElementsByTagName("w:rPr")[0];
              
              // Clear the parent run but keep run properties
              while (parentRun.firstChild) {
                parentRun.removeChild(parentRun.firstChild);
              }
              
              // Re-add run properties if they existed
              if (runProps) {
                parentRun.appendChild(runProps.cloneNode(true));
              }
              
              // Create text runs with line breaks
              const textRuns = createTextRuns(xmlDoc, edit.text, runProps);
              textRuns.forEach(run => {
                // Move the content from the new run to the existing run
                while (run.firstChild) {
                  parentRun.appendChild(run.firstChild);
                }
              });
            } else {
              // Simple text replacement without line breaks
              firstTextNode.textContent = edit.text || "";
            }
            
            // Remove additional text nodes to avoid duplication
            for (let i = 1; i < textNodes.length; i++) {
              const parentRun = textNodes[i].parentNode;
              if (parentRun && parentRun.parentNode) {
                parentRun.parentNode.removeChild(parentRun);
              }
            }
          } else {
            // If no text nodes exist, create minimal structure while preserving paragraph properties
            const pPr = paraElement.getElementsByTagName("w:pPr")[0];
            
            // Clear paragraph content but keep paragraph properties
            while (paraElement.firstChild) {
              if (paraElement.firstChild === pPr) {
                break;
              }
              paraElement.removeChild(paraElement.firstChild);
            }
            
            // Remove all children except pPr
            const children = Array.from(paraElement.childNodes);
            children.forEach(child => {
              if (child !== pPr) {
                paraElement.removeChild(child);
              }
            });
            
            // Create new run with text
            const newRun = xmlDoc.createElement("w:r");
            const newText = xmlDoc.createElement("w:t");
            newText.setAttribute("xml:space", "preserve");
            newText.textContent = edit.text || "";
            newRun.appendChild(newText);
            paraElement.appendChild(newRun);
          }
        }
      }
    });

    // Handle new paragraphs (id: null) by adding them at the end
    const body = xmlDoc.getElementsByTagName("w:body")[0];
    if (body) {
      // Find section properties (sectPr) to insert before it
      const sectPr = body.getElementsByTagName("w:sectPr")[0];
      
      edits.forEach((edit) => {
        if (edit.id === null) {
          // Create new paragraph
          const newPara = xmlDoc.createElement("w:p");
          
          // Add paragraph properties if inheriting style
          if (edit.inheritStyleFrom && paragraphMap[edit.inheritStyleFrom] !== undefined) {
            const sourceIndex = paragraphMap[edit.inheritStyleFrom];
            const sourcePara = paragraphs[sourceIndex].element;
            const sourcePPr = sourcePara.getElementsByTagName("w:pPr")[0];
            
            if (sourcePPr) {
              const clonedPPr = sourcePPr.cloneNode(true) as Element;
              newPara.appendChild(clonedPPr);
            }
          } else if (!edit.inheritStyleFrom && edit.isEmpty !== true) {
            // Add basic paragraph properties for non-empty paragraphs
            const pPr = xmlDoc.createElement("w:pPr");
            const spacing = xmlDoc.createElement("w:spacing");
            spacing.setAttribute("w:after", "0");
            spacing.setAttribute("w:line", "276");
            spacing.setAttribute("w:lineRule", "auto");
            pPr.appendChild(spacing);
            newPara.appendChild(pPr);
          }
          
          // Add text content
          if (edit.text || edit.isEmpty !== true) {
            const newRun = xmlDoc.createElement("w:r");
            
            // Inherit run properties if specified
            if (edit.inheritStyleFrom && paragraphMap[edit.inheritStyleFrom] !== undefined) {
              const sourceIndex = paragraphMap[edit.inheritStyleFrom];
              const sourcePara = paragraphs[sourceIndex].element;
              const sourceRun = sourcePara.getElementsByTagName("w:r")[0];
              const sourceRPr = sourceRun?.getElementsByTagName("w:rPr")[0];
              
              if (sourceRPr) {
                const clonedRPr = sourceRPr.cloneNode(true) as Element;
                newRun.appendChild(clonedRPr);
              }
            }
            
            // Handle line breaks in new paragraphs
            if (edit.text.includes('\n')) {
              const runProps = newRun.getElementsByTagName("w:rPr")[0];
              const textRuns = createTextRuns(xmlDoc, edit.text, runProps);
              
              // Add all text runs to the paragraph
              textRuns.forEach(run => {
                newPara.appendChild(run);
              });
            } else {
              const newText = xmlDoc.createElement("w:t");
              newText.setAttribute("xml:space", "preserve");
              newText.textContent = edit.text || "";
              newRun.appendChild(newText);
              newPara.appendChild(newRun);
            }
          }
          
          // Insert before sectPr or at the end
          if (sectPr) {
            body.insertBefore(newPara, sectPr);
          } else {
            body.appendChild(newPara);
          }
        }
      });
    }

    const updatedXml = serializeXml(xmlDoc);
    zip.file("word/document.xml", updatedXml);
    
    // Return the zip with ALL original files preserved (shapes, images, etc.)
    return zip.generateAsync({ type: "nodebuffer" });
  }
}

export const docxService = new DocxService();
