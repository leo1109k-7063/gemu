select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'settings',
    'students',
    'point_events',
    'omok_games',
    'game_profiles',
    'game_settings',
    'coin_transactions'
  )
order by table_name;
