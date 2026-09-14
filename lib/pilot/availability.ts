type Product = { active: number; price: number | null; tax_bp: number | null; stock: number; preorder: number };

// Shared by the storefront and inventory so a disabled control always has a reason.
export function availability(product: Product) {
  if (product.price == null || product.price <= 0 || product.tax_bp == null) return 'Needs details';
  if (!product.active) return 'Hidden';
  if (!product.preorder && product.stock <= 0) return 'Out of stock';
  return product.preorder ? 'Preorder' : 'Available';
}

export function readyForSale(product: Product) {
  return ['Available', 'Preorder'].includes(availability(product));
}
