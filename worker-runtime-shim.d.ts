/**
 * Minimal offline fallback for the R2 runtime types used by this project.
 * `npm run cloudflare:types` replaces the generated binding file with the full
 * compatibility-date-specific Cloudflare runtime declarations when online.
 */
interface R2ObjectBody {
  body: ReadableStream<Uint8Array>;
  httpEtag: string;
}

interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
  };
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | string,
    options?: R2PutOptions,
  ): Promise<unknown>;
}
