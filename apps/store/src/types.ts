export interface StoreConfig {
  business: {
    name: string;
    tagline?: string;
    accentColor?: string;
    minOrderAmount?: string;
    deliveryNote?: string;
    whatsappNumber?: string;
    currency: string;
    phone?: string;
    email?: string;
    city?: string;
    state?: string;
    address?: string;
  };
  items: StoreItem[];
  categories: string[];
}

export interface StoreItem {
  id: string;
  name: string;
  description?: string;
  price: string;
  unit: string;
  category?: string;
  inStock: boolean;
  lowStock?: boolean;
  sortOrder: number;
}

export interface CartItem {
  item: StoreItem;
  quantity: number;
}

export interface OrderResult {
  orderId: string;
  orderNumber: string;
  totalAmount: string;
  message?: string;
}
