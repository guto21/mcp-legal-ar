import { apiClient } from "./api-client.js";
import { DocumentMetadataSchema, DocumentType, } from "../types/saij.js";
import pdf from "pdf-parse";
import { createWorker } from "tesseract.js";
import { CONFIG } from "../config.js";
/**
 * FIX 11/06/2026 (re-test ronda 10): SAIJ devuelve algunos campos textuales
 * (sumario, texto, magistrados) a veces como string y a veces como object o
 * array de objetos (ej. {sumario: "..."} o [{"#text": "..."}]). El parser
 * asumia string y rompia resolve_citation/get_document con ZodError.
 * plano() normaliza cualquier forma a string.
 */
function plano(v) {
    if (v === null || v === undefined)
        return v;
    if (typeof v === "string")
        return v;
    if (Array.isArray(v)) {
        const partes = v.map(plano).filter((s) => typeof s === "string" && s.trim());
        return partes.length ? partes.join("\n\n") : null;
    }
    if (typeof v === "object") {
        for (const k of ["sumario", "#text", "texto", "descripcion", "abstract", "contenido"]) {
            if (typeof v[k] === "string" && v[k].trim())
                return v[k];
        }
        const partes = Object.values(v).map(plano).filter((s) => typeof s === "string" && s.trim());
        return partes.length ? partes.join("\n") : null;
    }
    return String(v);
}
/**
 * FIX 11/06/2026 v2 (re-test ronda 11): el articulado puede venir en
 * content.articulo, content.segmento.articulo o anidado en particiones
 * (particiones > particion > articulo, a cualquier profundidad - asi viene
 * la Ley 24.240 con sus capitulos). Recolecta recursivamente todo objeto
 * bajo una clave "articulo", en orden de documento.
 */
function recolectarArticulos(nodo, acc = []) {
    if (!nodo || typeof nodo !== "object")
        return acc;
    if (Array.isArray(nodo)) {
        for (const n of nodo)
            recolectarArticulos(n, acc);
        return acc;
    }
    for (const [k, v] of Object.entries(nodo)) {
        if (k === "articulo") {
            const arts = Array.isArray(v) ? v : [v];
            for (const a of arts) {
                if (a && typeof a === "object")
                    acc.push(a);
            }
        }
        else if (v && typeof v === "object") {
            recolectarArticulos(v, acc);
        }
    }
    return acc;
}
/**
 * DocumentService handles fetching full document content and metadata.
 * It implements specialized extraction logic for different document types.
 */
