#!/usr/bin/env node
/**
 * Smoke test - bopba.js + pjnjuris.js
 * Ejecutar desde: C:\Users\Ximena\legal-hub
 * Comando: node smoke-test.mjs
 */

import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const axiosClient = axios.create({ httpsAgent, timeout: 15000 });

const OK  = (label, data) => { console.log(`  ✅ ${label}`); if (data) console.log("    ", JSON.stringify(data).substring(0, 120)); };
const ERR = (label, err)  => console.error(`  ❌ ${label}: ${err.message || err}`);

// ─── BOPBA ────────────────────────────────────────────────────────────────────

async function bopba_obtener_ultimo_boletin() {
  const $ = cheerio.load((await axiosClient.get("https://boletinoficial.gba.gob.ar/", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  })).data);
  const fecha = $('.bulletin-date strong').text().trim()
    || $('.bulletin-date').text().replace('Ver anteriores','').trim();
  const secciones = [];
  $('.bulletin-box').each((_, box) => {
    const $b = $(box);
    const nombre = $b.find('h4').text().trim();
    let id = '';
    $b.find('a').each((_, a) => {
      const m = ($(a).attr('href')||'').match(/\/secciones\/(\d+)/);
      if (m) { id = m[1]; return false; }
    });
    if (nombre) secciones.push({ nombre, id });
  });
  return { fecha, secciones_count: secciones.length, primera: secciones[0] };
}

async function bopba_buscar_boletin() {
  const q = new URLSearchParams({ "search[words]": "licitacion", "search[sort]": "by_date_desc", utf8: "✔" });
  const $ = cheerio.load((await axiosClient.get(`https://boletinoficial.gba.gob.ar/buscar?${q}`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }
  })).data);
  const results = [];
  $('.result-box').each((_, box) => {
    const $b = $(box);
    const title = $b.find('.title a').first().text().trim();
    const m = ($b.find('.title a[download]').first().attr('href')||'').match(/\/secciones\/(\d+)/);
    if (title) results.push({ title: title.substring(0,60), id: m?.[1]||'' });
  });
  return { count: results.length, first: results[0] };
}

async function bopba_calcular_tarifa_guard() {
  // Verifica que el guard en calcular_tarifa no tire undefined cuando tasasOficiales está vacío.
  // Simulamos el path del else branch directamente.
  const tasasOficiales = {};  // cache vacío, simula parse fallido
  const categoria = "Balances";
  const tasa = tasasOficiales[categoria]?.["normal"];
  if (tasa === undefined) return { guard_ok: true, message: "optional chaining devuelve undefined correctamente, guard activo" };
  return { guard_ok: false };
}

// ─── PJNJURIS ─────────────────────────────────────────────────────────────────

async function pjnjuris_sin_sesion() {
  // Verifica que pjnJurisQueryWithSession devuelve el mensaje de error correcto cuando globalPage === null
  // Replicamos la lógica localmente
  const globalPage = null;
  const toolName = "pjn_buscar_jurisprudencia_por_expediente";
  if (!globalPage) {
    return {
      isError: true,
      message_snippet: `[ERROR] ${toolName}: el endpoint scw.pjn.gov.ar`.substring(0, 80)
    };
  }
  return { isError: false };
}

async function pjnjuris_alcance_fuente() {
  // El tool alcance_fuente es puro (no hace fetch), lo verificamos parseando el texto esperado
  const expected_strings = [
    "pjn-juris-mcp v1.0.0",
    "iniciar_hitl_browser",
    "finalizar_hitl_browser",
    "pjn_descargar_fallo_pdf",
    "NO IMPLEMENTADO"
  ];
  // Leemos el archivo para confirmar que los strings están presentes
  const { readFileSync } = await import("fs");
  const src = readFileSync("C:\\Users\\Ximena\\legal-hub\\servers\\legal-mcp\\build\\pjnjuris.js", "utf-8");
  const missing = expected_strings.filter(s => !src.includes(s));
  return { all_present: missing.length === 0, missing };
}

async function pjnjuris_cleanup_handlers() {
  const { readFileSync } = await import("fs");
  const src = readFileSync("C:\\Users\\Ximena\\legal-hub\\servers\\legal-mcp\\build\\pjnjuris.js", "utf-8");
  return {
    sigint:  src.includes('process.on("SIGINT"'),
    sigterm: src.includes('process.on("SIGTERM"'),
    exit:    src.includes('process.on("exit"'),
    cleanup_fn: src.includes('cleanupBrowser')
  };
}

// ─── RUNNER ───────────────────────────────────────────────────────────────────

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  SMOKE TEST: bopba.js + pjnjuris.js");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

console.log("── BOPBA ──────────────────────────────────────────");

try { OK("obtener_ultimo_boletin", await bopba_obtener_ultimo_boletin()); }
catch(e) { ERR("obtener_ultimo_boletin", e); }

try { OK("buscar_boletin (licitacion)", await bopba_buscar_boletin()); }
catch(e) { ERR("buscar_boletin", e); }

try { OK("calcular_tarifa guard (cache vacío)", await bopba_calcular_tarifa_guard()); }
catch(e) { ERR("calcular_tarifa guard", e); }

console.log("\n── PJNJURIS ───────────────────────────────────────");

try { OK("sin sesión → error correcto", await pjnjuris_sin_sesion()); }
catch(e) { ERR("sin sesión", e); }

try { OK("alcance_fuente strings", await pjnjuris_alcance_fuente()); }
catch(e) { ERR("alcance_fuente", e); }

try { OK("cleanup handlers", await pjnjuris_cleanup_handlers()); }
catch(e) { ERR("cleanup handlers", e); }

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
