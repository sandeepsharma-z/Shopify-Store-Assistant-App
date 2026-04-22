const axios = require('axios');

const logger = require('../utils/logger');
const { buildRuntimeSettings } = require('./storeSettings');

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
    shop {
      name
      description
      primaryDomain {
        host
        url
      }
    }
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
  'Track Your Order',
  'Refund Policy',
  'Privacy Policy',
  'Terms of Service',
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
  't-shirt',
  'tshirt',
  't shirt',
  'tee',
  'shirt',
  'hoodie',
  'cap',
  'sunglasses',
  'ashtray',
  'paper',
  'papers',
  'filter',
  'filters',
  'cone',
  'cones',
  'tray',
  'frames',
  'frame',
];

const COLLECTION_HINTS = ['collection', 'collections', 'category', 'categories', 'range', 'ranges'];

const OVERVIEW_HINTS = [
  'what do you sell',
  'what do you have',
  'show all',
  'browse all',
  'catalog',
  'shop all',
  'all products',
  'all collections',
  'store overview',
];

const RECOMMENDATION_HINTS = [
  'recommend',
  'suggest',
  'best',
  'best seller',
  'bestseller',
  'popular',
  'trending',
  'top products',
  'featured',
  'latest',
  'new arrivals',
];

const GENERIC_DISCOVERY_HINTS = ['show', 'find', 'browse', 'search', 'latest', 'new arrivals'];

const COLOR_HINTS = [
  'black',
  'white',
  'blue',
  'red',
  'green',
  'pink',
  'yellow',
  'grey',
  'gray',
  'brown',
  'purple',
  'beige',
  'cream',
  'orange',
];

const MATERIAL_HINTS = [
  'cotton',
  'french terry',
  'terry',
  'fabric',
  'material',
  'gsm',
  'premium',
  'oversized',
];

const FILLER_PATTERNS = [
  /\bgive me\b/gi,
  /\bgive\b/gi,
  /\bget me\b/gi,
  /\bshow us\b/gi,
  /\bdo you have\b/gi,
  /\bshow me\b/gi,
  /\bshow\b/gi,
  /\bfind me\b/gi,
  /\bfind\b/gi,
  /\bsearch\b/gi,
  /\bbrowse\b/gi,
  /\blist\b/gi,
  /\bdetails about\b/gi,
  /\btell me about\b/gi,
  /\bmore about\b/gi,
  /\babout\b/gi,
  /\bdetails\b/gi,
  /\bdetail\b/gi,
  /\bdescribe\b/gi,
  /\bdescription\b/gi,
  /\bwhich is\b/gi,
  /\bwhich is the\b/gi,
  /\bwhich\b/gi,
  /\bwhat\b/gi,
  /\bis\b/gi,
  /\bwhat is\b/gi,
  /\bwhich are\b/gi,
  /\bwhat are\b/gi,
  /\bis the\b/gi,
  /\bthe best\b/gi,
  /\bbest\b/gi,
  /\blooking for\b/gi,
  /\bi want\b/gi,
  /\bi need\b/gi,
  /\byour\b/gi,
  /\bcan you\b/gi,
  /\bcan u\b/gi,
  /\bplease\b/gi,
  /\bproduct\b/gi,
  /\bcontains\b/gi,
  /\bcontain\b/gi,
  /\bmade of\b/gi,
  /\bkya hai\b/gi,
  /\bkya h\b/gi,
  /\bhai\b/gi,
  /\bkaun sa\b/gi,
  /\bkon sa\b/gi,
  /\bwala\b/gi,
  /\bproducts?\b/gi,
  /\bitems?\b/gi,
  /\bcollections?\b/gi,
  /\bcategories?\b/gi,
  /\bcategory\b/gi,
  /\brange\b/gi,
  /\branges\b/gi,
  /\bprice\b/gi,
  /\bcost\b/gi,
  /\bavailable\b/gi,
  /\bavailability\b/gi,
  /\bin stock\b/gi,
  /\bout of stock\b/gi,
  /\bshop\b/gi,
  /\bstore\b/gi,
  /\brecommend\b/gi,
  /\bsuggest\b/gi,
  /\bfeatured\b/gi,
  /\bbest\b/gi,
  /\bpopular\b/gi,
  /\bbest seller\b/gi,
  /\bnew arrivals?\b/gi,
  /\blatest\b/gi,
];