export class DocumentService {
    /**
     * Fetches document metadata by GUID.
     */
    async getDocumentMetadata(guid) {
        const response = await apiClient.get(`/view-document?guid=${guid}`);
        if (!response || !response.data) {
            throw new Error(`Document not found: ${guid}`);
        }
        try {
            const docData = JSON.parse(response.data);
            const doc = docData.document || {};
            const content = doc.content || {};
            return this.parseMetadata(content, guid);
        }
        catch (error) {
            throw new Error(`Failed to parse document metadata for ${guid}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Fetches full document content including text extraction from various sources.
     */
    async getFullDocument(guid) {
        const metadata = await this.getDocumentMetadata(guid);
        const result = {
            metadata,
            texto_completo: null,
        };
        // Get raw data for full content access
        const response = await apiClient.get(`/view-document?guid=${guid}`);
        const docData = JSON.parse(response.data);
        const content = docData.document?.content || {};
        switch (metadata.document_type) {
            case DocumentType.JURISPRUDENCIA:
                // Try to get text from API JSON first
                let texto = plano(content.texto);
                if (texto && texto.length > 100) {
                    result.texto_completo = texto;
                }
                else if (metadata.pdf_url) {
                    // Fallback to PDF parsing
                    try {
                        const pdfBuffer = await apiClient.get(metadata.pdf_url.replace(CONFIG.BASE_URL, ""), {
                            responseType: "arraybuffer",
                        });
                        const pdfData = await pdf(pdfBuffer);
                        if (pdfData.text && pdfData.text.trim().length > 100) {
                            result.texto_completo = pdfData.text;
                        }
                        else {
                            // OCR Fallback for scanned PDFs
                            console.error(`PDF for ${guid} seems to be a scanned image. Starting OCR...`);
                            const worker = await createWorker("spa");
                            const { data: { text } } = await worker.recognize(pdfBuffer);
                            await worker.terminate();
                            if (text && text.length > 50) {
                                result.texto_completo = `[EXTRACTED VIA OCR]\n${text}`;
                            }
                        }
                    }
                    catch (error) {
                        console.error(`Failed to parse PDF or perform OCR for ${guid}:`, error);
                    }
                }
                break;
            case DocumentType.LEGISLACION: {
                // FIX 11/06/2026 v2: recoleccion RECURSIVA del articulado
                // (content.articulo, segmento.articulo o particiones anidadas,
                // como la Ley 24.240). El texto del articulo puede llamarse
                // "texto-articulo" o "texto" (con tags [[p]]).
                const limpiarTags = (s) => typeof s === "string" ? s.replace(/\[\[\/?p\]\]/g, "\n").trim() : s;
                const fmtArticulo = (art) => {
                    const num = plano(art["numero-articulo"]) || "";
                    const text = limpiarTags(plano(art["texto-articulo"]) || plano(art.texto)) || "";
                    return `Artículo ${num}\n${text}`;
                };
                const articulos = recolectarArticulos(content);
                if (articulos.length > 0) {
                    result.texto_completo = articulos.map(fmtArticulo).join("\n\n");
                }
                break;
            }
            case DocumentType.SUMARIO:
                // Clean [[p]] tags from texto field
                let sumarioTexto = plano(content.texto) || plano(content.sumario);
                if (sumarioTexto) {
                    result.texto_completo = sumarioTexto.replace(/\[\[p\]\]/g, "\n");
                }
                break;
            default:
                // Default to any available text field
                result.texto_completo = plano(content.texto) || plano(content.sumario) || plano(content["texto-completo"]) || null;
        }
        return result;
    }
    /**
     * Retrieves a specific section or article from a large document.
     */
    async getDocumentSection(guid, options) {
        const metadata = await this.getDocumentMetadata(guid);
        const response = await apiClient.get(`/view-document?guid=${guid}`);
        const docData = JSON.parse(response.data);
        const content = docData.document?.content || {};
        let sectionText = null;
        if (metadata.document_type === DocumentType.LEGISLACION) {
            // FIX 11/06/2026: mismas variantes de forma que en getFullDocument
            // (articulo plano o anidado en segmento; texto-articulo o texto).
            const limpiarTags = (s) => typeof s === "string" ? s.replace(/\[\[\/?p\]\]/g, "\n").trim() : s;
            const textoDe = (a) => limpiarTags(plano(a["texto-articulo"]) || plano(a.texto)) || "";
            const articulos = recolectarArticulos(content);
            if (Array.isArray(articulos)) {
                if (options.articleNumber) {
                    const art = articulos.find((a) => String(a["numero-articulo"]) === options.articleNumber);
                    if (art) {
                        sectionText = `Artículo ${art["numero-articulo"]}\n${textoDe(art)}`;
                    }
                }
                else if (options.sectionTitle) {
                    const matched = articulos.filter((a) => textoDe(a).toLowerCase().includes(options.sectionTitle.toLowerCase()));
                    if (matched.length > 0) {
                        sectionText = matched
                            .map((a) => `Artículo ${a["numero-articulo"]}\n${textoDe(a)}`)
                            .join("\n\n");
                    }
                }
            }
        }
        return { metadata, section_text: sectionText };
    }
    /**
     * Internal parser for document metadata, matching Python logic.
     */
    parseMetadata(content, guid) {
        const id_saij = content["id-infojus"] || "";
        const docType = this.inferDocumentType(content);
        const textoDoc = content["texto-doc"] || {};
        const pdfUuid = textoDoc.uuid;
        const pdfFilename = textoDoc["file-name"];
        let pdfUrl = null;
        if (pdfUuid && pdfFilename) {
            pdfUrl = `${CONFIG.BASE_URL}/descarga-archivo?guid=${pdfUuid}&name=${encodeURIComponent(pdfFilename)}`;
        }
        const standardFields = new Set([
            "id-infojus", "tribunal", "fecha", "actor", "sobre",
            "magistrados", "numero-fallo", "provincia", "tipo-fallo",
            "texto-doc", "sumario", "numero-norma", "numero-doctrina",
            "numero-dictamen", "titulo", "titulo-norma", "texto", "articulo"
        ]);
        const extra = {};
        for (const key in content) {
            if (!standardFields.has(key)) {
                extra[key] = content[key];
            }
        }
        const numeroFalloCrudo = content["numero-fallo"];
        const numeroFallo = typeof numeroFalloCrudo === "number"
            ? numeroFalloCrudo
            : (typeof numeroFalloCrudo === "string" && /^\d+$/.test(numeroFalloCrudo.trim()) ? Number(numeroFalloCrudo) : null);
        const metadata = {
            id_saij: plano(id_saij) || "",
            uuid: guid,
            document_type: docType,
            tribunal: plano(content.tribunal),
            fecha: plano(content.fecha),
            caratula: this.buildCaratula(content),
            sumario: plano(content.sumario),
            magistrates: plano(content.magistrados),
            numero_fallo: numeroFallo,
            fuero: this.inferFuero(content.tribunal || ""),
            provincia: content.provincia,
            tipo_fallo: content["tipo-fallo"],
            pdf_url: pdfUrl,
            pdf_uuid: pdfUuid,
            pdf_filename: pdfFilename,
            extra,
        };
        return DocumentMetadataSchema.parse(metadata);
    }
    inferDocumentType(content) {
        if (content["texto-doc"])
            return DocumentType.JURISPRUDENCIA;
        if (content["numero-norma"])
            return DocumentType.LEGISLACION;
        if (content["numero-doctrina"])
            return DocumentType.DOCTRINA;
        if (content["numero-dictamen"])
            return DocumentType.DICTAMEN;
        if (content.sumario)
            return DocumentType.SUMARIO;
        return DocumentType.UNKNOWN;
    }
    buildCaratula(content) {
        const actor = plano(content.actor) || "S/C";
        const sobre = plano(content.sobre) || "S/D";
        if (actor === "S/C" && sobre === "S/D") {
            return plano(content.titulo) || plano(content["titulo-norma"]) || null;
        }
        return `${actor} s/ ${sobre}`;
    }
    inferFuero(tribunal) {
        if (!tribunal)
            return null;
        const upper = tribunal.toUpperCase();
        if (upper.includes("CORTE SUPREMA") || upper.includes("CSJN"))
            return "csjn";
        if (upper.includes("CASACION PENAL"))
            return "casacion_penal_federal";
        if (upper.includes("CONTENCIOSO ADMINISTRATIVO"))
            return "contencioso_administrativo_federal";
        if (upper.includes("CRIMINAL Y CORRECCIONAL FEDERAL"))
            return "criminal_federal";
        if (upper.includes("CRIMINAL Y CORRECCIONAL"))
            return "criminal_nacional";
        if (upper.includes("CIVIL"))
            return "civil";
        if (upper.includes("COMERCIAL"))
            return "comercial";
        if (upper.includes("TRABAJO") || upper.includes("LABORAL"))
            return "laboral";
        if (upper.includes("PENAL"))
            return "penal";
        return null;
    }
}
// Export a singleton instance
export const documentService = new DocumentService();
