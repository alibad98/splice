import { Suspense } from 'react';
import { ContentEditorPage } from '../../../../components/content/editor/ContentEditorPage';

export default async function EditContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ContentEditorPage id={id} />
    </Suspense>
  );
}
