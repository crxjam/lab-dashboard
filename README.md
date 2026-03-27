# GitHub Pages version

This is a static browser-based version of the lab capacity simulator, suitable for **GitHub Pages**.

## Files
- `index.html`
- `style.css`
- `app.js`
- `c15_episode_level_for_dashboard.csv` (optional demo data)

## Deploy on GitHub Pages
1. Create a GitHub repository.
2. Upload these files to the repository root.
3. In GitHub, open **Settings** → **Pages**.
4. Under **Build and deployment**, choose:
   - **Source:** Deploy from a branch
   - **Branch:** `main`
   - **Folder:** `/ (root)`
5. Save.
6. Wait a minute or two. GitHub will publish a URL for the site.

## Privacy note
If the repository is public and the CSV is included, the CSV will be downloadable by anyone with the link.
If you do not want that:
- keep the CSV out of the repo, and
- upload it manually inside the site after it loads.

## SA vs SAM logic
- SA = normal processing
- SAM = downtime/offline registration
- The simulator uses entered time as the better in-system start proxy for SAM when present
