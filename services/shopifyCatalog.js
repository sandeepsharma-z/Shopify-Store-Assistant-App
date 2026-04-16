const axios = require('axios');

const logger = require('../utils/logger');

const SHOPIFY_STOREFRONT_TIMEOUT_MS = Number(process.env.SHOPIFY_STOREFRONT_TIMEOUT_MS || 15000);
const SHOPIFY_CATALOG_CACHE_TTL_MS = Number(process.env.SHOPIFY_CATALOG_CACHE_TTL_MS || 300000);
const SHOPIFY_STOREFRONT_API_VERSION =
  (process.env.SHOPIFY_STOREFRONT_API_VERSION || '2025-07').trim() || '2025-07';

const cache = new Map();

const CATALOG_QUERY = `
  query CatalogSearch(
    $productFirst: Int!
    $collectionFirst: Int!
    $productQuery: String
    $collectionQuery: String
  ) {
    products(first: $productFirst, query: $productQuery) {
      edges {
        node {
          id
          title
          handle
          onlineStoreUrl
          availableForSale
          vendor
          productType
          description
          featuredImage {
            url
            altText
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }
          compareAtPriceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          collections(first: 3) {
            edges {
              node {
                title
                handle
                onlineStoreUrl
              }
            }
          }
        }
      }
    }
    collections(first: $collectionFirst, query: $collectionQuery) {
      edges {
        node {
          id
          title
          handle
          description
          onlineStoreUrl
          image {
            url
            altText
          }
          products(first: 4) {
            edges {
              node {
                id
                title
                handle
                onlineStoreUrl
                availableForSale
                priceRange {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const DEFAULT_CATALOG_SUGGESTIONS = [
  'Find products',
  'Browse collections',
  'Track my order',
  'Order ID status',
];

const PRODUCT_HINTS = [
  'product',
  'products',
  'item',
  'items',
  'price',
  'cost',
  'buy',
  'shop',
  'store',
  'available',
  'availability',
  'stock',
  'in stock',
  'out of stock',
  'have',
  'show',
  'find',
  'search',
];

const COLLECTION_HINTS = ['collection', 'collections', 'category', 'categories'];

const FILLER_PATTERNS = [
  /\bdo you have\b/gi,
  /\bshow me\b/gi,
  /\bshow\b/gi,
  /\bfind me\b/gi,
  /\bfind\b/gi,
  /\bsearch\b/gi,
  /\bbrowse\b/gi,
  /\blist\b/gi,
  /\btell me about\b/gi,
  /\blooking for\b/gi,
  /\bi want\b/gi,
  /\bi need\b/gi,
  /\bcan you\b/gi,
  /\bwhat is\b/gi,
  /\bwhat are\b/gi,
  /\bproducts?\b/gi,
  /\bitems?\b/gi,
  /\bcollections?\b/gi,
  /\bcategories?\b/gi,
  /\bcategory\b/gi,
  /\bprice\b/gi,
  /\bcost\b/gi,
  /\bavailable\b/gi,
  /\bavailability\b/gi,
  /\bin stock\b/gi,
  /\bout of stock\b/gi,
  /\bshop\b/gi,
  /\bstore\b/gi,
  /\bplease\b/gi,
];

function getStorefrontConfig(preferredShopDomain) {
  const shopDomain = String(preferredShopDomain || process.env.SHOPIFY_STORE_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const accessToken = String(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || '').trim();

  if (!shopDomain || !accessToken) {
    return null;
  }

  return {
    shopDomain,
    accessToken,
    apiVersion: SHOPIFY_STOREFRONT_API_VERSION,
  };
}

function buildStorefrontUrl(config) {
  return `https://${config.shopDomain}/api/${config.apiVersion}/graphql.json`;
}

function getCachedValue(key) {
  const cachedEntry = cache.get(key);

  if (!cachedEntry) {
    return null;
  }

  if (Date.now() >= cachedEntry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return cachedEntry.value;
}

function setCachedValue(key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + SHOPIFY_CATALOG_CACHE_TTL_MS,
  });
}

