import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ar } from '../i18n/messages/ar';
import { en } from '../i18n/messages/en';
import { physicalClassPattern, physicalCssPattern } from '../eslint-rules/direction.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

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
const uiSources = [...walk(join(root, 'app')), ...walk(join(root, 'components'))].filter((f) => {
  const norm = f.replaceAll('\\', '/');
  return /\.tsx$/.test(f) && !isTest(f) && !norm.includes('/app/admin/');
});
const hasLetters = (s: string) => /[A-Za-z؀-ۿ]/.test(s);
const textAttrs = new Set(['alt', 'title', 'aria-label', 'aria-description', 'placeholder', 'label']);

const isStringy = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);
const stringyText = (n: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression): string =>
  ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map((sp) => sp.literal.text)].join(' ') : n.text;

function hardcodedStrings(file: string, code = readFileSync(file, 'utf8')): string[] {
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && hasLetters(n.text)) found.push(n.text.trim());
    if (ts.isJsxAttribute(n) && textAttrs.has(n.name.getText()) && n.initializer) {
      const v = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
      if (v && isStringy(v) && hasLetters(stringyText(v))) found.push(`${n.name.getText()}=${stringyText(v)}`);
    }
    // string-ish JSX children: {'x'}, {`x`}, {`x ${y}`}, {cond ? 'a' : 'b'}, {a && 'x'}
    if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      const check = (e: ts.Expression) => {
        if (isStringy(e)) { if (hasLetters(stringyText(e))) found.push(stringyText(e)); }
        else if (ts.isConditionalExpression(e)) { check(e.whenTrue); check(e.whenFalse); }
        else if (ts.isBinaryExpression(e)) { check(e.left); check(e.right); }
        else if (ts.isParenthesizedExpression(e)) check(e.expression);
      };
      check(n.expression);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return found;
}

function unsafeBlankLinks(file: string, code = readFileSync(file, 'utf8')): string[] {
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bad: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const attr = (name: string) => n.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
      const text = (a?: ts.JsxAttribute) => (a?.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : undefined);
      if (text(attr('target')) === '_blank') {
        const rel = (text(attr('rel')) ?? '').split(/\s+/);
        if (!rel.includes('noopener') || !rel.includes('noreferrer')) bad.push(n.getText().slice(0, 60));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return bad;
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
    expect(hardcodedStrings('x.tsx', '<p title="Hi there">Hello</p>')).toEqual(['title=Hi there', 'Hello']);
    expect(hardcodedStrings('x.tsx', "<p>{'مرحبا'}</p>")).toEqual(['مرحبا']);
    expect(hardcodedStrings('x.tsx', '<p className="a" aria-hidden="true">{t.x}</p>')).toEqual([]);
    expect(hardcodedStrings('x.tsx', '<p>{`Hello`}</p>')).toEqual(['Hello']);
    expect(hardcodedStrings('x.tsx', '<p>{`Hello ${name}`}</p>')).toEqual(['Hello  ']);
    expect(hardcodedStrings('x.tsx', "<p>{ok ? 'Yes' : 'No'}</p>")).toEqual(['Yes', 'No']);
    expect(hardcodedStrings('x.tsx', "<p>{ok && 'Shown'}</p>")).toEqual(['Shown']);
    expect(hardcodedStrings('x.tsx', '<img alt={`A photo`} />')).toEqual(['alt=A photo']);
    expect(hardcodedStrings('x.tsx', "<img alt={'A photo'} />")).toEqual(['alt=A photo']);
    expect(hardcodedStrings('x.tsx', '<img alt={t.alt} />')).toEqual([]);
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
  it('every target="_blank" element has rel noopener noreferrer (AST)', () => {
    for (const f of sources.filter((x) => x.endsWith('.tsx'))) expect(unsafeBlankLinks(f), f).toEqual([]);
  });
  it('rel check self-test catches unsafe links, arrow functions included', () => {
    expect(unsafeBlankLinks('x.tsx', '<a href="x" target="_blank" onClick={() => go()}>x</a>')).toHaveLength(1);
    expect(unsafeBlankLinks('x.tsx', '<a target="_blank" rel="noopener">x</a>')).toHaveLength(1);
    expect(unsafeBlankLinks('x.tsx', '<a target="_blank" rel="noopener noreferrer" onClick={() => go()}>x</a>')).toEqual([]);
  });
  it('shell has no nested scroll containers', () => {
    for (const f of sources) expect(readFileSync(f, 'utf8'), f).not.toMatch(/overflow-(y-)?(auto|scroll)/);
  });
});
