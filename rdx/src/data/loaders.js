export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.json();
}

export async function loadPrototypeData(base = './data') {
  const [mapping, matcherDiff, palettes, spriteAnims, alignment] = await Promise.all([
    fetchJson(`${base}/rd_asset_mapping_v1.json`),
    fetchJson(`${base}/rd_asset_matcher_diff_sourcefix_v27_curated.json`),
    fetchJson(`${base}/palettes.json`),
    fetchJson(`${base}/sprite_anims.json`),
    fetchJson(`${base}/alignment.json`)
  ]);
  return { mapping, matcherDiff, palettes, spriteAnims, alignment };
}
