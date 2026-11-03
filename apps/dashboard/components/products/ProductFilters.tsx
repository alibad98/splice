'use client';

import { useEffect, useRef, useState } from 'react';
import { PRODUCT_SEARCH_MAX } from '@slips/contracts';
import { Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@slips/ui';
import { useI18n } from '../../i18n/provider';

export const SEARCH_DEBOUNCE_MS = 300;

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
      <Field label={m.searchLabel} className="flex-1">
        <Input type="search" dir="auto" leadingIcon="search" value={term} maxLength={PRODUCT_SEARCH_MAX} placeholder={m.searchPlaceholder} onChange={(e) => setTerm(e.target.value)} />
      </Field>
      <Field label={m.categoryLabel} className="sm:w-56">
        <Select value={category} onValueChange={onCategory}>
          <SelectTrigger>
            <SelectValue placeholder={m.allCategories} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{m.allCategories}</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.external_id} value={c.external_id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
