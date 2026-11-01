import { Suspense } from 'react';
import { ProductsView } from '../../../components/products/ProductsView';

export default function ProductsPage() {
  // nuqs reads the search params on the client; the boundary keeps the rest of the shell renderable.
  return (
    <Suspense>
      <ProductsView />
    </Suspense>
  );
}
