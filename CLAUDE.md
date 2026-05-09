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
- Multi-page site (index, story, merch, petition, visit, catalog, open-vault, admin)
- Brand palette: deep gold (#C9A84C), vault teal (#1D4A4A), cream (#FAF6EE), charcoal (#1A1A1A)
- Typography: Playfair Display, Cormorant Garamond, Cinzel