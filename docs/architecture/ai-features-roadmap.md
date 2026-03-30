# AI Features Roadmap

## Near-term AI Features (Implementation Ready)

### 1. Auto HSN Population
When creating or editing an item, the AI suggests the correct HSN/SAC code based on the item name and description.

**How it works:**
- User types item name (e.g., "Basmati Rice 25kg")
- AI matches against the HSN code database (~8,000 codes)
- Suggests top 3 matches: `1006 - Rice` (99% confidence), `1006.30 - Semi-milled rice` (85%), etc.
- User confirms or overrides
- Learning: stores confirmed mappings per business for future auto-fill

**Implementation:**
- Embed HSN code list in the DB or as a static JSON
- Use fuzzy matching + LLM for ambiguous cases
- MCP tool: `item_suggest_hsn` — AI agents can also use this
- Frontend: inline suggestion dropdown below HSN field

### 2. Auto Item Creation from Business Description
New business onboarding: describe your business to the AI agent, it creates your initial item catalog.

**How it works:**
- User: "I run a grocery store selling vegetables, rice, dal, and spices"
- AI generates: 15-20 common items with names, units (kg/g/pcs), suggested prices, HSN codes, tax rates
- User reviews the list, edits/removes as needed, confirms
- Items are bulk-created via `item.bulkCreate` (new endpoint)

**Implementation:**
- MCP tool: `item_suggest_catalog` — takes business description, returns suggested items
- Frontend: onboarding wizard step or a "Smart Setup" button in items page
- Uses LLM to generate contextually appropriate items for Indian businesses

### 3. Auto Item Creation from Photos
User takes photos of their products → AI creates items with names, descriptions, and suggested prices.

**How it works:**
- User uploads or takes photos (mobile camera / web file picker)
- Vision AI identifies the product: name, category, approximate market price
- Creates item entry: name, description (from visual features), unit, category
- User reviews and confirms

**Implementation:**
- Uses Claude Vision API or similar multimodal LLM
- Mobile: `expo-camera` for capture, upload to MaxIO (S3-compatible storage)
- API endpoint: `POST /api/items/from-image` — accepts image, returns suggested item data
- Frontend: "Scan Product" button in items page with camera overlay

### 4. AI-Assisted Product Photography Processing
For businesses with an online store, transform basic product photos into professional-quality catalog images.

**How it works:**
- User uploads raw product photo (taken on phone)
- AI processes: background removal, lighting adjustment, shadow addition, consistent framing
- Generates a professional catalog-ready image
- Stored in MaxIO, linked to the item

**Important constraints:**
- Processed images are for CATALOG USE ONLY — displayed on the online store
- User CANNOT download the processed high-res images (prevents misuse of the processing credits)
- Original uploaded photo remains downloadable
- Processing is a premium/credit-based feature

**Implementation:**
- Background removal: `rembg` or cloud API (remove.bg, Photoroom)
- Enhancement: stable diffusion inpainting for background, or simpler CV-based approach
- Storage: original at `items/{id}/original.jpg`, processed at `items/{id}/catalog.webp`
- API: `POST /api/items/{id}/process-image` — takes the original, returns processed URL
- Frontend: "Enhance for Store" button on item images
- Download restriction: catalog images served with `Content-Disposition: inline` (no download), watermarked if accessed directly

## Previously Documented Features (from AI docs)

### 5. Auto GST Rate Updates
- Monitor government gazette for rate changes
- Notify business owner with affected items
- One-click acceptance to update all item tax rates

### 6. Dynamic Pricing Intelligence
- Competitor price monitoring
- Margin-aware pricing suggestions
- Market trend analysis

### 7. Shiprocket Integration
- Auto-generate shipping labels from delivery challans
- Track shipments
- Delivery status sync back to invoice

### 8. AI Customer Service (OpenClaw)
- Deploy customer-facing agents for online store
- Handle order status, payment reminders, product questions
- Reads from Hisaabo catalog and order data via MCP

## Implementation Priority

| Feature | Complexity | Impact | Priority |
|---------|-----------|--------|----------|
| Auto HSN Population | Medium | High (every item needs HSN for GST) | P0 |
| Item from Business Description | Low | High (onboarding friction reduction) | P0 |
| Auto GST Rate Updates | Medium | High (compliance) | P1 |
| Item from Photos | High | Medium (convenience) | P1 |
| AI Product Photography | High | Medium (store quality) | P2 |
| Dynamic Pricing | High | Medium (competitive advantage) | P2 |
| Shiprocket Integration | Medium | Medium (logistics) | P2 |
| AI Customer Service | High | High (store engagement) | P2 |
