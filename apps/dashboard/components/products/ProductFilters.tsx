'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { PRODUCT_SEARCH_MAX } from '@slips/contracts';
import { useI18n } from '../../i18n/provider';

export const SEARCH_DEBOUNCE_MS = 300;

const field = 'h-9 rounded-md border border-input-border bg-background px-3 text-body';

interface Props {
  q: string;
  category: string;
  categories: ReadonlyArray<{ external_id: string; name: string }>;
  onSearch: (q: string) => void;
  onCategory: (category: string) => void;
}

/** Name search (debounced 300 ms) and category filter. The URL is the source of truth; the box follows it on Back. */
export function ProductFilters({ q, category, categories, onSearch, onCategory }: Props) {
  const { messages } = useI18n();
  const m = messages.products;
  const searchId = useId();
  const categoryId = useId();
  const [term, setTerm] = useState(q);
  const latest = useRef(q);

  // The URL changed from outside (Back, Show all): show its value.
  useEffect(() => {
    latest.current = q;
    setTerm(q);
  }, [q]);

  useEffect(() => {
    if (term === latest.current) return;
    const id = setTimeout(() => {
      latest.current = term;
      onSearch(term);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term, onSearch]);

  return (
    <div role="search" className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor={searchId} className="text-small text-muted-foreground">
          {m.searchLabel}
        </label>
        <input id={searchId} type="search" dir="auto" value={term} maxLength={PRODUCT_SEARCH_MAX} placeholder={m.searchPlaceholder} onChange={(e) => setTerm(e.target.value)} className={field} />
      </div>
      <div className="flex flex-col gap-1 sm:w-56">
        <label htmlFor={categoryId} className="text-small text-muted-foreground">
          {m.categoryLabel}
        </label>
        <select id={categoryId} value={category} onChange={(e) => onCategory(e.target.value)} className={field}>
          <option value="">{m.allCategories}</option>
          {categories.map((c) => (
            <option key={c.external_id} value={c.external_id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
