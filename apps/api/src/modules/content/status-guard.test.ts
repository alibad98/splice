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
/** Live-DB composition tests, which seed through the admin pool (not an application write path). */
const SEEDING_TEST_RE = /^composition\/[^/]+\.test\.ts$/;

/** Story 3.4: product links are written only by content-lifecycle.ts; only the uninstall purge deletes them. */
const LINK_TABLE = String.raw`\s+(?:"?public"?\.)?"?content_product_links\b`;
const LINK_SQL_WRITE_RE = new RegExp(String.raw`(update(?:\s+only)?|insert\s+into|merge\s+into)` + LINK_TABLE, 'i');
const LINK_SQL_DELETE_RE = new RegExp(String.raw`delete\s+from` + LINK_TABLE, 'i');
const LINK_DRIZZLE_DELETE_RE = /\.delete\s*\(\s*(?:schema\.)?contentProductLinks\s*\)/;
const LINK_DRIZZLE_WRITE_RE = /\.(insert|update)\s*\(\s*(?:schema\.)?contentProductLinks\s*\)/;
const LINK_DRIZZLE_TABLE_RE = /\bcontentProductLinks\b/;

export function checkLinkWriteViolations(files: ReadonlyArray<{ relPath: string; source: string }>): string[] {
  const violations: string[] = [];
  for (const { relPath, source } of files) {
    const normalized = relPath.split(sep).join('/');
    if (normalized === 'modules/content/status-guard.test.ts') continue;
    if (normalized.startsWith('modules/content/')) {
      if ((normalized !== PURGE_FILE && LINK_SQL_DELETE_RE.test(source)) || LINK_DRIZZLE_DELETE_RE.test(source)) {
        violations.push(`${normalized}: hard-deletes content_product_links outside the uninstall purge`);
      } else if (normalized !== 'modules/content/content-lifecycle.ts' && (LINK_SQL_WRITE_RE.test(source) || LINK_DRIZZLE_WRITE_RE.test(source))) {
        violations.push(`${normalized}: writes content_product_links outside content-lifecycle.ts`);
      }
      continue;
    }
    if (LINK_SQL_WRITE_RE.test(source) || LINK_SQL_DELETE_RE.test(source)) violations.push(`${normalized}: SQL write to content_product_links outside modules/content`);
    if (LINK_DRIZZLE_TABLE_RE.test(source)) violations.push(`${normalized}: references drizzle contentProductLinks table outside modules/content`);
  }
  return violations;
}

/** Story 3.6: slides are written only by content-lifecycle.ts (soft delete); only the uninstall purge hard-deletes them. */
const SLIDE_TABLE = String.raw`\s+(?:"?public"?\.)?"?slides\b`;
const SLIDE_SQL_WRITE_RE = new RegExp(String.raw`(update(?:\s+only)?|insert\s+into|merge\s+into)` + SLIDE_TABLE, 'i');
const SLIDE_SQL_DELETE_RE = new RegExp(String.raw`delete\s+from` + SLIDE_TABLE, 'i');
const SLIDE_DRIZZLE_DELETE_RE = /\.delete\s*\(\s*(?:schema\.)?slides\s*\)/;
const SLIDE_DRIZZLE_WRITE_RE = /\.(insert|update)\s*\(\s*(?:schema\.)?slides\s*\)/;
const SLIDE_DRIZZLE_TABLE_RE = /\bschema\.slides\b|\{[^}]*\bslides\b[^}]*\}\s*=\s*schema\b/;

