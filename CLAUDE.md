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

## Product catalog data

`data/catalog.json` is hand-maintained static data (there is NO generator,
export, feed, or build step — do not assume one exists). It is a single-line
JSON array of positional rows:

    [name, brand, price, stock, type, id, image]

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

When hand-adding a product, assign an `id` by this convention and set
`image` to `null` (or a URL). The cart (`js/cart.js`) and catalog
(`js/catalog.js`) both log a console warning if any row is missing an id.