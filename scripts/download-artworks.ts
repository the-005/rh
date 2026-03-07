import fs from "node:fs";
import path from "node:path";

const API_BASE = "https://api.artic.edu/api/v1";
const IIIF_BASE = "https://www.artic.edu/iiif/2";
const OUTPUT_DIR = "./public/artworks";
const MANIFEST_PATH = "./public/artworks/manifest.json";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.artic.edu/",
};

type ArticArtwork = {
  id: number;
  title: string;
  artist_display: string;
  date_display: string;
  image_id: string;
  thumbnail: { width: number; height: number } | null;
};

type ManifestItem = {
  url: string;
  title: string;
  artist: string;
  year: string;
  link: string;
  width: number;
  height: number;
};

const SEARCH_QUERY = {
  query: {
    bool: {
      must: [
        { term: { is_public_domain: true } },
        { term: { "classification_titles.keyword": "painting" } },
        { exists: { field: "image_id" } },
        { range: { date_end: { gte: 1600 } } },
        { range: { date_start: { lte: 1725 } } },
      ],
      should: [
        { match: { style_title: "Baroque" } },
        { term: { "department_title.keyword": "Painting and Sculpture of Europe" } },
      ],
      minimum_should_match: 1,
    },
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAllArtworks(): Promise<ArticArtwork[]> {
  const allArtworks: ArticArtwork[] = [];
  const fields = "id,title,artist_display,date_display,image_id,thumbnail";
  const params = encodeURIComponent(JSON.stringify(SEARCH_QUERY));
  let page = 1;

  while (allArtworks.length < 250) {
    console.log(`Fetching page ${page}...`);
    const url = `${API_BASE}/artworks/search?params=${params}&page=${page}&limit=50&fields=${fields}`;

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const data = await res.json();
    if (!data.data?.length) break;

    const valid = data.data.filter((a: ArticArtwork) => a.image_id && a.thumbnail);
    allArtworks.push(...valid);
    console.log(`  Got ${valid.length} (total: ${allArtworks.length})`);

    page++;
    await sleep(300);
  }

  return allArtworks.slice(0, 250);
}

async function downloadImage(imageId: string, filepath: string): Promise<boolean> {
  const url = `${IIIF_BASE}/${imageId}/full/512,/0/default.jpg`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      console.error(`  Failed: ${res.status}`);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
    return true;
  } catch (err) {
    console.error(`  Error:`, err);
    return false;
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("Fetching artworks from API...\n");
  const artworks = await fetchAllArtworks();
  console.log(`\nFound ${artworks.length} artworks\n`);

  const manifest: ManifestItem[] = [];

  for (let i = 0; i < artworks.length; i++) {
    const artwork = artworks[i];
    const filename = `${artwork.image_id}.jpg`;
    const filepath = path.join(OUTPUT_DIR, filename);

    const item: ManifestItem = {
      url: `/artworks/${filename}`,
      title: artwork.title,
      artist: artwork.artist_display || "Unknown Artist",
      year: artwork.date_display,
      link: `https://www.artic.edu/artworks/${artwork.id}`,
      width: artwork.thumbnail?.width ?? 0,
      height: artwork.thumbnail?.height ?? 0,
    };

    if (fs.existsSync(filepath)) {
      console.log(`[${i + 1}/${artworks.length}] Skipping (exists): ${artwork.title.slice(0, 40)}`);
      manifest.push(item);
      continue;
    }

    console.log(`[${i + 1}/${artworks.length}] Downloading: ${artwork.title.slice(0, 40)}`);
    const success = await downloadImage(artwork.image_id, filepath);

    if (success) {
      manifest.push(item);
    }

    await sleep(500);
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nDone! ${manifest.length} images → ${MANIFEST_PATH}`);
}

main().catch(console.error);