export function checkSlideWriteViolations(files: ReadonlyArray<{ relPath: string; source: string }>): string[] {
  const violations: string[] = [];
  for (const { relPath, source } of files) {
    const normalized = relPath.split(sep).join('/');
    if (normalized === 'modules/content/status-guard.test.ts') continue;
    if (normalized.startsWith('modules/content/')) {
      if ((normalized !== PURGE_FILE && SLIDE_SQL_DELETE_RE.test(source)) || SLIDE_DRIZZLE_DELETE_RE.test(source)) {
        violations.push(`${normalized}: hard-deletes slides outside the uninstall purge`);
      } else if (normalized !== 'modules/content/content-lifecycle.ts' && (SLIDE_SQL_WRITE_RE.test(source) || SLIDE_DRIZZLE_WRITE_RE.test(source))) {
        violations.push(`${normalized}: writes slides outside content-lifecycle.ts`);
      }
      continue;
    }
    if (SLIDE_SQL_WRITE_RE.test(source) || SLIDE_SQL_DELETE_RE.test(source)) violations.push(`${normalized}: SQL write to slides outside modules/content`);
    if (SLIDE_DRIZZLE_TABLE_RE.test(source)) violations.push(`${normalized}: references drizzle slides table outside modules/content`);
  }
  return violations;
}

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
      // Inside modules/content, only content-lifecycle.ts may insert or update content_items / contentItems,
      // and only the uninstall purge (content.lifecycle.ts) may hard-delete rows.
      if (normalized !== 'modules/content/status-guard.test.ts') {
        if (
          normalized !== PURGE_FILE &&
          (SQL_DELETE_RE.test(source) || /\.delete\s*\(\s*(?:schema\.)?contentItems\s*\)/.test(source))
        ) {
          violations.push(`${normalized}: hard-deletes content_items outside the uninstall purge`);
        } else if (
          normalized !== 'modules/content/content-lifecycle.ts' &&
          (SQL_WRITE_RE.test(source) || /\.(insert|update)\s*\(\s*(?:schema\.)?contentItems\s*\)/.test(source))
        ) {
          violations.push(`${normalized}: writes content_items outside content-lifecycle.ts`);
        }
      }
      continue;
    }
    // Composition tests may seed rows the lifecycle can no longer create (e.g. pre-3.3 legacy data) through the admin pool;
    // they are not an application write path. Production code everywhere else stays guarded.
    if (!SEEDING_TEST_RE.test(normalized) && (SQL_WRITE_RE.test(source) || SQL_DELETE_RE.test(source))) {
      violations.push(`${normalized}: SQL write to content_items outside modules/content`);
    }
    if (DRIZZLE_TABLE_RE.test(source)) {
      violations.push(`${normalized}: references drizzle contentItems table outside modules/content`);
    }
  }
  return violations;
}

