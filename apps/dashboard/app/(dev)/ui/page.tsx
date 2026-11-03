import { notFound } from 'next/navigation';
import { Gallery } from './Gallery';

/** Dev-only gallery of the `packages/ui` kit (UI-kit spec). 404 in production builds. */
export default function UiGalleryPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Gallery />;
}
