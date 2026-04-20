# Shopify Shiprocket Order Tracker

Production-ready Node.js + Express backend for Shopify order tracking with Shiprocket, plus a storefront app-embed assistant for products, collections, prices, stock, tracking, and store-support queries.

## Features

- `POST /api/track-order` accepts `{ "awb": "..." }` or `{ "order_id": "..." }`
- `POST /api/chatbot` accepts `{ "message": "..." }` for conversational support
- `GET /api/setup-status` returns exact Shopify app values for the current deployed domain
- `GET /shopify/app-home` shows a live Shopify app settings page with editable merchant configuration
- Shiprocket authentication with in-memory token caching
- Tracking lookup through Shiprocket AWB and order endpoints
- Shopify Storefront API lookup for products and collections
- Optional Gemini API layer for better natural-language answers grounded in store data
- Per-store merchant settings save for Shiprocket, Storefront token, and support policies
- Encrypted storage for saved merchant secrets
- Config-driven support answers for shipping, returns, payments, cancellation, and contact details
- Clean customer-facing reply text with status, last location, and expected delivery
- Input validation, CORS, Helmet, and structured logging
- Shopify app proxy route at `/apps/track-order`
- Shopify chatbot app proxy route at `/apps/track-order/chat`
- Shopify theme app extension scaffold in `extensions/order-tracker-widget`
- Tidio-compatible payload using the `reply` field
- Render-ready deployment config in `render.yaml`

## Project Structure