function firstText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stripHtml(value) {
  return firstText(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

function formatMoney(price) {
  if (!price || !price.currencyCode) {
    return null;
  }

  const amount = Number(price.amount);

  if (!Number.isFinite(amount)) {
    return `${price.amount} ${price.currencyCode}`;
  }

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: price.currencyCode,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch (error) {
    return `${price.currencyCode} ${amount}`;
  }
}

function buildProductUrl(shopDomain, handle, onlineStoreUrl) {
  if (firstText(onlineStoreUrl)) {
    return onlineStoreUrl.trim();
  }

  if (!shopDomain || !handle) {
    return null;
  }

  return `https://${shopDomain}/products/${handle}`;
}

function buildCollectionUrl(shopDomain, handle, onlineStoreUrl) {
  if (firstText(onlineStoreUrl)) {
    return onlineStoreUrl.trim();
  }

  if (!shopDomain || !handle) {
    return null;
  }

  return `https://${shopDomain}/collections/${handle}`;
}

function normalizeProduct(node, shopDomain) {
  if (!node || typeof node !== 'object') {
    return null;
  }

  const minPrice = node.priceRange?.minVariantPrice || null;
  const maxPrice = node.priceRange?.maxVariantPrice || null;
  const compareAtPrice = node.compareAtPriceRange?.minVariantPrice || null;
  const collectionTitles = (node.collections?.edges || [])
    .map((edge) => edge?.node?.title)
    .filter(Boolean);

  return {
    id: node.id || null,
    title: firstText(node.title),
    handle: firstText(node.handle),
    url: buildProductUrl(shopDomain, node.handle, node.onlineStoreUrl),
    available: Boolean(node.availableForSale),
    vendor: firstText(node.vendor),
    productType: firstText(node.productType),
    description: stripHtml(node.description),
    image_url: firstText(node.featuredImage?.url),
    price: formatMoney(minPrice),
    price_amount: Number(minPrice?.amount || 0),
    price_max: formatMoney(maxPrice),
    compare_at_price: formatMoney(compareAtPrice),
    collections: collectionTitles,
  };
}

function normalizeCollection(node, shopDomain) {
  if (!node || typeof node !== 'object') {
    return null;
  }

  return {
    id: node.id || null,
    title: firstText(node.title),
    handle: firstText(node.handle),
    url: buildCollectionUrl(shopDomain, node.handle, node.onlineStoreUrl),
    description: stripHtml(node.description),
    image_url: firstText(node.image?.url),
    products: (node.products?.edges || [])
      .map((edge) => normalizeProduct(edge?.node, shopDomain))
      .filter(Boolean),
  };
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function parseNumberFromMatch(matchValue) {
  const cleaned = String(matchValue || '').replace(/[^0-9.]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPriceFilters(message) {
  const maxMatch = message.match(
    /\b(?:under|below|less than|up to|upto|max(?:imum)?)\s*(?:rs\.?|inr|₹|\$)?\s*([0-9][0-9,\.]*)/i,
  );
  const minMatch = message.match(
    /\b(?:over|above|more than|min(?:imum)?)\s*(?:rs\.?|inr|₹|\$)?\s*([0-9][0-9,\.]*)/i,
  );

  return {
    priceMax: maxMatch ? parseNumberFromMatch(maxMatch[1]) : null,
    priceMin: minMatch ? parseNumberFromMatch(minMatch[1]) : null,
  };
}

function cleanCatalogTerm(message) {
  let cleaned = String(message || '');

  FILLER_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, ' ');
  });

  cleaned = cleaned
    .replace(
      /\b(?:under|below|less than|up to|upto|max(?:imum)?|over|above|more than|min(?:imum)?)\s*(?:rs\.?|inr|₹|\$)?\s*[0-9][0-9,\.]*/gi,
      ' ',
    )
    .replace(/[^a-z0-9\s'/-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || null;
}

function analyzeCatalogMessage(message) {
  const normalized = String(message || '').trim();
  const lowered = normalized.toLowerCase();
  const wantsCollections = includesAny(lowered, COLLECTION_HINTS);
  const wantsProducts = includesAny(lowered, PRODUCT_HINTS) || !wantsCollections;
  const wantsAvailability = /\b(?:available|availability|in stock|out of stock|stock)\b/i.test(
    normalized,
  );
  const wantsPrice = /\b(?:price|cost|under|below|over|above|more than|less than)\b/i.test(
    normalized,
  );
  const wantsOverview =
    /\b(?:show all|list|browse|catalog|shop all|what do you have)\b/i.test(normalized) ||
    normalized.length <= 20;
  const searchTerm = cleanCatalogTerm(normalized);
  const priceFilters = extractPriceFilters(normalized);

  return {
    rawMessage: normalized,
    wantsCollections,
    wantsProducts,
    wantsAvailability,
    wantsPrice,
    wantsOverview,
    searchTerm,
    ...priceFilters,
  };
}

async function storefrontQuery(config, variables) {
  const cacheKey = JSON.stringify({
    shopDomain: config.shopDomain,
    variables,
  });
  const cachedValue = getCachedValue(cacheKey);

  if (cachedValue) {
    return cachedValue;
  }

  try {
    const response = await axios.post(
      buildStorefrontUrl(config),
      {
        query: CATALOG_QUERY,
        variables,
      },
      {
        timeout: SHOPIFY_STOREFRONT_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': config.accessToken,
        },
      },
    );

    if (Array.isArray(response.data?.errors) && response.data.errors.length > 0) {
      throw new Error(response.data.errors[0].message || 'Shopify Storefront query failed.');
    }

    const payload = response.data?.data || {
      products: { edges: [] },
      collections: { edges: [] },
    };

    setCachedValue(cacheKey, payload);

    return payload;
  } catch (error) {
    logger.warn('Shopify catalog lookup failed', {
      message: error.message,
      shopDomain: config.shopDomain,
    });
    throw error;
  }
}

function filterProducts(products, request) {
  return products.filter((product) => {
    if (request.wantsAvailability && !product.available) {
      return false;
    }

    if (request.priceMax !== null && product.price_amount > request.priceMax) {
      return false;
    }

    if (request.priceMin !== null && product.price_amount < request.priceMin) {
      return false;
    }

    return true;
  });
}

function buildProductReply(products, request) {
  if (!products.length) {
    return null;
  }

  if (products.length === 1) {
    const product = products[0];
    const details = [];

    if (product.price) {
      details.push(`Price: ${product.price}`);
    }

    details.push(product.available ? 'Status: In stock' : 'Status: Out of stock');

    if (product.collections.length) {
      details.push(`Collections: ${product.collections.slice(0, 2).join(', ')}`);
    }

    return {
      success: true,
      source: 'catalog',
      intent: 'product_lookup',
      reply: `I found ${product.title}. ${details.join('. ')}.`,
      suggestions: DEFAULT_CATALOG_SUGGESTIONS,
      catalog: {
        type: 'products',
        query: request.searchTerm,
        items: [product],
      },
    };
  }

  const summary = products
    .slice(0, 3)
    .map((product) => {
      const price = product.price ? ` - ${product.price}` : '';
      const stock = product.available ? ' - In stock' : ' - Out of stock';
      return `${product.title}${price}${stock}`;
    })
    .join('; ');
  const label = request.searchTerm ? ` for "${request.searchTerm}"` : '';

  return {
    success: true,
    source: 'catalog',
    intent: 'product_lookup',
    reply: `I found ${products.length} products${label}. ${summary}.`,
    suggestions: DEFAULT_CATALOG_SUGGESTIONS,
    catalog: {
      type: 'products',
      query: request.searchTerm,
      items: products.slice(0, 4),
    },
  };
}

function buildCollectionReply(collections, request) {
  if (!collections.length) {
    return null;
  }

  const summary = collections
    .slice(0, 3)
    .map((collection) => {
      const sampleProducts = collection.products
        .slice(0, 2)
        .map((product) => product.title)
        .filter(Boolean);

      if (!sampleProducts.length) {
        return collection.title;
      }

      return `${collection.title} (${sampleProducts.join(', ')})`;
    })
    .join('; ');
  const label = request.searchTerm ? ` for "${request.searchTerm}"` : '';

  return {
    success: true,
    source: 'catalog',
    intent: 'collection_lookup',
    reply: `I found ${collections.length} collections${label}. ${summary}.`,
    suggestions: DEFAULT_CATALOG_SUGGESTIONS,
    catalog: {
      type: 'collections',
      query: request.searchTerm,
      items: collections.slice(0, 4),
    },
  };
}

function buildNoResultsReply(request) {
  const termLabel = request.searchTerm ? `"${request.searchTerm}"` : 'that';

  return {
    success: true,
    source: 'catalog',
    intent: 'catalog_no_results',
    reply: `I could not find products or collections for ${termLabel}. Try a different keyword, AWB number, or order ID.`,
    suggestions: DEFAULT_CATALOG_SUGGESTIONS,
  };
}

async function createCatalogReply({ message, shopDomain }) {
  const config = getStorefrontConfig(shopDomain);

  if (!config) {
    return {
      success: true,
      source: 'catalog',
      intent: 'catalog_not_configured',
      reply:
        'Store catalog is not connected yet. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN to answer product and collection questions.',
      suggestions: DEFAULT_CATALOG_SUGGESTIONS,
    };
  }

  const request = analyzeCatalogMessage(message);
  const payload = await storefrontQuery(config, {
    productFirst: 6,
    collectionFirst: 4,
    productQuery: request.searchTerm,
    collectionQuery: request.searchTerm,
  });
  const products = filterProducts(
    (payload.products?.edges || [])
      .map((edge) => normalizeProduct(edge?.node, config.shopDomain))
      .filter(Boolean),
    request,
  );
  const collections = (payload.collections?.edges || [])
    .map((edge) => normalizeCollection(edge?.node, config.shopDomain))
    .filter(Boolean);

  if (request.wantsCollections && !request.wantsProducts) {
    return buildCollectionReply(collections, request) || buildNoResultsReply(request);
  }

  if (request.wantsCollections && collections.length && !products.length) {
    return buildCollectionReply(collections, request);
  }

  return buildProductReply(products, request) || buildCollectionReply(collections, request) || buildNoResultsReply(request);
}

module.exports = {
  DEFAULT_CATALOG_SUGGESTIONS,
  analyzeCatalogMessage,
  createCatalogReply,
  getStorefrontConfig,
};
