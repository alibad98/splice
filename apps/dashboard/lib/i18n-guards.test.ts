import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ar } from '../i18n/messages/ar';
import { en } from '../i18n/messages/en';
import { physicalClassPattern, physicalCssPattern } from '../eslint-rules/direction.js';

const root = new URL('..', import.meta.url).pathname;
const repoRoot = new URL('../../..', import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function flatKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => flatKeys(v, prefix ? `${prefix}.${k}` : k));
}

const isTest = (f: string) => /\.test\.tsx?$/.test(f);
// /admin is the English-only internal back-office (Epic 7), outside the merchant i18n requirement.
const uiSources = [...walk(join(root, 'app')), ...walk(join(root, 'components'))].filter((f) => /\.tsx$/.test(f) && !isTest(f) && !f.includes('/app/admin/'));
const hasLetters = (s: string) => /[A-Za-z؀-ۿ]/.test(s);
const textAttrs = new Set(['alt', 'title', 'aria-label', 'aria-description', 'placeholder', 'label']);

function hardcodedStrings(file: string, code = readFileSync(file, 'utf8')): string[] {
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && hasLetters(n.text)) found.push(n.text.trim());
    if (ts.isJsxAttribute(n) && textAttrs.has(n.name.getText()) && n.initializer && ts.isStringLiteral(n.initializer) && hasLetters(n.initializer.text)) found.push(`${n.name.getText()}="${n.initializer.text}"`);
    if (ts.isJsxExpression(n) && n.expression && ts.isStringLiteral(n.expression) && ts.isJsxElement(n.parent) && hasLetters(n.expression.text)) found.push(n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(src);
  return found;
}

describe('message catalogs', () => {
  it('ar and en have identical keys', () => {
    expect(flatKeys(ar).sort()).toEqual(flatKeys(en).sort());
  });
  it('has no empty values and no emoji', () => {
    for (const catalog of [ar, en]) {
      for (const key of flatKeys(catalog)) {
        const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], catalog) as string;
        expect(value.trim(), key).not.toBe('');
        expect(/\p{Extended_Pictographic}/u.test(value), key).toBe(false);
      }
    }
  });
});

describe('no hard-coded user-facing strings', () => {
  it('scans the shell and pages', () => expect(uiSources.length).toBeGreaterThan(5));
  it.each(uiSources.map((f) => [relative(root, f), f] as const))('%s', (_name, file) => {
    expect(hardcodedStrings(file)).toEqual([]);
  });
  it('detects hard-coded text, attributes and expression strings (self-check)', () => {
    expect(hardcodedStrings('x.tsx', '<p title="Hi there">Hello</p>')).toEqual(['title="Hi there"', 'Hello']);
    expect(hardcodedStrings('x.tsx', "<p>{'مرحبا'}</p>")).toEqual(['مرحبا']);
    expect(hardcodedStrings('x.tsx', '<p className="a" aria-hidden="true">{t.x}</p>')).toEqual([]);
  });
});

describe('logical properties only', () => {
  it.each(['ml-2', 'mr-4', 'pl-3', 'pr-1', 'left-0', 'right-2', 'text-left', 'border-l', 'rounded-r-lg', 'flex ml-2', 'md:pr-4', '-ml-1'])('flags %s', (cls) => {
    expect(physicalClassPattern.test(cls)).toBe(true);
  });
  it.each(['ms-2', 'me-4', 'ps-3', 'pe-1', 'start-0', 'end-2', 'text-start', 'border-s', 'rounded-s-lg', 'min-h-11 mx-auto', 'text-small', 'p-2 pt-3'])('allows %s', (cls) => {
    expect(physicalClassPattern.test(cls)).toBe(false);
  });
  it('dashboard and ui stylesheets use no physical properties', () => {
    const css = [...walk(root), ...walk(join(repoRoot, 'packages/ui/src'))].filter((f) => f.endsWith('.css'));
    expect(css.length).toBeGreaterThan(0);
    for (const f of css) {
      const offending = readFileSync(f, 'utf8').split('\n').filter((l) => physicalCssPattern.test(l));
      expect(offending, f).toEqual([]);
    }
  });
});

describe('iframe safety', () => {
  const sources = [...walk(join(root, 'app')), ...walk(join(root, 'components'))].filter((f) => /\.tsx?$/.test(f) && !isTest(f));
  it('no source touches window.top or top.location', () => {
    for (const f of sources) expect(readFileSync(f, 'utf8'), f).not.toMatch(/window\.top|top\.location|window\.parent/);
  });
  it('every target="_blank" link has rel noopener noreferrer', () => {
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      for (const tag of text.match(/<a\b[^>]*>/g) ?? []) {
        if (tag.includes('target="_blank"')) expect(tag, f).toContain('rel="noopener noreferrer"');
      }
    }
  });
  it('shell has no nested scroll containers', () => {
    for (const f of sources) expect(readFileSync(f, 'utf8'), f).not.toMatch(/overflow-(y-)?(auto|scroll)/);
  });
});
