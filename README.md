# Shopify Shiprocket Order Tracker

Production-ready Node.js + Express backend for Shopify order tracking with Shiprocket, plus a storefront app-embed assistant for products, collections, price, stock, and tracking queries.

## Features

- `POST /api/track-order` accepts `{ "awb": "..." }` or `{ "order_id": "..." }`
- `POST /api/chatbot` accepts `{ "message": "..." }` for conversational support
- `GET /api/setup-status` returns exact Shopify app values for the current deployed domain
- `GET /shopify/app-home` shows a live setup page with the fields to paste in Shopify
- Shiprocket authentication with in-memory token caching
- Tracking lookup through Shiprocket AWB and order endpoints
- Shopify Storefront API lookup for products and collections
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
|   |-- validateTrackRequest.js
|   `-- verifyShopifyProxy.js
|-- routes/
|   |-- index.js
|   |-- setupRoutes.js
|   `-- trackingRoutes.js
|-- services/
|   |-- chatAssistant.js
|   |-- shiprocket.js
|   `-- shopifyCatalog.js
|-- utils/
|   |-- httpError.js
|   |-- logger.js
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
```

`SHIPROCKET_TOKEN_TTL_MS` defaults to 10 days so the app does not log in on every request. Shiprocket tokens are refreshed automatically when the cache expires or a `401` is returned.
`SHOPIFY_STORE_DOMAIN` and `SHOPIFY_STOREFRONT_ACCESS_TOKEN` are required if you want the chatbot to answer product and collection questions.

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
  "reply": "I found 2 products for \"black hoodies\". Black Hoodie - ₹1,999 - In stock; Oversized Black Hoodie - ₹1,799 - In stock.",
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

Deploy this repository to Render or Railway first so Shopify can reach a public HTTPS URL.

After deployment, open:

- `https://your-domain.com/shopify/app-home`
- `https://your-domain.com/api/setup-status`

These routes show the exact App URL, redirect URLs, app proxy values, and missing environment variables for the deployed domain.

### 2. Configure the Shopify app proxy

In your Shopify app settings, create an app proxy with:

- Subpath prefix: `apps`
- Subpath: `track-order`
- Proxy URL: `https://your-domain.com/apps/track-order`

The backend already exposes both:

- `GET /apps/track-order?awb=123456789`
- `POST /apps/track-order`
- `POST /apps/track-order/chat`

The proxy route verifies Shopify signatures when `SHOPIFY_API_SECRET` is set.

### 3. Fill Shopify app settings

In Shopify app setup, use the values shown on `/shopify/app-home`:

- App URL: `https://your-domain.com/shopify/app-home`
- Allowed redirection URL: `https://your-domain.com/auth/callback`
- Allowed redirection URL: `https://your-domain.com/auth/oauth/callback`
- App proxy prefix: `apps`
- App proxy subpath: `track-order`
- App proxy URL: `https://your-domain.com/apps/track-order`

Shiprocket credentials are **not** filled in Shopify app settings. Keep `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD` only in your backend environment variables.

If you are using Shopify CLI for a separate app project, copy the sample in `shopify.app.toml.example` and replace the domain and API key with your real values.

### 4. Create Storefront API token

For product and collection answers, create a Storefront access token in Shopify and enable:

- `unauthenticated_read_product_listings`
- `unauthenticated_read_product_inventory`

Then set these environment variables on your backend:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`

### 5. Deploy the theme app extension

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

### 6. Local Shopify testing

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
   - `SHOPIFY_APP_NAME=Shopify Store Assistant App`
   - `SHOPIFY_APP_HANDLE=shopify-store-assistant-app`
   - `SHIPROCKET_EMAIL`
   - `SHIPROCKET_PASSWORD`
   - `SHOPIFY_API_SECRET`
   - `SHOPIFY_STORE_DOMAIN`
   - `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
   - `SHOPIFY_STOREFRONT_API_VERSION=2025-07`
   - `ALLOW_ORIGIN`

### Blueprint flow

This repo already includes `render.yaml`. Render will provision the service with the correct build and start commands. You only need to fill in the secrets.

## Deploy On Railway

1. Create a new Railway project from the repository
2. Railway will detect the Node app automatically
3. Add the same environment variables used for Render
4. Set the start command to `npm start` if Railway does not infer it

## Logging

HTTP access logs and application logs are emitted as JSON, which makes them easy to search in Render or Railway log streams.

## Notes

- The Shiprocket token cache is in memory. This is fine for a single Node instance. If you scale horizontally, move the token cache to Redis.
- The Shopify proxy route should be used from storefront themes. Tidio or other bots can call `/api/track-order` directly.
- If Shiprocket returns an unexpected payload or becomes unavailable, the API returns a safe fallback message instead of leaking raw provider errors.