const QUESTION_HINTS = [
  'what',
  'which',
  'why',
  'how',
  'does',
  'do',
  'can',
  'should',
  'difference',
  'compare',
  'contains',
  'contain',
  'made of',
  'good for',
  'best for',
  'about',
  'details',
  'describe',
  'description',
  'benefits',
  'features',
];

function getStorefrontConfig(preferredShopDomain) {
  const runtime = buildRuntimeSettings(preferredShopDomain);
  const shopDomain = String(runtime.shopDomain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const accessToken = String(runtime.storefrontAccessToken || '').trim() || null;

  if (!shopDomain) {
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

function normalizeComparableText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function buildProductPriceLabel(minPrice, maxPrice) {
  const minimum = formatMoney(minPrice);
  const maximum = formatMoney(maxPrice);

  if (!minimum) {
    return null;
  }

  if (minimum === maximum || !maximum) {
    return minimum;
  }

  return `${minimum} - ${maximum}`;
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
    title: stripHtml(node.title),
    handle: firstText(node.handle),
    url: buildProductUrl(shopDomain, node.handle, node.onlineStoreUrl),
    available: Boolean(node.availableForSale),
    vendor: firstText(node.vendor),
    productType: firstText(node.productType),
    description: stripHtml(node.description),
    image_url: firstText(node.featuredImage?.url),
    price: buildProductPriceLabel(minPrice, maxPrice),
    price_amount: Number(minPrice?.amount || 0),
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
    title: stripHtml(node.title),
    handle: firstText(node.handle),
    url: buildCollectionUrl(shopDomain, node.handle, node.onlineStoreUrl),
    description: stripHtml(node.description),
    image_url: firstText(node.image?.url),
    products: (node.products?.edges || [])
      .map((edge) => normalizeProduct(edge?.node, shopDomain))
      .filter(Boolean),
  };
}

function normalizeShop(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }

  return {
    name: firstText(node.name),
    description: stripHtml(node.description),
    url: firstText(node.primaryDomain?.url),
    host: firstText(node.primaryDomain?.host),
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
    /\b(?:under|below|less than|up to|upto|max(?:imum)?)\s*(?:rs\.?|inr|₹|\$)?\s*([0-9][0-9,.]*)/i,
  );
  const minMatch = message.match(
    /\b(?:over|above|more than|min(?:imum)?)\s*(?:rs\.?|inr|₹|\$)?\s*([0-9][0-9,.]*)/i,
  );

  return {
    priceMax: maxMatch ? parseNumberFromMatch(maxMatch[1]) : null,
    priceMin: minMatch ? parseNumberFromMatch(minMatch[1]) : null,
  };
}

function extractMatchedTerms(text, terms) {
  return terms.filter((term) => text.includes(term));
}

function cleanCatalogTerm(message) {
  let cleaned = String(message || '');

  FILLER_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, ' ');
  });

  cleaned = cleaned
    .replace(
      /\b(?:under|below|less than|up to|upto|max(?:imum)?|over|above|more than|min(?:imum)?)\s*(?:rs\.?|inr|₹|\$)?\s*[0-9][0-9,.]*/gi,
      ' ',
    )
    .replace(/[^a-z0-9\s'/-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return null;
  }

  if (cleaned.length <= 2) {
    return null;
  }

  return cleaned;
}

