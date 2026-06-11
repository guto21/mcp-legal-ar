import { apiClient } from "./api-client.js";
import { FilterBuilder, PRESET_FILTERS } from "./filter-builder.js";
import { SearchResponseSchema, } from "../types/saij.js";
import { documentService } from "./document-service.js";
/**
 * SearchService provides specialized methods for searching SAIJ documents.
 * It coordinates FilterBuilder and ApiClient.
 */
export class SearchService {
    /**
     * Resolves a free-text legal citation (e.g., "Ley 24240", "Código Civil") to a document.
     */
    async resolveCitation(text) {
        // 1. Detect Law number patterns (e.g., "Ley 24.240" or "Ley 24240")
        const lawMatch = text.match(/ley\s*(\d+[\.\d+]*)/i);
        if (lawMatch) {
            const lawNumber = lawMatch[1].replace(/\./g, "");
            // FIX 11/06/2026 (verificado en vivo): buscar por texto libre traia
            // cualquier norma que MENCIONARA el numero (ej. una adhesion
            // provincial) en vez de la ley misma. El campo numero-norma del
            // indice matchea exacto: numero-norma:24240 + tipo Ley +
            // jurisdiccion Nacional devuelve unicamente la Ley 24.240.
            for (const jurisdiccion of ["Nacional", undefined]) {
                const exactos = await this.searchLegislacion({
                    query: `numero-norma:${lawNumber}`,
                    tipoNorma: "Ley",
                    jurisdiccion,
                    offset: 0,
                    pageSize: 1,
                    view: "colapsada",
                });
                if (exactos.results.length > 0) {
                    return await documentService.getFullDocument(exactos.results[0].uuid);
                }
            }
            // Fallback historico: texto libre (puede traer normas que solo
            // citan el numero; mejor que nada si numero-norma no matcheo)
            const results = await this.searchLegislacion({ query: lawNumber, offset: 0, pageSize: 1, view: "colapsada" });
            if (results.results.length > 0) {
                return await documentService.getFullDocument(results.results[0].uuid);
            }
        }
        // 2. Detect Code patterns
        if (text.toLowerCase().includes("codigo civil")) {
            const results = await this.searchRaw(PRESET_FILTERS.codigos, { query: "Civil", offset: 0, pageSize: 1, view: "colapsada" });
            if (results.results.length > 0) {
                return await documentService.getFullDocument(results.results[0].uuid);
            }
        }
        // 3. Fallback to general search
        return await this.searchRaw("Total", { query: text, offset: 0, pageSize: 5, view: "colapsada" });
    }
    /**
     * Search jurisprudencia with specific filters.
     */
    async searchJurisprudencia(params) {
        const filterStr = FilterBuilder.jurisprudencia({
            jurisdiccion: params.jurisdiccion,
            tribunal: params.tribunal,
            materia: params.materia,
            tipoDoc: params.tipoDoc,
            fechaDesde: params.fechaDesde,
            fechaHasta: params.fechaHasta,
        });
        return this.searchRaw(filterStr, params);
    }
    /**
     * Search legislacion with specific filters.
     */
    async searchLegislacion(params) {
        const filterStr = FilterBuilder.legislacion({
            tipoNorma: params.tipoNorma,
            jurisdiccion: params.jurisdiccion,
            estadoVigencia: params.estadoVigencia,
            organismo: params.organismo,
            tema: params.tema,
        });
        return this.searchRaw(filterStr, params);
    }
    /**
     * Search doctrina with specific filters.
     */
    async searchDoctrina(params) {
        const filterStr = FilterBuilder.doctrina({
            materia: params.materia,
            autor: params.autor,
            fechaDesde: params.fechaDesde,
            fechaHasta: params.fechaHasta,
        });
        return this.searchRaw(filterStr, params);
    }
    /**
     * Search dictamenes with specific filters.
     */
    async searchDictamenes(params) {
        const filterStr = FilterBuilder.dictamenes({
            organismo: params.organismo,
            tema: params.tema,
        });
        return this.searchRaw(filterStr, params);
    }
    /**
     * Search the digital library.
     */
    async searchBiblioteca(params) {
        return this.searchRaw(PRESET_FILTERS.biblioteca_digital || "Publicación/Biblioteca digital", params);
    }
    /**
     * Retrieves the latest legal news (novedades).
     */
    async getNovedades(limit = 10) {
        // FIX 11/06/2026 v2 (re-test ronda 10, capturado de la portada real):
        // la home de saij.gob.ar pide las novedades con r=destacada:1, f=Total
        // y p=500, y ORDENA EN EL CLIENTE por fecha (parserFechaCompleta en su
        // JS). El intento v1 (s=fecha-rango|DESC sobre la faceta
        // "Publicación/Novedad") fallaba porque esa faceta es un indice viejo
        // (datos 2017) y el orden server-side no aplico ahi. Se replica
        // exactamente lo que hace la portada: traer destacadas y ordenar aca.
        const extraerFecha = (abstract) => {
            if (typeof abstract !== "string")
                return null;
            const iso = abstract.match(/"fecha[^"]*"\s*:\s*"(\d{4})-(\d{2})-(\d{2})/);
            if (iso)
                return `${iso[1]}-${iso[2]}-${iso[3]}`;
            const esp = abstract.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (esp)
                return `${esp[3]}-${esp[2]}-${esp[1]}`;
            const anio = abstract.match(/"fecha[^"]*"\s*:\s*"(\d{4})"/);
            return anio ? `${anio[1]}-01-01` : null;
        };
        try {
            const res = await this.searchRaw("Total", {
                rawQuery: "destacada:1",
                pageSize: 500,
                offset: 0,
                view: "detallada",
            });
            if (res.results.length > 0) {
                const ordenados = res.results
                    .map((r) => ({ r, fecha: extraerFecha(r.document_abstract) }))
                    .sort((a, b) => (b.fecha || "0000").localeCompare(a.fecha || "0000"));
                return {
                    ...res,
                    page_size: limit,
                    results: ordenados.slice(0, Math.max(1, limit)).map((x) => x.r),
                    query: "destacada:1 (novedades de portada, orden por fecha desc aplicado client-side)",
                };
            }
        }
        catch (_e) {
            // cae al fallback historico
        }
        // Fallback: faceta historica de novedades (indice viejo, sin orden)
        const res = await this.searchRaw(PRESET_FILTERS.novedades || "Publicación/Novedad", {
            query: "*:*",
            pageSize: limit,
            offset: 0,
            view: "detallada",
        });
        res.advertencia = "Se uso el indice historico 'Publicación/Novedad' (la consulta de portada destacada:1 fallo o vino vacia); las fechas pueden ser viejas. Verificar antes de usar.";
        return res;
    }
    /**
     * Generic search using a raw filter string.
     *
     * FIX 10/06/2026 (capturado del trafico real del buscador de saij.gob.ar):
     * el termino de busqueda viaja en el parametro `r` (rawQuery), NO en `s`.
     * Mandar el termino en `s` provoca HTTP 500 ("Ocurrió un error durante la
     * operación"). Formato verificado: r="+titulo: despido", r="+tema:despido",
     * frases con "?" entre palabras (r="+tema:despido?por?riña"); `s` va vacio.
     */
    buildRawQuery(query) {
        if (!query || query === "*:*") return "";
        const q = String(query).trim();
        // Verificado en vivo 10/06/2026:
        //   - "+titulo: despido" y "+texto: despido" devuelven resultados reales.
        //   - el texto libre sin campo se expande server-side a "contenido:" que
        //     NO matchea nada (campo muerto) -> se mapea a "texto:".
        //   - la frase con "?" ("locacion?de?obra") da 0: los stopwords no estan
        //     en el indice y rompen la frase -> multipalabra = AND de terminos
        //     por campo, sin stopwords.
        const STOP = new Set(["de", "la", "el", "los", "las", "y", "o", "u", "del", "al", "en", "por", "para", "con", "sin", "sobre", "a", "e", "un", "una", "unos", "unas", "que", "se", "su", "sus", "lo"]);
        const m = q.match(/^\+?([a-z][a-z-]*):\s*(.+)$/i);
        const campo = m ? m[1].toLowerCase() : "texto";
        const valor = (m ? m[2] : q).trim();
        const palabras = valor.split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase()));
        if (!palabras.length) return "";
        if (palabras.length === 1) return `+${campo}: ${palabras[0]}`;
        return palabras.map((w) => `+${campo}:${w}`).join(" ");
    }
    async searchRaw(filterStr, params) {
        const queryParams = {
            o: (params.offset || 0).toString(),
            p: (params.pageSize || 20).toString(),
            f: filterStr,
            // `s` es el parametro de ORDEN (no el termino de busqueda, que va
            // en `r`). Vacio = orden por relevancia del indice.
            s: params.sort || "",
            v: params.view || "colapsada",
        };
        // rawQuery explicito (passthrough, ej. "destacada:1" como lo manda la
        // portada) tiene prioridad sobre la construccion desde params.query.
        const r = params.rawQuery !== undefined ? params.rawQuery : this.buildRawQuery(params.query);
        if (r) queryParams.r = r;
        const data = await apiClient.get("/busqueda", {
            params: queryParams,
        });
        return this.parseResponse(data, params.query || "*:*");
    }
    /**
     * Provides autocomplete suggestions for legal terms or topics.
     */
    async suggestTerms(term, amount = 10) {
        const data = await apiClient.get("/suggest", {
            params: {
                key: term,
                amount: amount.toString(),
                suggesterName: "suggest",
            },
        });
        try {
            const suggestions = typeof data === "string" ? JSON.parse(data) : data;
            return Array.isArray(suggestions) ? suggestions : [];
        }
        catch (e) {
            return [];
        }
    }
    /**
     * Parses the raw API response into a validated SearchResponse.
     */
    parseResponse(data, query) {
        const queryData = data.queryObjectData || {};
        const searchData = data.searchResults || {};
        const results = (searchData.documentResultList || []).map((item) => ({
            uuid: item.uuid || "",
            document_score: item.documentScore || 0.0,
            document_abstract: item.documentAbstract || null,
        }));
        const response = {
            total_results: searchData.totalSearchResults || 0,
            offset: queryData.offset || 0,
            page_size: queryData.pageSize || 20,
            results: results,
            query: query,
            expanded_query: searchData.expandedQuery || null,
        };
        return SearchResponseSchema.parse(response);
    }
}
// Export a singleton instance
export const searchService = new SearchService();