```text
.
|-- controllers/
|   |-- chatController.js
|   |-- settingsController.js
|   |-- setupController.js
|   `-- trackingController.js
|-- extensions/
|   `-- order-tracker-widget/
|       |-- assets/
|       |   |-- order-tracker-widget.css
|       |   `-- order-tracker-widget.js
|       |-- blocks/
|       |   `-- order-tracker-widget.liquid
|       `-- shopify.extension.toml
|-- middleware/
|   |-- validateChatRequest.js
|   |-- errorHandler.js
|   |-- notFound.js
|   |-- requireSettingsAccess.js
|   |-- validateTrackRequest.js
|   `-- verifyShopifyProxy.js
|-- public/
|   |-- app-home.css
|   `-- app-home.js
|-- routes/
|   |-- index.js
|   |-- setupRoutes.js
|   `-- trackingRoutes.js
|-- services/
|   |-- chatAssistant.js
|   |-- shiprocket.js
|   |-- shopifyCatalog.js
|   |-- storeSettings.js
|   `-- storeSupport.js
|-- utils/
|   |-- httpError.js
|   |-- logger.js
|   |-- shopify.js
|   `-- trackFormatter.js
|-- .env.example
|-- package.json
|-- render.yaml
|-- README.md
|-- shopify.app.toml.example
`-- server.js
```

## Environment Variables

Copy `.env.example` to `.env` and set the values:

```env
NODE_ENV=development
PORT=5050
ALLOW_ORIGIN=*
SHOPIFY_APP_NAME=Shopify Store Assistant App
SHOPIFY_APP_HANDLE=shopify-store-assistant-app
STORE_SETTINGS_FILE=./data/store-settings.json
SETTINGS_ENCRYPTION_KEY=change-this-in-production
SHIPROCKET_EMAIL=your-shiprocket-email
SHIPROCKET_PASSWORD=your-shiprocket-password
SHIPROCKET_BASE_URL=https://apiv2.shiprocket.in/v1/external
SHIPROCKET_TIMEOUT_MS=15000
SHIPROCKET_TOKEN_TTL_MS=864000000
SHOPIFY_API_SECRET=your-shopify-app-secret
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_STOREFRONT_ACCESS_TOKEN=your-storefront-access-token
SHOPIFY_STOREFRONT_API_VERSION=2025-07
SHOPIFY_STOREFRONT_TIMEOUT_MS=15000
SHOPIFY_CATALOG_CACHE_TTL_MS=300000
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TIMEOUT_MS=12000
STORE_SCRAPE_TIMEOUT_MS=4000
STORE_SCRAPE_CACHE_TTL_MS=600000
STORE_NAME=your-store-name
STORE_SUPPORT_EMAIL=support@example.com
STORE_SUPPORT_PHONE=+91XXXXXXXXXX
STORE_SUPPORT_WHATSAPP=+91XXXXXXXXXX
STORE_SUPPORT_HOURS=Mon-Sat, 10 AM to 7 PM
STORE_SHIPPING_POLICY=Orders usually dispatch within 24 to 48 hours.
STORE_RETURN_POLICY=Returns are accepted within 7 days for unused items.
STORE_COD_POLICY=Cash on delivery is available on eligible pincodes.
STORE_CANCELLATION_POLICY=Orders can be cancelled before dispatch.
STORE_ORDER_PROCESSING_TIME=Processing time is 1 business day.
STORE_CONTACT_URL=https://your-store.myshopify.com/pages/contact
STORE_ABOUT_TEXT=We offer curated products with fast shipping and support.
```

`SHIPROCKET_TOKEN_TTL_MS` defaults to 10 days so the app does not log in on every request. Shiprocket tokens are refreshed automatically when the cache expires or a `401` is returned.
`STORE_SETTINGS_FILE` is where the app stores per-store merchant settings. In production, point it to a persistent disk path.
`SETTINGS_ENCRYPTION_KEY` is strongly recommended in production so saved Shiprocket passwords and Storefront tokens are encrypted with your own key.
`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN`, `SHIPROCKET_EMAIL`, and `SHIPROCKET_PASSWORD` act as fallback values if per-store settings have not been saved from the Shopify app page yet.
`GEMINI_API_KEY` is optional. If set, the chatbot uses Gemini to answer product, collection, policy, and store questions in a more natural way while staying grounded in Shopify catalog data, saved store settings, and lightweight page scraping.
The `STORE_*` variables are optional, but they make the chatbot much better at answering shipping, return, payment, cancellation, contact, and brand questions without an AI model.

## How To Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and add your Shiprocket and Shopify values.

3. Start the app:

   ```bash
   npm run dev
   ```

4. Test the health route:

   ```bash
   curl http://localhost:5050/health
   ```

5. Test tracking with an AWB number:

   ```bash
   curl --request POST http://localhost:5050/api/track-order \
     --header "Content-Type: application/json" \
     --data "{\"awb\":\"123456789\"}"
   ```

6. Test tracking with an order ID:

   ```bash
   curl --request POST http://localhost:5050/api/track-order \
     --header "Content-Type: application/json" \
     --data "{\"order_id\":\"100001\"}"
   ```

7. Test the chatbot:

   ```bash
   curl --request POST http://localhost:5050/api/chatbot \
     --header "Content-Type: application/json" \
     --data "{\"message\":\"Show me black hoodies under 2000\"}"
   ```

8. Open the Shopify app settings page locally:

   ```text
   http://localhost:5050/shopify/app-home?shop=your-store.myshopify.com
   ```

## API Contract

### Request

```json
{
  "awb": "123456789"
}
```

Or:

```json
{
  "order_id": "100001"
}
```

### Success Response

```json
{
  "success": true,
  "awb": "123456789",
  "order_id": null,
  "status": "in transit",
  "last_location": "Delhi Hub",
  "expected_delivery": "18 April",
  "reply": "Your order is currently in transit. Last update: Delhi Hub. Expected delivery: 18 April."
}
```

### Error Response

```json
{
  "success": false,
  "reply": "Invalid AWB number. Please check and try again."
}
```

### Fallback Response

```json
{
  "success": false,
  "reply": "We couldn't fetch live tracking details right now. Please try again in a few minutes or contact support."
}
```

## Chatbot API Contract

### Request

```json
{
  "message": "Show me black hoodies under 2000"
}
```

### Response

```json
{
  "success": true,
  "source": "catalog",
  "intent": "product_lookup",
  "reply": "I found 2 products for \"black hoodies\". Black Hoodie - INR 1,999 - In stock; Oversized Black Hoodie - INR 1,799 - In stock.",
  "suggestions": [
    "Find products",
    "Browse collections",
    "Track my order",
    "Order ID status"
  ],
  "catalog": {
    "type": "products",
    "query": "black hoodies",
    "items": []
  }
}
```

The chatbot can answer:

- product search
- collection discovery
- price checks
- stock availability
- AWB or order-ID tracking

## Shiprocket Flow

The backend performs these steps automatically:

1. Logs in to Shiprocket with `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD`
2. Caches the bearer token in memory
3. Calls `GET /courier/track/awb/{awb}` when `awb` is provided
4. Calls `GET /orders/show/{order_id}` when `order_id` is provided
5. If an AWB is found in the order response, the app fetches live tracking through the AWB endpoint and falls back to the order payload if live tracking is unavailable

## Shopify Integration

This repository contains the backend plus a ready-to-deploy theme app extension scaffold.

### 1. Deploy the Node app

Deploy this repository to Render or Railway first so Shopify can reach a public HTTPS URL and persistent storage for merchant settings.

After deployment, open:

- `https://your-domain.com/shopify/app-home`
- `https://your-domain.com/api/setup-status`

These routes show the exact App URL, redirect URLs, app proxy values, and current store settings status for the deployed domain.

### 2. Install the app and save merchant settings

Open the app from Shopify admin. The page at `/shopify/app-home` now includes a merchant settings form for:

- Shiprocket email
- Shiprocket password
- Storefront access token
- Gemini API key
- store name and support details
- shipping, returns, payment, cancellation, and about text

These saved values are used automatically by the storefront proxy routes and by direct API calls when you pass `shopDomain`.

### 3. Configure the Shopify app proxy

In your Shopify app settings, create an app proxy with:

- Subpath prefix: `apps`
- Subpath: `track-order`
- Proxy URL: `https://your-domain.com/apps/track-order`

