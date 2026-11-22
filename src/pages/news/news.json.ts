// The news file as collected (v0.3.0), published at /finance/news/news.json. The next collection
// reads it back as its previous state (tools/news/collect.mjs --previous), so a failed feed keeps
// its stories and its last success without any other storage. Without a news file: an empty one.
import { existsSync, readFileSync } from 'node:fs';

export function GET() {
  const file = process.env.NEWS_FILE;
  let body = '{"schema":"rmf.news/1","generated_at":null,"last_success":null,"sources":[],"items":[]}\n';
  try {
    if (file && existsSync(file)) {
      const text = readFileSync(file, 'utf8');
      if ((JSON.parse(text) as { schema?: unknown }).schema === 'rmf.news/1') body = text;
    }
  } catch {
    // An unreadable file publishes the empty one; the next collection starts afresh.
  }
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
