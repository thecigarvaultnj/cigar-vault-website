# Claude Code instructions for cigar-vault-website

## Deployment

This site does NOT auto-deploy from GitHub. Netlify is connected via CLI only,
not via continuous deployment. After committing and pushing changes, the user
must run `netlify deploy --prod` from PowerShell to push the changes live.

Do not tell the user that "Netlify will pick it up automatically" or that
"the site will rebuild from the push." That is incorrect for this setup.

If asked to deploy, the full sequence is:
1. git add .
2. git commit -m "..."
3. git push
4. netlify deploy --prod

## Project context

- Live site: https://thecigarvaultnj.com
- Owner: Selim, retail cigar shop in Pine Brook, NJ
- Local folder: C:\Selim's Folder\cigar-vault-website
- Multi-page site (index, story, merch, petition, visit, catalog, keykeepers, cart, checkout, admin)
- Brand palette: deep gold (#C9A84C), vault teal (#1D4A4A), cream (#FAF6EE), charcoal (#1A1A1A)
- Typography: Playfair Display, Cormorant Garamond, Cinzel

## Design direction

**Gold is the only accent.** `--gold #C9A84C` (hover `--gold-light #E0BC6E`)
is the single accent; everything else is neutral ground — charcoal
backgrounds, cream / muted-cream text, and the teal green used only as
surface chrome. Do not introduce a second accent color. On the catalog page,
header + filter bar + sidebar use ONE green (`--tb-mid #0a3830`) — never
three competing greens — and every hover / active / focus state is gold.

**Typography (current):** Playfair Display (display + product names),
Cormorant Garamond (body serif), Lato (UI labels, data, buttons — uppercase
with letter-spacing), Cinzel (small-caps accents, e.g. the monogram tile).

**Catalog card treatment:** borderless cards on the page background with a
very subtle background shift (no visible edge); a reserved 4:3 image area at
top (monogram fallback until real photos land, so layout never shifts);
brand eyebrow, name, gold price, and a **low-stock warning only** (no
"N in stock"); a type badge only for Box/Bundle/Pack (never "Single"). Add
to Cart is a **gold ghost/outline** that fills gold on hover; non-buyable
states are **quiet muted text, not buttons**. Default catalog sort is
**buyable-first, then stock descending.**

**Accessibility floor:** honor `prefers-reduced-motion` (no hover lifts /
reveal animation) and keep visible keyboard focus on controls.

**Held — brand-level, do NOT change from the website alone:** warming the
palette toward tobacco/cedar/maduro tones and swapping the display-type
pairing affect the logo, Instagram, and storefront, so they are the owner's
call, not a web-only edit. A cigar-band placeholder-tile treatment is under
evaluation (mocked behind a toggle on the catalog page) but not yet adopted.

## Product catalog data

`data/catalog.json` is a single-line JSON array of positional rows. It is
maintained two ways: hand-edited for small fixes, and merged weekly from a
Thrive Inventory "Sell-Through" CSV export via `scripts/sync-inventory.js`
(price/stock updates, negatives→0, hazmat flags, new-product staging via
`--add-new`/`--import-new`, and the exclude/override CSVs). There is no build
step and no generator that rebuilds it from source — catalog.json IS the
source of truth. Row shape:

    [name, brand, price, stock, type, id, image, shippable, excludeOnline, onlineOverride]

- `name`, `brand` — strings
- `price` — number in USD (e.g. `42.45`); `null` is allowed and hides the
  add-to-cart control for that item
- `stock` — integer count; `<= 0` disables add-to-cart
- `type` — `"Single"` or `"Box/Bundle"`
- `id` — **stable slug of `brand + " " + name`**: lowercased, `&` → `and`,
  every run of non-alphanumeric characters collapsed to a single `-`, and
  leading/trailing `-` trimmed. Example: `"AJ Fernandez"` + `"Fresh Pack"`
  → `aj-fernandez-fresh-pack`. **Freeze the id once assigned** — never
  regenerate it when a product is renamed, or existing carts break. On a
  slug collision, append `-2`, `-3`, … The cart keys off this id.
- `image` — photo URL, or `null` to fall back to the monogram tile
- `shippable` — boolean (default `true`); `false` = cannot ship (hazmat:
  lighters / butane / torch / fuel / refill). Set by the sync's hazmat check.
- `excludeOnline` — boolean (default `false`); manual "never sell online."
- `onlineOverride` — boolean (default `false`); force buyable below the stock
  threshold (still respects the buffer).

The last three are **manual availability fields the weekly sync never
overwrites.** Purchasability is DERIVED at render time (`js/cart.js`
`availability()`), never stored:
`buyable = shippable && !excludeOnline && (stock - BUFFER) >= (onlineOverride ? 1 : THRESHOLD)`
(THRESHOLD 10, BUFFER 1). Non-buyable products still appear and stay
browsable — showing "Sold out", "In store only — cannot be shipped", or
"In store only — call (973) 333-7475".

When hand-adding a product, assign an `id` by this convention, set `image`
to `null` (or a URL), and set the three availability fields to their
defaults. The cart (`js/cart.js`) and catalog (`js/catalog.js`) both log a
console warning if any row is missing an id.