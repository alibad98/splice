'use client';

import { Controller, useFormContext } from 'react-hook-form';
import { CONTENT_FORMATS, type ContentFormat } from '@slips/contracts';
import { Card, CardTitle, Field, Input, Tabs, TabsList, TabsTrigger } from '@slips/ui';
import { directionOf } from '../../../i18n/config';
import { useI18n } from '../../../i18n/provider';
import { fieldId, type EditorErrorKey, type EditorValues } from './form';

/** Format (Story/Reel segmented control) and title. */
export function FormatTitleCard({ autoFocusTitle = false }: { autoFocusTitle?: boolean }) {
  const { locale, messages } = useI18n();
  const m = messages.content.editor;
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<EditorValues>();
  const titleError = errors.title?.message as EditorErrorKey | undefined;
  const formatId = fieldId('format');

  return (
    <Card>
      <CardTitle>{m.formatTitle.heading}</CardTitle>
      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <Field label={m.formatTitle.format} htmlFor={formatId}>
          <Controller
            name="format"
            control={control}
            render={({ field }) => (
              <Tabs value={field.value} onValueChange={(v) => field.onChange(v as ContentFormat)} dir={directionOf(locale)}>
                <TabsList id={formatId} aria-labelledby={`${formatId}-label`} className="w-full sm:w-auto" onBlur={field.onBlur}>
                  {CONTENT_FORMATS.map((f) => (
                    <TabsTrigger key={f} value={f} className="flex-1 sm:flex-none">
                      {messages.content.formats[f]}
                    </TabsTrigger>
                  ))}
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
