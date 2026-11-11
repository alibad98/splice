'use client';

import { useId } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { CONTENT_FORMATS, type ContentFormat } from '@slips/contracts';
import { Card, CardTitle, Field, Input, Tabs, TabsList, TabsTrigger, cn } from '@slips/ui';
import { directionOf } from '../../../i18n/config';
import { useI18n } from '../../../i18n/provider';
import { fieldId, type EditorErrorKey, type EditorValues } from './form';

/**
 * Format (Story/Reel segmented control) and title. `reelUnavailable` (Story 4.2 pilot slice): the Reel segment stays
 * visible and focusable but cannot be chosen, and its localized reason shows inline and is announced with it. Items that
 * are already Reels keep the choice so their drafts stay editable.
 */
export function FormatTitleCard({ autoFocusTitle = false, reelUnavailable = false }: { autoFocusTitle?: boolean; reelUnavailable?: boolean }) {
  const { locale, messages } = useI18n();
  const m = messages.content.editor;
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<EditorValues>();
  const titleError = errors.title?.message as EditorErrorKey | undefined;
  const formatId = fieldId('format');
  const reelReasonId = useId();

  return (
    <Card>
      <CardTitle>{m.formatTitle.heading}</CardTitle>
      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <Field label={m.formatTitle.format} htmlFor={formatId} hint={reelUnavailable ? m.formatTitle.reelUnavailable : undefined} descriptionId={reelReasonId}>
          <Controller
            name="format"
            control={control}
            render={({ field }) => (
              <Tabs
                value={field.value}
                onValueChange={(v) => {
                  // An unavailable segment can take focus but never becomes the value.
                  if (v === 'reel' && reelUnavailable) return;
                  field.onChange(v as ContentFormat);
                }}
                dir={directionOf(locale)}
              >
                <TabsList id={formatId} aria-labelledby={`${formatId}-label`} className="w-full sm:w-auto" onBlur={field.onBlur}>
                  {CONTENT_FORMATS.map((f) => {
                    const unavailable = f === 'reel' && reelUnavailable;
                    return (
                      <TabsTrigger
                        key={f}
                        value={f}
                        aria-disabled={unavailable || undefined}
                        aria-describedby={unavailable ? reelReasonId : undefined}
                        className={cn('flex-1 sm:flex-none', unavailable && 'cursor-not-allowed opacity-50 hover:text-muted-foreground')}
                      >
                        {messages.content.formats[f]}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>
            )}
          />
        </Field>
        <Field label={m.formatTitle.title} htmlFor={fieldId('title')} error={titleError ? m.errors[titleError] : undefined}>
          <Input dir="auto" autoComplete="off" placeholder={m.formatTitle.titlePlaceholder} autoFocus={autoFocusTitle} {...register('title')} />
        </Field>
      </div>
    </Card>
  );
}
