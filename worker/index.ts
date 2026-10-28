/** Cloudflare Worker entry point for Bienen Doku. */
import handler from "vinext/server/app-router-entry";
import type { ExecutionContextLike } from "vinext/shims/request-context";

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/compliance-check" && request.method === "GET") {
      const sources = [
        { title: "LWG Bayern · Varroamittel", url: "https://www.lwg.bayern.de/varroa" },
        { title: "EU-Tierarzneimittel-Datenbank", url: "https://medicines.health.europa.eu/veterinary/de" },
        { title: "Tierseuchenmeldeverordnung", url: "https://www.gesetze-im-internet.de/tierseuchmeldv/BJNR03D0B0026.html" },
        { title: "LAVES · Varroose-Meldepflicht", url: "https://www.laves.niedersachsen.de/startseite/tiere/bienenkunde/informationsmaterial/die-tierseuchenmeldeverordnung-eine-gesetzliche-neuregelung-die-auch-die-imkerei-insgesamt-betrifft-251779.html" },
      ];
      const checked = await Promise.all(sources.map(async (source) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        try {
          const response = await fetch(source.url, {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: { accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8", range: "bytes=0-2047" },
          });
          await response.body?.cancel();
          return { ...source, ok: response.ok, status: response.status, lastModified: response.headers.get("last-modified") };
        } catch {
          return { ...source, ok: false, status: 0, lastModified: null };
        } finally {
          clearTimeout(timeout);
        }
      }));
      return Response.json({ checkedAt: new Date().toISOString(), allReachable: checked.every((source) => source.ok), sources: checked }, {
        headers: { "cache-control": "no-store" },
      });
    }

    if (url.pathname.startsWith("/api/sync/")) {
      const id = url.pathname.slice("/api/sync/".length);
      if (!/^[a-f0-9]{64}$/.test(id)) return new Response("Ungültiger Sync-Schlüssel", { status: 400 });
      const key = `sync/${id}.json`;
      if (request.method === "GET") {
        const object = await env.SYNC_BUCKET.get(key);
        if (!object) return new Response(null, { status: 404 });
        return new Response(object.body, { headers: { "content-type": "application/json", etag: object.httpEtag, "cache-control": "no-store" } });
      }
      if (request.method === "PUT") {
        const length = Number(request.headers.get("content-length") || 0);
        if (length > 40 * 1024 * 1024) return new Response("Sync-Datei zu groß", { status: 413 });
        const body = await request.arrayBuffer();
        if (!body.byteLength) return new Response("Inhalt fehlt", { status: 400 });
        if (body.byteLength > 40 * 1024 * 1024) return new Response("Sync-Datei zu groß", { status: 413 });
        await env.SYNC_BUCKET.put(key, body, { httpMetadata: { contentType: "application/json" } });
        return Response.json({ saved: true, savedAt: new Date().toISOString() });
      }
      return new Response("Methode nicht erlaubt", { status: 405, headers: { allow: "GET, PUT" } });
    }

    return handler.fetch(request, undefined, ctx);
  },
};

export default worker;
