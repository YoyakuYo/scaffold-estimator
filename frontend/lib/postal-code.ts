export interface PostalCodeResult {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
}

/**
 * Lookup Japanese address from postal code using zipcloud API.
 * Accepts formats: "1000001" or "100-0001"
 */
export async function lookupPostalCode(postalCode: string): Promise<PostalCodeResult | null> {
  const cleaned = postalCode.replace(/-/g, '').trim();
  if (cleaned.length !== 7 || !/^\d{7}$/.test(cleaned)) return null;

  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${cleaned}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) return null;

    const r = data.results[0];
    return {
      postalCode: r.zipcode,
      prefecture: r.address1,
      city: r.address2,
      town: r.address3,
    };
  } catch {
    return null;
  }
}

/**
 * Format postal code with hyphen: "1000001" → "100-0001"
 */
export function formatPostalCode(value: string): string {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length <= 3) return digits;
  return digits.slice(0, 3) + '-' + digits.slice(3, 7);
}

/**
 * 47 Japanese prefectures
 */
export const PREFECTURES = [
  '北海道',
  '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
] as const;
