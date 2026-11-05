import { Suspense } from 'react';
import { ContentEditor } from '../../../../components/content/editor/ContentEditor';

export default function NewContentPage() {
  // LangLink reads the search params on the client; the boundary keeps the rest of the shell renderable.
  return (
    <Suspense>
      <ContentEditor />
    </Suspense>
  );
}