The backend already exposes both:

- `GET /apps/track-order?awb=123456789`
- `POST /apps/track-order`
- `POST /apps/track-order/chat`

The proxy route verifies Shopify signatures when `SHOPIFY_API_SECRET` is set.

### 4. Fill Shopify app settings

In Shopify app setup, use the values shown on `/shopify/app-home`:

- App URL: `https://your-domain.com/shopify/app-home`
- Allowed redirection URL: `https://your-domain.com/auth/callback`
- Allowed redirection URL: `https://your-domain.com/auth/oauth/callback`
- App proxy prefix: `apps`
- App proxy subpath: `track-order`
- App proxy URL: `https://your-domain.com/apps/track-order`

If you are using Shopify CLI for a separate app project, copy the sample in `shopify.app.toml.example` and replace the domain and API key with your real values.

### 5. Create Storefront API token

For product and collection answers, create a Storefront access token in Shopify and enable:

- `unauthenticated_read_product_listings`
- `unauthenticated_read_product_inventory`

Then either save the Storefront token inside the app page at `/shopify/app-home`, or set fallback environment variables on the backend:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`

### 6. Deploy the theme app extension

The storefront widget lives in:

- `extensions/order-tracker-widget/blocks/order-tracker-widget.liquid`
- `extensions/order-tracker-widget/assets/order-tracker-widget.js`
- `extensions/order-tracker-widget/assets/order-tracker-widget.css`

Add this extension folder to your Shopify app project and deploy it with Shopify CLI. After deployment:

1. Open the store theme customizer
2. Enable the `Order Tracker Widget` app embed
3. Keep the default proxy path `/apps/track-order`
4. Save the theme

The widget now renders a floating storefront chatbot with:

- product and collection discovery
- price and availability replies
- AWB or order-ID based tracking
- quick action suggestions
- pro chat styling with launcher, message bubbles, and tracking summary cards

### 7. Local Shopify testing

For local testing, run the Node server and expose it through a tunnel. Point the app proxy to the tunnel URL. In non-production mode, proxy signature validation is skipped if `SHOPIFY_API_SECRET` is not set.

## Tidio Integration

Tidio can call the backend directly because the API returns a chatbot-friendly `reply` field.

### Sample Request

```json
{
  "awb": "123456789"
}
```

### Sample Tidio API Call

```bash
curl --request POST https://your-domain.com/api/track-order \
  --header "Content-Type: application/json" \
  --data "{\"awb\":\"123456789\"}"
```

### Tidio-Compatible Response

```json
{
  "success": true,
  "reply": "Your order is currently in transit. Last update: Delhi Hub. Expected delivery: 18 April."
}
```

Use `reply` as the message text inside your chatbot flow. The same endpoint also returns structured fields such as `status`, `last_location`, and `expected_delivery` for richer bot logic.

## Deploy On Render

### Dashboard flow

1. Push this repository to GitHub
2. In Render, create a new Web Service from the repository
3. Use:
   - Build command: `npm install`
   - Start command: `npm start`
4. Add these environment variables in Render:
   - `NODE_ENV=production`
   - `STORE_SETTINGS_FILE=/var/data/store-settings.json`
   - `SETTINGS_ENCRYPTION_KEY`
   - `SHOPIFY_APP_NAME=Shopify Store Assistant App`
   - `SHOPIFY_APP_HANDLE=shopify-store-assistant-app`
   - `SHIPROCKET_EMAIL`
   - `SHIPROCKET_PASSWORD`
   - `SHOPIFY_API_SECRET`
   - `SHOPIFY_STORE_DOMAIN`
   - `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
   - `GEMINI_API_KEY`
   - `SHOPIFY_STOREFRONT_API_VERSION=2025-07`
   - optional `STORE_*` variables for shipping, return, payment, cancellation, contact, and brand replies
   - `ALLOW_ORIGIN`
5. Attach a persistent disk. The included `render.yaml` blueprint mounts `/var/data` and stores merchant settings there.

### Blueprint flow

This repo already includes `render.yaml`. Render will provision the service, mount a persistent disk, and use the correct build and start commands. You only need to fill in the secrets.

## Deploy On Railway

1. Create a new Railway project from the repository
2. Railway will detect the Node app automatically
3. Add the same environment variables used for Render
4. Set the start command to `npm start` if Railway does not infer it

## Logging

HTTP access logs and application logs are emitted as JSON, which makes them easy to search in Render or Railway log streams.

## Notes

- The Shiprocket token cache is in memory. This is fine for a single Node instance. If you scale horizontally, move the token cache to Redis.
- Merchant settings are stored in the JSON file pointed to by `STORE_SETTINGS_FILE`. Use a persistent disk path in production.
- The Shopify proxy route should be used from storefront themes. Tidio or other bots can call `/api/track-order` directly.
- If Shiprocket returns an unexpected payload or becomes unavailable, the API returns a safe fallback message instead of leaking raw provider errors.
