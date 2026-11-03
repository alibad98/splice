import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const API_SRC = fileURLToPath(new URL('../../', import.meta.url));

const TABLE = String.raw`\s+(?:"?public"?\.)?"?content_items\b`;
const SQL_WRITE_RE = new RegExp(String.raw`(update(?:\s+only)?|insert\s+into|merge\s+into)` + TABLE, 'i');
const SQL_DELETE_RE = new RegExp(String.raw`delete\s+from` + TABLE, 'i');
/** The uninstall purge (StoreDataLifecycle) is the one sanctioned hard delete. */
const PURGE_FILE = 'modules/content/content.lifecycle.ts';
const DRIZZLE_TABLE_RE = /\bcontentItems\b/;

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

export function checkStatusWriteViolations(files: ReadonlyArray<{ relPath: string; source: string }>): string[] {
  const violations: string[] = [];
  for (const { relPath, source } of files) {
    const normalized = relPath.split(sep).join('/');
    if (normalized.startsWith('modules/content/')) {
      // Inside modules/content, only content-lifecycle.ts may insert or update content_items / contentItems.
      if (normalized !== 'modules/content/content-lifecycle.ts' && normalized !== 'modules/content/status-guard.test.ts') {
        if (SQL_WRITE_RE.test(source) || /\.(insert|update|delete)\s*\(\s*(?:schema\.)?contentItems\s*\)/.test(source)) {
          violations.push(`${normalized}: writes content_items outside content-lifecycle.ts`);
        } else if (normalized !== PURGE_FILE && SQL_DELETE_RE.test(source)) {
          violations.push(`${normalized}: hard-deletes content_items outside the uninstall purge`);
        }
      }
      continue;
    }
    if (SQL_WRITE_RE.test(source) || SQL_DELETE_RE.test(source)) {
      violations.push(`${normalized}: SQL write to content_items outside modules/content`);
    }
    if (DRIZZLE_TABLE_RE.test(source)) {
      violations.push(`${normalized}: references drizzle contentItems table outside modules/content`);
    }
  }
  return violations;
}

describe('content_items status write guard', () => {
  it('no file outside modules/content updates or inserts content_items or references contentItems', () => {
    const files = collectTsFiles(API_SRC).map((full) => ({
      relPath: relative(API_SRC, full),
      source: readFileSync(full, 'utf8'),
    }));
    expect(files.length).toBeGreaterThan(0);
    expect(checkStatusWriteViolations(files)).toEqual([]);
  });

  it('catches SQL writes and drizzle contentItems imports outside modules/content (fixture)', () => {
    const fixtures = [
      { relPath: 'modules/media/rogue.ts', source: `await tx.query('UPDATE content_items SET status = $1', ['published']);` },
      { relPath: 'modules/billing/rogue.ts', source: `await tx.query('INSERT INTO "content_items" (id) VALUES ($1)', [id]);` },
      { relPath: 'modules/media/qualified-update.ts', source: `await tx.query('update public.content_items set status = $1');` },
      { relPath: 'modules/media/qualified-insert.ts', source: `await tx.query('insert into "public"."content_items" (id) values ($1)');` },
      { relPath: 'worker/rogue.ts', source: `import { schema } from '@slips/db'; const t = schema.contentItems;` },
      { relPath: 'modules/content/other.ts', source: `await db.update(contentItems).set({ status: 'published' });` },
      { relPath: 'modules/media/hard-delete.ts', source: `await tx.query('DELETE FROM content_items WHERE id = $1', [id]);` },
      { relPath: 'modules/media/update-only.ts', source: `await tx.query('UPDATE ONLY content_items SET status = $1');` },
      { relPath: 'modules/content/other-delete.ts', source: `await db.delete(schema.contentItems);` },
      { relPath: 'modules/content/rogue-delete.ts', source: `await tx.query('delete from content_items where store_id = $1', [storeId]);` },
      { relPath: 'modules/media/merge.ts', source: `await tx.query('MERGE INTO content_items c USING src s ON c.id = s.id WHEN MATCHED THEN UPDATE SET status = s.status');` },
    ];
    const violations = checkStatusWriteViolations(fixtures);
    expect(violations).toHaveLength(11);
    expect(violations[9]).toContain('modules/content/rogue-delete.ts: hard-deletes content_items outside the uninstall purge');
    expect(violations[10]).toContain('modules/media/merge.ts: SQL write to content_items outside modules/content');
    expect(violations[6]).toContain('modules/media/hard-delete.ts');
    expect(violations[7]).toContain('modules/media/update-only.ts');
    expect(violations[8]).toContain('modules/content/other-delete.ts');
    expect(violations[0]).toContain('modules/media/rogue.ts');
    expect(violations[1]).toContain('modules/billing/rogue.ts');
    expect(violations[2]).toContain('modules/media/qualified-update.ts');
    expect(violations[3]).toContain('modules/media/qualified-insert.ts');
    expect(violations[4]).toContain('worker/rogue.ts');
    expect(violations[5]).toContain('modules/content/other.ts');
  });
});
