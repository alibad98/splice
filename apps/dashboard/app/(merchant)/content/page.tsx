import { Suspense } from 'react';
import { ContentView } from '../../../components/content/ContentView';

export default function ContentPage() {
  // nuqs reads the search params on the client; the boundary keeps the rest of the shell renderable.
  return (
    <Suspense>
      <ContentView />
    </Suspense>
  );
}
