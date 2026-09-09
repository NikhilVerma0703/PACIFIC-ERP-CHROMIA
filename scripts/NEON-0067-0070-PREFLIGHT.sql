WITH expected(script, tbl, col) AS (VALUES
  ('0066','fab_piece','charged_edge'),('0066','fab_piece','charged_sink'),('0066','fab_piece','charged_at'),
  ('0067','fab_requirement','edges_top'),('0067','fab_requirement','edges_bottom'),('0067','fab_requirement','edges_side'),
  ('0067','fab_requirement','edge_rate'),('0067','fab_requirement','pricing_mode'),
  ('0067','fab_requirement','edge_total_override'),('0067','fab_requirement','edge_total_override_by'),
  ('0067','fab_requirement','edge_total_override_at'),
  ('0067','fab_piece','polish_by_hand'),('0067','fab_piece','hand_edges_top'),('0067','fab_piece','hand_edges_bottom'),
  ('0067','fab_piece','hand_edges_side'),('0067','fab_piece','hand_rate'),('0067','fab_piece','hand_pricing_mode'),
  ('0067','fab_piece','hand_total_override'),('0067','fab_piece','hand_assigned_at'),
  ('0067','fab_piece','hand_assigned_by_id'),('0067','fab_piece','hand_assigned_session_id'),
  ('0067','fab_project','manual_total'),('0067','fab_project','manual_total_by'),
  ('0067','fab_project','manual_total_at'),('0067','fab_project','manual_total_note'),
  ('0068','fab_requirement','dim_unit'),
  ('0069','fab_requirement','pair_rate'),('0069','fab_piece','hand_pair_rate'),
  ('0070','fab_requirement','edge_rate_top'),('0070','fab_requirement','edge_rate_bottom'),
  ('0070','fab_requirement','edge_rate_side'),
  ('0070','fab_piece','hand_rate_top'),('0070','fab_piece','hand_rate_bottom'),('0070','fab_piece','hand_rate_side')
)
SELECT e.script, e.tbl, e.col,
       CASE WHEN c.column_name IS NULL THEN 'MISSING -- needs migration' ELSE 'present' END AS status
FROM   expected e
LEFT   JOIN information_schema.columns c
       ON c.table_schema='public' AND c.table_name=e.tbl AND c.column_name=e.col
ORDER  BY (c.column_name IS NOT NULL), e.script, e.tbl, e.col;