function analyzeCatalogMessage(message) {
  const normalized = String(message || '').trim();
  const lowered = normalized.toLowerCase();

  const wantsCollections = includesAny(lowered, COLLECTION_HINTS);
  const wantsRecommendations = includesAny(lowered, RECOMMENDATION_HINTS);
  const wantsStoreOverview =
    includesAny(lowered, OVERVIEW_HINTS) ||
    /\b(all products|all collections|catalog|browse store)\b/.test(lowered);
  const wantsAvailability = /\b(?:available|availability|in stock|out of stock|stock)\b/i.test(
    normalized,
  );
  const wantsPrice = /\b(?:price|cost|under|below|over|above|more than|less than)\b/i.test(
    normalized,
  );
  const hasExplicitProductHint = includesAny(lowered, PRODUCT_HINTS);
  const hasGenericDiscoveryHint = includesAny(lowered, GENERIC_DISCOVERY_HINTS);
  const wantsDetails =
    includesAny(lowered, QUESTION_HINTS) ||
    /\?$/.test(normalized) ||
    /\b(feature|features|benefit|benefits|material|flavor|taste|size|nicotine|contains|description|about)\b/i.test(
      normalized,
    );
  const wantsProducts =
    hasExplicitProductHint ||
    wantsRecommendations ||
    wantsStoreOverview ||
    !wantsCollections;
  const prefersCollections = wantsCollections && (!hasExplicitProductHint || hasGenericDiscoveryHint);
  const wantsOverview = wantsStoreOverview || normalized.length <= 16;
  const searchTerm = cleanCatalogTerm(normalized);
  const priceFilters = extractPriceFilters(normalized);
  const matchedColors = extractMatchedTerms(lowered, COLOR_HINTS);
  const matchedMaterials = extractMatchedTerms(lowered, MATERIAL_HINTS);
  const matchedProductHints = extractMatchedTerms(lowered, PRODUCT_HINTS);

  return {
    rawMessage: normalized,
    wantsCollections,
    wantsProducts,
    wantsAvailability,
    wantsPrice,
    wantsOverview,
    wantsRecommendations,
    wantsStoreOverview,
    prefersCollections,
    wantsDetails,
    searchTerm,
    matchedColors,
    matchedMaterials,
    matchedProductHints,
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
          ...(config.accessToken
            ? { 'X-Shopify-Storefront-Access-Token': config.accessToken }
            : {}),
        },
      },
    );

    if (Array.isArray(response.data?.errors) && response.data.errors.length > 0) {
      throw new Error(response.data.errors[0].message || 'Shopify Storefront query failed.');
    }

    const payload = response.data?.data || {
      shop: null,
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

function dedupeByKey(items, keyBuilder) {
  const seen = new Set();

  return items.filter((item) => {
    const key = keyBuilder(item);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function filterProducts(products, request) {
  return dedupeByKey(products, (product) => product.url || product.handle || product.title).filter(
    (product) => {
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
    },
  );
}

function filterCollections(collections) {
  return dedupeByKey(
    collections,
    (collection) => collection.url || collection.handle || collection.title,
  );
}

function buildSearchTokens(request) {
  return String(request?.searchTerm || '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function countWholeWordMatches(text, tokens) {
  const comparable = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

  if (!comparable.trim() || !tokens.length) {
    return 0;
  }

  return tokens.reduce((score, token) => {
    const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return score + (pattern.test(comparable) ? 1 : 0);
  }, 0);
}

function countCoverage(text, tokens) {
  const comparable = String(text || '').toLowerCase();

  if (!comparable || !tokens.length) {
    return 0;
  }

  return tokens.reduce((total, token) => total + (comparable.includes(token) ? 1 : 0), 0);
}

function scoreTextMatch(text, tokens) {
  const comparable = String(text || '').toLowerCase();

  if (!comparable || !tokens.length) {
    return 0;
  }

  return tokens.reduce((score, token) => {
    if (comparable === token) {
      return score + 10;
    }

    if (comparable.startsWith(token)) {
      return score + 7;
    }

    if (comparable.includes(token)) {
      return score + 4;
    }

    return score;
  }, 0);
}

function getProductComparableText(product) {
  return normalizeComparableText(
    [
      product.title,
      product.handle,
      product.description,
      product.vendor,
      product.productType,
      Array.isArray(product.collections) ? product.collections.join(' ') : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function getColorBoost(product, request) {
  if (!Array.isArray(request.matchedColors) || !request.matchedColors.length) {
    return 0;
  }

  const text = getProductComparableText(product);

  return request.matchedColors.reduce((score, color) => {
    if (text.includes(color)) {
      return score + 18;
    }

    return score - 6;
  }, 0);
}

function getMaterialBoost(product, request) {
  if (!Array.isArray(request.matchedMaterials) || !request.matchedMaterials.length) {
    return 0;
  }

  const text = getProductComparableText(product);

  return request.matchedMaterials.reduce((score, material) => {
    if (text.includes(material)) {
      return score + 10;
    }

    return score;
  }, 0);
}

function getProductHintBoost(product, request) {
  if (!Array.isArray(request.matchedProductHints) || !request.matchedProductHints.length) {
    return 0;
  }

  const text = getProductComparableText(product);

  return request.matchedProductHints.reduce((score, hint) => {
    if (text.includes(hint)) {
      return score + 12;
    }

    return score;
  }, 0);
}

function getQualityBoost(product) {
  const text = getProductComparableText(product);
  let score = 0;

  if (text.includes('premium')) score += 5;
  if (text.includes('240 gsm')) score += 8;
  if (text.includes('220 gsm')) score += 6;
  if (text.includes('100% cotton')) score += 8;
  if (text.includes('french terry')) score += 8;
  if (text.includes('oversized')) score += 4;
  if (text.includes('best seller') || text.includes('bestseller')) score += 10;
  if (text.includes('popular')) score += 4;
  if (text.includes('trending')) score += 4;
  if (text.includes('featured')) score += 4;
  if (text.includes('new arrival')) score += 3;

  return score;
}

function rankProducts(products, request) {
  const tokens = buildSearchTokens(request);

  if (!tokens.length) {
    return [...products].sort((left, right) => {
      if (right.available !== left.available) {
        return right.available ? 1 : -1;
      }

      return 0;
    });
  }

  return [...products].sort((left, right) => {
    const leftScore =
      scoreTextMatch(left.title, tokens) * 3 +
      scoreTextMatch(left.handle, tokens) * 2 +
      scoreTextMatch(left.description, tokens) * 2 +
      scoreTextMatch(left.vendor, tokens) +
      scoreTextMatch(left.productType, tokens) +
      countWholeWordMatches(left.title, tokens) * 7 +
      countWholeWordMatches(left.description, tokens) * 5 +
      countCoverage((left.collections || []).join(' '), tokens) * 2 +
      getColorBoost(left, request) +
      getMaterialBoost(left, request) +
      getProductHintBoost(left, request) +
      getQualityBoost(left) +
      (left.available ? 10 : -12);

    const rightScore =
      scoreTextMatch(right.title, tokens) * 3 +
      scoreTextMatch(right.handle, tokens) * 2 +
      scoreTextMatch(right.description, tokens) * 2 +
      scoreTextMatch(right.vendor, tokens) +
      scoreTextMatch(right.productType, tokens) +
      countWholeWordMatches(right.title, tokens) * 7 +
      countWholeWordMatches(right.description, tokens) * 5 +
      countCoverage((right.collections || []).join(' '), tokens) * 2 +
      getColorBoost(right, request) +
      getMaterialBoost(right, request) +
      getProductHintBoost(right, request) +
      getQualityBoost(right) +
      (right.available ? 10 : -12);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    if (right.available !== left.available) {
      return right.available ? 1 : -1;
    }

    return 0;
  });
}

function buildDescriptionHighlights(product, request) {
  const description = String(product?.description || '').trim();
  const tokens = buildSearchTokens(request);

  if (!description) {
    return [];
  }

  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const ranked = sentences
    .map((sentence) => ({
      sentence,
      score:
        scoreTextMatch(sentence, tokens) * 2 +
        countWholeWordMatches(sentence, tokens) * 4 +
        countCoverage(sentence, tokens),
    }))
    .sort((left, right) => right.score - left.score);

  const highlights = ranked
    .filter((entry) => entry.score > 0)
    .map((entry) => entry.sentence)
    .slice(0, 2);

  if (highlights.length) {
    return highlights;
  }

  return [description.slice(0, 180) + (description.length > 180 ? '...' : '')];
}

function rankCollections(collections, request) {
  const tokens = buildSearchTokens(request);

  if (!tokens.length) {
    return collections;
  }

  return [...collections].sort((left, right) => {
    const leftScore =
      scoreTextMatch(left.title, tokens) * 3 +
      scoreTextMatch(left.handle, tokens) * 2 +
      scoreTextMatch(left.description, tokens);
    const rightScore =
      scoreTextMatch(right.title, tokens) * 3 +
      scoreTextMatch(right.handle, tokens) * 2 +
      scoreTextMatch(right.description, tokens);

    return rightScore - leftScore;
  });
}

function buildCatalogEnvelope(type, request, shop, items, extra = {}) {
  return {
    type,
    query: request.searchTerm,
    shop,
    items,
    ...extra,
  };
}

function buildOverviewReply(shop, products, collections, request) {
  const collectionSummary = collections
    .slice(0, 3)
    .map((collection) => collection.title)
    .filter(Boolean);
  const productSummary = products
    .slice(0, 3)
    .map((product) => {
      const price = product.price ? ` (${product.price})` : '';
      return `${product.title}${price}`;
    })
    .filter(Boolean);
  const parts = [];

  if (shop?.name) {
    parts.push(`${shop.name} store overview.`);
  } else {
    parts.push('Store overview.');
  }

  if (shop?.description) {
    parts.push(shop.description);
  }

  if (collectionSummary.length) {
    parts.push(`Collections: ${collectionSummary.join(', ')}.`);
  }

  if (productSummary.length) {
    parts.push(`Featured products: ${productSummary.join('; ')}.`);
  }

  return {
    success: true,
    source: 'catalog',
    intent: 'store_overview',
    reply: parts.join(' '),
    suggestions: DEFAULT_CATALOG_SUGGESTIONS,
    catalog: buildCatalogEnvelope('overview', request, shop, [], {
      products: products.slice(0, 4),
      collections: collections.slice(0, 4),
    }),
  };
}

function buildBestMatchReason(product, request, primaryHighlights) {
  const reasons = [];
  const text = getProductComparableText(product);

  if (Array.isArray(request.matchedColors) && request.matchedColors.length) {
    const matchingColors = request.matchedColors.filter((color) => text.includes(color));
    if (matchingColors.length) {
      reasons.push(`${matchingColors.join(', ')} match`);
    }
  }

  if (Array.isArray(request.matchedProductHints) && request.matchedProductHints.length) {
    const typeReason = request.matchedProductHints.find((hint) => text.includes(hint));
    if (typeReason) {
      reasons.push(`${typeReason} relevance`);
    }
  }

  if (product.available) {
    reasons.push('currently in stock');
  }

  if (text.includes('240 gsm')) reasons.push('240 GSM fabric');
  if (text.includes('100% cotton')) reasons.push('100% cotton');
  if (text.includes('french terry')) reasons.push('French terry fabric');
  if (text.includes('premium')) reasons.push('premium material');

  if (!reasons.length && primaryHighlights.length) {
    reasons.push(primaryHighlights[0]);
  }

  return reasons.slice(0, 3);
}

function buildProductReply(products, request, shop) {
  if (!products.length) {
    return null;
  }

  const primaryProduct = products[0];
  const primaryHighlights = buildDescriptionHighlights(primaryProduct, request);
  const searchTokens = buildSearchTokens(request);
  const shouldUseDetailAnswer =
    request.wantsDetails ||
    request.wantsRecommendations ||
    (request.searchTerm &&
      products.length &&
      searchTokens.length > 1 &&
      countWholeWordMatches(primaryProduct.title, searchTokens) +
        countWholeWordMatches(primaryProduct.description, searchTokens) >= 2);

  if (products.length === 1 || shouldUseDetailAnswer) {
    const product = primaryProduct;
    const details = [];
    const multiProductCardItems =
      products.length > 1 && searchTokens.length <= 2 ? products.slice(0, 4) : [product];
    const alternativeMatches =
      products.length > 1
        ? products
            .slice(1, 4)
            .map((item) => item.title)
            .filter(Boolean)
        : [];
    const reasons = buildBestMatchReason(product, request, primaryHighlights);

    if (product.price) {
      details.push(`Price: ${product.price}`);
    }

    if (product.compare_at_price && product.compare_at_price !== product.price) {
      details.push(`Compare at: ${product.compare_at_price}`);
    }

    details.push(product.available ? 'Status: In stock' : 'Status: Out of stock');

    if (product.vendor) {
      details.push(`Brand: ${product.vendor}`);
    }

    if (product.productType) {
      details.push(`Type: ${product.productType}`);
    }

    if (product.collections.length) {
      details.push(`Collections: ${product.collections.slice(0, 2).join(', ')}`);
    }

    if (primaryHighlights.length) {
      details.push(`About: ${primaryHighlights.join(' ')}`);
    }

    if (alternativeMatches.length) {
      details.push(`Other close matches: ${alternativeMatches.join(', ')}`);
    }

    const intro = request.wantsRecommendations
      ? `The best match right now is ${product.title}.`
      : `The best match is ${product.title}.`;

    const reasonLine = reasons.length ? `Why it matches: ${reasons.join(', ')}.` : null;

    const replyParts = [
      intro,
      reasonLine,
      details.length ? details.join('. ') + '.' : null,
    ].filter(Boolean);

    return {
      success: true,
      source: 'catalog',
      intent: request.wantsRecommendations
        ? 'product_recommendations'
        : shouldUseDetailAnswer
          ? 'product_details'
          : 'product_lookup',
      reply: replyParts.join(' '),
      suggestions: DEFAULT_CATALOG_SUGGESTIONS,
      catalog: buildCatalogEnvelope('products', request, shop, multiProductCardItems),
    };
  }

  const summary = products
    .slice(0, 4)
    .map((product) => {
      const price = product.price ? ` - ${product.price}` : '';
      const stock = product.available ? ' - In stock' : ' - Out of stock';
      return `${product.title}${price}${stock}`;
    })
    .join('; ');
  const label = request.searchTerm ? ` for "${request.searchTerm}"` : '';
  const intro = request.wantsRecommendations
    ? `These are the strongest product matches${label}.`
    : `I found these product matches${label}.`;

  return {
    success: true,
    source: 'catalog',
    intent: request.wantsRecommendations ? 'product_recommendations' : 'product_lookup',
    reply: `${intro} ${summary}.`,
    suggestions: DEFAULT_CATALOG_SUGGESTIONS,
    catalog: buildCatalogEnvelope('products', request, shop, products.slice(0, 4)),
  };
}

function buildCollectionReply(collections, request, shop) {
  if (!collections.length) {
    return null;
  }

  if (collections.length === 1) {
    const collection = collections[0];
    const sampleProducts = collection.products
      .slice(0, 3)
      .map((product) => product.title)
      .filter(Boolean);
    const parts = [`The closest collection match is ${collection.title}.`];

    if (collection.description) {
      parts.push(collection.description);
    }

    if (sampleProducts.length) {
      parts.push(`Some products in this collection: ${sampleProducts.join(', ')}.`);
    }

    if (collection.url) {
      parts.push(`You can browse it here: ${collection.url}.`);
    }

    return {
      success: true,
      source: 'catalog',
      intent: 'collection_lookup',
      reply: parts.join(' '),
      suggestions: DEFAULT_CATALOG_SUGGESTIONS,
      catalog: buildCatalogEnvelope('collections', request, shop, [collection]),
    };
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
    reply: `These collections match${label}: ${summary}.`,
    suggestions: DEFAULT_CATALOG_SUGGESTIONS,
    catalog: buildCatalogEnvelope('collections', request, shop, collections.slice(0, 4)),
  };
}

function buildNoResultsReply(request, shop) {
  const termLabel = request.searchTerm ? `"${request.searchTerm}"` : 'that';

  return {
    success: true,
    source: 'catalog',
    intent: 'catalog_no_results',
    reply: `I could not find products or collections for ${termLabel}. Try a different keyword, browse collections, or share an AWB number for tracking.`,
    suggestions: DEFAULT_CATALOG_SUGGESTIONS,
    catalog: buildCatalogEnvelope('empty', request, shop, []),
  };
}

function buildRelaxedSearchTerm(searchTerm) {
  const cleaned = cleanCatalogTerm(searchTerm || '');

  if (!cleaned) {
    return null;
  }

  const parts = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => part.length > 2);

  if (parts.length <= 1) {
    return cleaned;
  }

  return parts.join(' OR ');
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

  // Build a smart fuzzy query handling partial names, version numbers, etc.
  // "drop 3" → matches "Drop 3.0"
  // "double" → matches "DOUBLE TROUBLE"
  function buildFuzzyQuery(term) {
    if (!term) return null;
    const tokens = term.trim().split(/\s+/).filter(Boolean);

    if (tokens.length === 1) {
      // Single token: prefix wildcard covers partial names
      return `title:${tokens[0]}* OR ${tokens[0]}*`;
    }

    // Multi-token: try the full phrase + each significant token with wildcard
    const significant = tokens.filter((t) => t.length > 1);
    const phraseQuery = significant.join(' ');
    const wildcardQuery = significant.map((t) => `${t}*`).join(' ');
    return phraseQuery === wildcardQuery
      ? wildcardQuery
      : `${phraseQuery} OR ${wildcardQuery}`;
  }

  // Generate version-expanded variants: "drop 3" → also search "drop 3.0",
  // "drop 3.0" → also search "drop 3", so partial version typing still works.
  function buildVersionVariants(term) {
    if (!term) return [];
    const variants = new Set();

    // "3" → "3.0"
    const withPoint = term.replace(/\b(\d+)(?!\.\d)\b/g, '$1.0');
    if (withPoint !== term) variants.add(withPoint);

    // "3.0" → "3"
    const withoutPoint = term.replace(/\b(\d+)\.0\b/g, '$1');
    if (withoutPoint !== term) variants.add(withoutPoint);

    // First significant word alone (broadest catch-all)
    const firstWord = term.split(/\s+/).find((t) => t.length > 2 && !/^\d/.test(t));
    if (firstWord) variants.add(firstWord);

    return [...variants].filter((v) => v && v !== term);
  }

  const fuzzyTerm = buildFuzzyQuery(request.searchTerm);
  const versionVariants = buildVersionVariants(request.searchTerm || '');

  // Fire primary query + all variant queries in parallel for maximum coverage
  const queryTargets = [
    { productQuery: fuzzyTerm || request.searchTerm, collectionQuery: fuzzyTerm || request.searchTerm },
    ...versionVariants.map((v) => ({ productQuery: buildFuzzyQuery(v) || v, collectionQuery: buildFuzzyQuery(v) || v })),
  ];

  const payloads = await Promise.all(
    queryTargets.map((vars) =>
      storefrontQuery(config, { productFirst: 8, collectionFirst: 6, ...vars }).catch(() => null),
    ),
  );

  const shop = normalizeShop(payloads[0]?.shop);

  // Merge products from all parallel queries, deduplicate by URL/handle
  const allProductEdges = payloads.flatMap((p) => p?.products?.edges || []);
  const allCollectionEdges = payloads.flatMap((p) => p?.collections?.edges || []);

  const products = rankProducts(
    filterProducts(
      dedupeByKey(
        allProductEdges.map((edge) => normalizeProduct(edge?.node, config.shopDomain)).filter(Boolean),
        (p) => p.url || p.handle || p.title,
      ),
      request,
    ),
    request,
  );

  const collections = rankCollections(
    filterCollections(
      dedupeByKey(
        allCollectionEdges.map((edge) => normalizeCollection(edge?.node, config.shopDomain)).filter(Boolean),
        (c) => c.url || c.handle || c.title,
      ),
    ),
    request,
  );

  if (request.wantsStoreOverview || (!request.searchTerm && request.wantsOverview)) {
    return buildOverviewReply(shop, products, collections, request);
  }

  if (request.prefersCollections) {
    return buildCollectionReply(collections, request, shop) || buildNoResultsReply(request, shop);
  }

  if (request.wantsCollections && collections.length && !products.length) {
    return buildCollectionReply(collections, request, shop);
  }

  if (request.wantsRecommendations && products.length) {
    return buildProductReply(products, request, shop);
  }

  return (
    buildProductReply(products, request, shop) ||
    buildCollectionReply(collections, request, shop) ||
    buildNoResultsReply(request, shop)
  );
}

module.exports = {
  DEFAULT_CATALOG_SUGGESTIONS,
  analyzeCatalogMessage,
  createCatalogReply,
  getStorefrontConfig,
};