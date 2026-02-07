-- Function to copy all team rosters from one week to the next
CREATE OR REPLACE FUNCTION copy_all_rosters_to_next_week(
  from_week INTEGER,
  to_week INTEGER,
  target_season INTEGER DEFAULT 2024
)
RETURNS TABLE(
  teams_copied INTEGER,
  players_copied INTEGER
) AS $$
DECLARE
  team_count INTEGER;
  player_count INTEGER;
BEGIN
  -- Delete any existing rosters for the target week to avoid conflicts
  DELETE FROM rosters
  WHERE week = to_week AND season = target_season;

  -- Copy all rosters from the source week to target week
  INSERT INTO rosters (team_id, player_id, week, season, position_slot)
  SELECT team_id, player_id, to_week, season, position_slot
  FROM rosters
  WHERE week = from_week AND season = target_season;

  -- Get counts
  GET DIAGNOSTICS player_count = ROW_COUNT;

  SELECT COUNT(DISTINCT team_id) INTO team_count
  FROM rosters
  WHERE week = to_week AND season = target_season;

  RETURN QUERY SELECT team_count, player_count;
END;
$$ LANGUAGE plpgsql;
