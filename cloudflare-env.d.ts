declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BOOTSTRAP_PASSWORD?: string;
    OWNER_EMAIL?: string;
    BUCKET?: R2Bucket;
  }
}
