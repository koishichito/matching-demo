const METERS_PER_DEGREE_LAT = 111_320; // approximate

export type LocationPreset = {
  key: string;
  label: string;
  lat: number;
  lng: number;
  tags?: string[];
};

export const LOCATION_PRESETS: LocationPreset[] = [
  { key: "shibuya", label: "渋谷", lat: 35.6595, lng: 139.7005, tags: ["にぎやか", "20代", "カジュアル"] },
  { key: "ebisu", label: "恵比寿", lat: 35.6467, lng: 139.7101, tags: ["ワイン", "大人", "落ち着き"] },
  { key: "shinjuku", label: "新宿", lat: 35.6906, lng: 139.7006, tags: ["多国籍", "にぎやか"] },
  { key: "roppongi", label: "六本木", lat: 35.6629, lng: 139.731, tags: ["ハイエンド", "外国人歓迎"] },
  { key: "ginza", label: "銀座", lat: 35.6721, lng: 139.7706, tags: ["大人", "ラグジュアリー"] },
  { key: "nakameguro", label: "中目黒", lat: 35.6437, lng: 139.6993, tags: ["カフェ", "ゆったり"] },
  { key: "kichijoji", label: "吉祥寺", lat: 35.7033, lng: 139.5795, tags: ["公園", "ナチュラル"] },
  { key: "yokohama", label: "横浜", lat: 35.4437, lng: 139.638, tags: ["港町", "デート"] },
  { key: "ikebukuro", label: "池袋", lat: 35.7289, lng: 139.71, tags: ["学生", "にぎやか"] },
  { key: "umeda", label: "大阪・梅田", lat: 34.7055, lng: 135.4983, tags: ["関西", "ビジネス"] },
  { key: "kyoto", label: "京都・河原町", lat: 35.0037, lng: 135.7681, tags: ["旅行", "落ち着き"] },
  { key: "fukuoka", label: "福岡・天神", lat: 33.5902, lng: 130.4017, tags: ["屋台", "にぎやか"] },
  { key: "sapporo", label: "札幌・すすきの", lat: 43.0555, lng: 141.3564, tags: ["北海道", "ゆったり"] }
];

export function findPreset(term: string): LocationPreset | undefined {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return undefined;
  return LOCATION_PRESETS.find((preset) => {
    const haystacks = [preset.key, preset.label];
    return haystacks.some((value) => value.toLowerCase().includes(normalized));
  });
}

export function toGrid(lat: number, lng: number, gridMeters = 300) {
  const latUnits = METERS_PER_DEGREE_LAT / gridMeters;
  const gridLat = Math.round(lat * latUnits) / latUnits;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  const lngUnits = metersPerDegreeLng / gridMeters;
  const gridLng = Math.round(lng * lngUnits) / lngUnits;
  return { gridLat: Number(gridLat.toFixed(6)), gridLng: Number(gridLng.toFixed(6)) };
}

export function distanceInKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Number((R * c).toFixed(2));
}
