# Shopify Storefront API Setup Guide

## Problem
The chatbot can't read products from your Shopify store because the **Storefront Access Token** is not configured.

## Solution: Get Your Storefront Access Token

### For Custom/Private Apps:

1. Go to your **Shopify Admin**
2. Navigate to **Settings > Apps and integrations**
3. Click **"Develop apps"** (top right)
4. Select the **"Store Assistant App"** (or create one if it doesn't exist)
5. Go to the **"Configuration"** tab
6. Under **"Admin API access scopes"**, ensure you have `read_products` checked
7. Go to the **"API credentials"** tab
8. Under **"Storefront API"**, copy the **"Access token"** (it looks like a long string starting with "shp_")

### If You Don't See Storefront API:

You may need to enable it:
1. In the app's Configuration, add these scopes:
   - `unauthenticated_read_product_listings`
   - `unauthenticated_read_product_inventory`
2. Save and reinstall the app
3. Then the Storefront API section will appear in the API credentials

## Setting the Token in Vercel

1. Go to your **Vercel project settings**
2. Add a new **environment variable**:
   - **Name**: `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
   - **Value**: Paste the token from Shopify (the long string like `shp_...`)
3. Also ensure these are set:
   - `SHOPIFY_STORE_DOMAIN`: Your store domain (e.g., `litaf.in` or `your-store.myshopify.com`)
   - `SHOPIFY_STOREFRONT_API_VERSION`: `2025-07` (default is fine)
4. Redeploy the app after saving

## Setting Locally for Testing

Edit your `.env` file:
```
SHOPIFY_STORE_DOMAIN=litaf.in
SHOPIFY_STOREFRONT_ACCESS_TOKEN=shp_xxxxxxxxxxxxx
```

Then restart your local server.

## Verify It's Working

1. Check the Vercel logs: `vercel logs --follow`
2. Look for messages that show:
   - `hasToken: true` (means token is being sent)
   - No "Shopify Storefront API failed" errors
3. Try asking the chatbot: "What products do you have?"
4. It should now list products instead of saying "I could not find products"

## Common Issues

### "I could not find products"
- Check that SHOPIFY_STOREFRONT_ACCESS_TOKEN is set and not empty
- Check that SHOPIFY_STORE_DOMAIN is correct
- Check Vercel logs for "Shopify Storefront API failed" messages

### "Store catalog is not connected yet"
- SHOPIFY_STOREFRONT_ACCESS_TOKEN is missing or empty
- SHOPIFY_STORE_DOMAIN is missing or invalid

### API returns 401 Unauthorized
- Token is expired or invalid
- Generate a new token from Shopify Admin

### API returns 404
- Store domain is wrong (should not include `/admin` or `https://`)
- Example correct: `litaf.in` or `mystore.myshopify.com`
- Example wrong: `https://mystore.myshopify.com/admin`

## Next Steps

After setting the token:
1. Push your changes: `git add . && git commit -m "Update Shopify config" && git push`
2. Vercel will redeploy automatically
3. Check `/api/setup-status` endpoint to verify configuration
4. Test the chatbot in your store