describe('content_items and content_product_links write guard', () => {
  it('no file outside modules/content updates or inserts content_items or references contentItems', () => {
    const files = collectTsFiles(API_SRC).map((full) => ({
      relPath: relative(API_SRC, full),
      source: readFileSync(full, 'utf8'),
    }));
    expect(files.length).toBeGreaterThan(0);
    expect(checkStatusWriteViolations(files)).toEqual([]);
    expect(checkLinkWriteViolations(files)).toEqual([]);
    expect(checkSlideWriteViolations(files)).toEqual([]);
  });

  it('catches slides writes outside content-lifecycle.ts and deletes outside the purge (fixture)', () => {
    const fixtures = [
      { relPath: 'modules/media/rogue.ts', source: `await tx.query('update slides set alt_text = $1', [x]);` },
      { relPath: 'worker/rogue.ts', source: `const t = schema.slides;` },
      { relPath: 'modules/catalog/rogue.ts', source: `const { slides } = schema;` },
      { relPath: 'modules/content/content.service.ts', source: `await db.update(slides).set({ position: 1 });` },
      { relPath: 'modules/content/content-lifecycle.ts', source: `await db.delete(slides);` },
      { relPath: 'modules/content/content.repository.ts', source: `await tx.query('DELETE FROM "slides" WHERE id = $1');` },
      // Allowed: the lifecycle inserts and soft-deletes, the repository reads, the purge deletes.
      { relPath: 'modules/content/content-lifecycle.ts', source: `await db.insert(slides).values(v); await db.update(slides).set({ deletedAt: now });` },
      { relPath: 'modules/content/content.repository.ts', source: `const { contentItems, slides } = schema; await this.db.select().from(slides);` },
      { relPath: 'modules/content/content.lifecycle.ts', source: `await tx.query('delete from slides s using doomed');` },
    ];
    expect(checkSlideWriteViolations(fixtures)).toEqual([
      'modules/media/rogue.ts: SQL write to slides outside modules/content',
      'worker/rogue.ts: references drizzle slides table outside modules/content',
      'modules/catalog/rogue.ts: references drizzle slides table outside modules/content',
      'modules/content/content.service.ts: writes slides outside content-lifecycle.ts',
      'modules/content/content-lifecycle.ts: hard-deletes slides outside the uninstall purge',
      'modules/content/content.repository.ts: hard-deletes slides outside the uninstall purge',
    ]);
  });

  it('catches content_product_links writes outside content-lifecycle.ts and deletes outside the purge (fixture)', () => {
    const fixtures = [
      { relPath: 'modules/catalog/rogue.ts', source: `await tx.query('insert into content_product_links (id) values ($1)', [id]);` },
      { relPath: 'worker/rogue.ts', source: `const t = schema.contentProductLinks;` },
      { relPath: 'modules/content/content.service.ts', source: `await db.update(contentProductLinks).set({ productId: null });` },
      { relPath: 'modules/content/content-lifecycle.ts', source: `await db.delete(contentProductLinks);` },
      { relPath: 'modules/content/content.repository.ts', source: `await tx.query('DELETE FROM "content_product_links" WHERE id = $1');` },
      // Allowed: the lifecycle upserts, the purge deletes.
      { relPath: 'modules/content/content-lifecycle.ts', source: `await db.insert(contentProductLinks).values(v).onConflictDoUpdate(c);` },
      { relPath: 'modules/content/content.lifecycle.ts', source: `await tx.query('delete from content_product_links l using doomed');` },
    ];
    expect(checkLinkWriteViolations(fixtures)).toEqual([
      'modules/catalog/rogue.ts: SQL write to content_product_links outside modules/content',
      'worker/rogue.ts: references drizzle contentProductLinks table outside modules/content',
      'modules/content/content.service.ts: writes content_product_links outside content-lifecycle.ts',
      'modules/content/content-lifecycle.ts: hard-deletes content_product_links outside the uninstall purge',
      'modules/content/content.repository.ts: hard-deletes content_product_links outside the uninstall purge',
    ]);
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
      { relPath: 'modules/content/content-lifecycle.ts', source: `await db.delete(contentItems);` },
    ];
    const violations = checkStatusWriteViolations(fixtures);
    expect(violations).toHaveLength(12);
    expect(violations[9]).toContain('modules/content/rogue-delete.ts: hard-deletes content_items outside the uninstall purge');
    expect(violations[10]).toContain('modules/media/merge.ts: SQL write to content_items outside modules/content');
    expect(violations[11]).toContain('modules/content/content-lifecycle.ts: hard-deletes content_items outside the uninstall purge');
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

  it('lets composition tests seed content_items through SQL, but not nested or non-test files there (fixture)', () => {
    const seed = `await admin.query("update content_items set cta_style = 'x' where id = $1", [id]);`;
    expect(
      checkStatusWriteViolations([
        { relPath: 'composition/content.test.ts', source: seed },
        { relPath: 'composition/helpers.ts', source: seed },
        { relPath: 'composition/nested/rogue.test.ts', source: seed },
        { relPath: 'composition/content.test.ts', source: 'const t = schema.contentItems;' },
      ]),
    ).toEqual([
      'composition/helpers.ts: SQL write to content_items outside modules/content',
      'composition/nested/rogue.test.ts: SQL write to content_items outside modules/content',
      'composition/content.test.ts: references drizzle contentItems table outside modules/content',
    ]);
  });
});
