'use client';

import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { CTA_ACTIONS, CTA_STYLES, type CtaAction, type CtaStyle } from '@slips/contracts';
import { Card, CardTitle, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@slips/ui';
import { directionOf } from '../../../i18n/config';
import { useI18n } from '../../../i18n/provider';
import { fill } from '../../products/format';
import { fieldId, type EditorErrorKey, type EditorValues } from './form';

/** How each preset style draws the button (tokens only). Shared with the preview placeholder. */
export const CTA_STYLE_CLASSES: Record<CtaStyle, string> = {
  ink: 'bg-foreground text-background border-foreground',
  light: 'bg-background text-foreground border-border',
  outline: 'bg-transparent text-foreground border-foreground',
};

/** The CTA: button text with quick picks, the action, the store link (open link only) and the preset style. */
export function CtaCard({ domains }: { domains: readonly string[] }) {
  const { locale, messages } = useI18n();
  const m = messages.content.editor;
  const {
    control,
    register,
    setValue,
    clearErrors,
    formState: { errors },
  } = useFormContext<EditorValues>();
  const action = useWatch({ control, name: 'cta_action' });
  const label = useWatch({ control, name: 'cta_label' });
  const domain = domains[0] ?? '';
  const message = (key: string | undefined) => (key ? fill(m.errors[key as EditorErrorKey], { domain }) : undefined);
  const picks = [m.cta.picks.addToCart, m.cta.picks.shopNow];

  return (
    <Card>
      <CardTitle>{m.cta.heading}</CardTitle>
      <div className="flex flex-col gap-4">
        <Field label={m.cta.label} htmlFor={fieldId('cta_label')} error={message(errors.cta_label?.message)}>
          <Input dir="auto" autoComplete="off" {...register('cta_label')} />
        </Field>
        <div role="group" aria-label={m.cta.quickPicks} className="-mt-2 flex flex-wrap gap-2">
          {picks.map((pick) => (
            <button
              key={pick}
              type="button"
              aria-pressed={label === pick}
              onClick={() => setValue('cta_label', pick, { shouldDirty: true, shouldTouch: true, shouldValidate: true })}
              className={cn(
                'inline-flex min-h-8 items-center rounded-pill border px-3 text-small font-semibold transition-colors duration-150',
                label === pick ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground hover:border-foreground/45',
              )}
            >
              {pick}
            </button>
          ))}
        </div>

        <Field label={m.cta.action} htmlFor={fieldId('cta_action')}>
          <Controller
            name="cta_action"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value}
                dir={directionOf(locale)}
                onValueChange={(v) => {
                  field.onChange(v as CtaAction);
                  // Leaving open link clears the URL; it is saved as null.
                  if (v !== 'open_link') {
                    setValue('cta_url', '', { shouldDirty: true });
                    clearErrors('cta_url');
                  }
                }}
              >
                <SelectTrigger onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CTA_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {m.cta.actions[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        {action === 'open_link' ? (
          <Field label={m.cta.url} htmlFor={fieldId('cta_url')} error={message(errors.cta_url?.message)} hint={domain ? fill(m.cta.urlHint, { domain }) : undefined}>
            <Input type="url" dir="ltr" inputMode="url" autoComplete="off" placeholder={fill(m.cta.urlPlaceholder, { domain: domain || 'example.com' })} {...register('cta_url')} />
          </Field>
        ) : null}

        <Controller
          name="cta_style"
          control={control}
          render={({ field }) => (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-small font-semibold text-foreground">{m.cta.style}</legend>
              <div className="flex flex-wrap gap-3">
                {CTA_STYLES.map((style) => (
                  <label key={style} className="cursor-pointer">
                    <input
                      type="radio"
                      name={field.name}
                      value={style}
                      checked={field.value === style}
                      onChange={() => field.onChange(style)}
                      onBlur={field.onBlur}
                      className="peer sr-only"
                    />
                    <span className="flex flex-col items-center gap-1.5 rounded-md border border-border bg-muted p-2 transition-colors peer-checked:border-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-0 peer-focus-visible:outline-ring">
                      <span aria-hidden="true" className={cn('inline-flex h-6 w-16 items-center justify-center rounded-pill border-2', CTA_STYLE_CLASSES[style])} />
                      <span className="text-small font-medium">{m.cta.styles[style]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        />
      </div>
    </Card>
  );
}
