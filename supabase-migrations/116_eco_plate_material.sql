-- Eco plate (エコプレート): ground plate under jack base; BOM qty = jack base qty.
INSERT INTO scaffold_materials (
  code,
  name_jp,
  name_en,
  category,
  scaffold_type,
  size_spec,
  unit,
  weight_kg,
  rental_price_monthly,
  sort_order
) VALUES (
  'SHARED-ECO-PLATE',
  'エコプレート',
  'Eco Plate',
  'foundation',
  'all',
  'ジャッキ下敷',
  '枚',
  3.0,
  15,
  68
)
ON CONFLICT (code) DO NOTHING;
