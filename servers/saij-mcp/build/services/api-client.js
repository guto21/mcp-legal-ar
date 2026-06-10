import axios from "axios";
import https from "https";
import { CONFIG } from "../config.js";
import { cacheService } from "./cache-service.js";
import { fileURLToPath } from "url";
import path from "path";

// Puppeteer se resuelve desde legal-mcp (donde corre saij.js)
// cuando el proceso es iniciado por legal-hub con cwd=LEGAL_MCP.
// Fallback: desde saij-mcp si alguien lo corre standalone.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let _puppeteer = null;
async function getPuppeteer() {
    if (_puppeteer) return _puppeteer;
    // Path absoluto al puppeteer de legal-mcp (donde corre saij.js via legal-hub)
    const legalMcpPuppeteer = path.resolve(
        __dirname,
        "../../../../legal-mcp/node_modules/puppeteer/lib/puppeteer/puppeteer.js"
    );
    const candidates = [
        legalMcpPuppeteer,
        "puppeteer",
    ];
    for (const candidate of candidates) {
        try {
            const mod = await import(candidate);
            _puppeteer = mod.default ?? mod;
            return _puppeteer;
        } catch { /* siguiente */ }
    }
    throw new Error("Puppeteer no encontrado. Instalá puppeteer en legal-mcp: npm install puppeteer");
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
/**
 * Base SAIJ API Client with rate limiting, common headers, and intelligent caching
 */
export class ApiClient {
    client;
    lastRequestTime = 0;
    rateLimitDelay;
    sessionCookies = "";
    sessionInitialized = false;
    sessionInitPromise = null;
    constructor() {
        this.rateLimitDelay = 1000 / CONFIG.RATE_LIMIT;
        this.client = axios.create({
            baseURL: CONFIG.BASE_URL,
            timeout: CONFIG.TIMEOUT,
            httpsAgent,
            headers: {
                "User-Agent": CONFIG.DEFAULT_USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Referer": `${CONFIG.BASE_URL}/`,
            },
        });
        // Simple rate limiting interceptor
        this.client.interceptors.request.use(async (config) => {
            await this.waitForRateLimit();
            if (this.sessionCookies) {
                config.headers = config.headers || {};
                config.headers["Cookie"] = this.sessionCookies;
            }
            return config;
        });
        // Interceptor de respuesta: captura 403, reintenta con sesion renovada una vez
        this.client.interceptors.response.use(
            response => response,
            async error => {
                if (error.response?.status === 403 && !error.config?._retried) {
                    error.config._retried = true;
                    // Sin reintentos con Puppeteer - falla directo con mensaje claro
                    const e = new Error(
                        "SAIJ bloqueó la solicitud (HTTP 403). Accedé directamente en https://www.saij.gob.ar"
                    );
                    e.code = "SAIJ_403";
                    return Promise.reject(e);
                }
                if (error.response?.status === 403) {
                    const e = new Error(
                        "SAIJ bloqueó la solicitud (HTTP 403). El portal www.saij.gob.ar " +
                        "puede requerir acceso desde una IP argentina o haber cambiado sus " +
                        "políticas de acceso automatizado. Si el problema persiste, acceda " +
                        "directamente en https://www.saij.gob.ar"
                    );
                    e.code = "SAIJ_403";
                    return Promise.reject(e);
                }
                if (error.response?.status === 500) {
                    // Verificado 10/06/2026: SAIJ devuelve 500 con {"success":false,...}
                    // cuando los parametros de /busqueda son invalidos (ej. termino en
                    // `s` en lugar de `r`). No es bloqueo: es consulta malformada.
                    const e = new Error(
                        "SAIJ devolvió error de operación (HTTP 500). Suele indicar " +
                        "parámetros de consulta inválidos; revisar sintaxis de `r`/`f`."
                    );
                    e.code = "SAIJ_500";
                    return Promise.reject(e);
                }
                return Promise.reject(error);
            }
        );
    }
    /**
     * Initializes a session using Puppeteer to capture JS-set cookies.
     * Deduplicated: concurrent calls wait for the same promise.
     */
    async initSession() {
        if (this.sessionInitialized) return;
        if (this.sessionInitPromise) return this.sessionInitPromise;
        this.sessionInitPromise = (async () => {
            let browser = null;
            try {
                const puppeteer = await getPuppeteer();
                browser = await puppeteer.launch({
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--ignore-certificate-errors",
                    ],
                });
                const page = await browser.newPage();
                await page.setUserAgent(CONFIG.DEFAULT_USER_AGENT);
                await page.goto(CONFIG.BASE_URL, {
                    waitUntil: "networkidle2",
                    timeout: CONFIG.TIMEOUT,
                });
                const cookies = await page.cookies();
                if (cookies.length > 0) {
                    this.sessionCookies = cookies
                        .map(c => `${c.name}=${c.value}`)
                        .join("; ");
                    process.stderr.write(`[saij] sesion iniciada con Puppeteer - ${cookies.length} cookies\n`);
                } else {
                    process.stderr.write(`[saij] Puppeteer cargó la pagina pero no obtuvo cookies\n`);
                }
                this.sessionInitialized = true;
            } catch (err) {
                process.stderr.write(`[saij] error en initSession con Puppeteer: ${err.message}\n`);
                // No bloquear: sessionInitialized=true para que el 403 interceptor maneje
                this.sessionInitialized = true;
            } finally {
                if (browser) {
                    try { await browser.close(); } catch {}
                }
                this.sessionInitPromise = null;
            }
        })();
        return this.sessionInitPromise;
    }
    /**
     * Ensures we respect the rate limit by waiting if necessary
     */
    async waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
            const waitTime = this.rateLimitDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastRequestTime = Date.now();
    }
    /**
     * Generic GET request with intelligent caching
     */
    async get(url, config) {
        const cacheKey = `GET:${url}:${JSON.stringify(config?.params || {})}`;
        if (cacheService.has(cacheKey)) {
            return cacheService.get(cacheKey);
        }
        // initSession con Puppeteer deshabilitado - SAIJ lo detecta como bot
        // El request directo con headers de browser es suficiente desde IP local
        const response = await this.client.get(url, config);
        cacheService.set(cacheKey, response.data);
        return response.data;
    }
    /**
     * Generic POST request
     */
    async post(url, data, config) {
        const response = await this.client.post(url, data, config);
        return response.data;
    }
    /**
     * Expose the underlying axios instance if needed for advanced usage
     */
    get instance() {
        return this.client;
    }
}
// Export a singleton instance
export const apiClient = new ApiClient();
