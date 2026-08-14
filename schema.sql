--
-- PostgreSQL database dump
--

\restrict DFzpX8IFhUmOdAItxDWiFe5qiDd7JhDcTKCAi29Oxd42IZf4GHtvOfVJgqy1SYG

-- Dumped from database version 18.1 (Postgres.app)
-- Dumped by pg_dump version 18.1 (Postgres.app)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: get_sell_price(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

-- FPL-style sell pricing: you keep half of any price rise (rounded down to
-- $0.1); falls are fully yours. Single source of truth for the transfer
-- money maths (calculate_transfer_impact), the recorded sale price, and the
-- lineup display.
CREATE FUNCTION public.get_sell_price(p_team_id integer, p_player_id integer, p_season integer) RETURNS numeric
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_current NUMERIC;
    v_purchase NUMERIC;
BEGIN
    SELECT pcp.current_price INTO v_current
    FROM player_current_prices pcp
    WHERE pcp.player_id = p_player_id AND pcp.season = p_season;
    IF v_current IS NULL THEN RETURN NULL; END IF;

    SELECT t.price INTO v_purchase
    FROM transfers t
    WHERE t.team_id = p_team_id AND t.player_id = p_player_id
      AND t.season = p_season AND t.transfer_type = 'buy'
    ORDER BY t.transfer_id DESC LIMIT 1;

    IF v_purchase IS NULL OR v_current <= v_purchase THEN
        RETURN v_current;
    END IF;
    RETURN v_purchase + FLOOR((v_current - v_purchase) * 10 / 2) / 10;
END;
$$;


--
-- Name: calculate_transfer_impact(integer, integer, integer, integer[], integer[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_transfer_impact(p_team_id integer, p_week integer, p_season integer, p_players_out integer[], p_players_in integer[], p_current_week character varying DEFAULT 'Preseason') RETURNS TABLE(current_spent numeric, money_freed numeric, money_needed numeric, new_total_spent numeric, remaining_budget numeric, is_affordable boolean, position_valid boolean, missing_positions text, free_transfers_available integer, transfers_count integer, point_cost integer, roster_count integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_current_spent DECIMAL;
    v_money_freed DECIMAL;
    v_money_needed DECIMAL;
    v_qb_count INTEGER;
    v_rb_count INTEGER;
    v_wr_count INTEGER;
    v_te_count INTEGER;
    v_k_count INTEGER;
    v_def_count INTEGER;
    v_roster_count INTEGER;
    v_position_valid BOOLEAN;
    v_missing TEXT[];
    v_free_transfers INTEGER;
    v_transfers_count INTEGER;
    v_point_cost INTEGER;
    v_extra_transfers INTEGER;
BEGIN
    -- Get current team spending and free transfers
    SELECT t.current_spent, t.free_transfers_remaining
    INTO v_current_spent, v_free_transfers
    FROM teams t
    WHERE t.team_id = p_team_id;

    -- Calculate money from selling players (FPL rule: purchase + half of
    -- any rise, rounded down to $0.1 — see get_sell_price)
    SELECT COALESCE(SUM(get_sell_price(p_team_id, p_out.player_id, p_season)), 0) INTO v_money_freed
    FROM unnest(p_players_out) AS p_out(player_id);

    -- Calculate cost of buying players
    SELECT COALESCE(SUM(pcp.current_price), 0) INTO v_money_needed
    FROM unnest(p_players_in) AS p_in(player_id)
    JOIN player_current_prices pcp ON pcp.player_id = p_in.player_id
    WHERE pcp.season = p_season;

    -- Calculate transfer count and point cost
    v_transfers_count := COALESCE(array_length(p_players_in, 1), 0);

    IF p_current_week = 'Preseason' THEN
        -- Unlimited transfers during preseason
        v_point_cost := 0;
    ELSE
        -- Calculate point penalty for extra transfers
        v_extra_transfers := GREATEST(0, v_transfers_count - v_free_transfers);
        v_point_cost := v_extra_transfers * 6;
    END IF;

    -- Check roster position constraints after transfer
    -- Count positions in roster after removing players_out and adding players_in
    WITH roster_after_transfer AS (
        SELECT p.position
        FROM rosters r
        JOIN players p ON r.player_id = p.player_id
        WHERE r.team_id = p_team_id
            AND r.week = p_week
            AND r.season = p_season
            AND NOT (r.player_id = ANY(p_players_out))
        UNION ALL
        SELECT p.position
        FROM unnest(p_players_in) AS p_in(player_id)
        JOIN players p ON p.player_id = p_in.player_id
    )
    SELECT
        COUNT(*),
        COALESCE(SUM(CASE WHEN position = 'QB' THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN position = 'RB' THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN position = 'WR' THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN position = 'TE' THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN position = 'K' THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN position = 'DEF' THEN 1 ELSE 0 END), 0)
    INTO v_roster_count, v_qb_count, v_rb_count, v_wr_count, v_te_count, v_k_count, v_def_count
    FROM roster_after_transfer;

    -- Check if all position minimums are met (1 QB, 3 RB, 3 WR, 1 TE, 1 K, 1 DEF) AND exactly 15 players
    v_position_valid := (v_roster_count = 15 AND v_qb_count >= 1 AND v_rb_count >= 3 AND v_wr_count >= 3
                        AND v_te_count >= 1 AND v_k_count >= 1 AND v_def_count >= 1);

    -- Build list of missing positions with format: 'X positions (currently Y)'
    v_missing := ARRAY[]::TEXT[];
    IF v_roster_count != 15 THEN
        v_missing := array_append(v_missing, FORMAT('Roster must have exactly 15 players (currently %s)', v_roster_count));
    END IF;
    IF v_qb_count < 1 THEN v_missing := array_append(v_missing, FORMAT('1 QB (currently %s)', v_qb_count)); END IF;
    IF v_rb_count < 3 THEN v_missing := array_append(v_missing, FORMAT('3 RBs (currently %s)', v_rb_count)); END IF;
    IF v_wr_count < 3 THEN v_missing := array_append(v_missing, FORMAT('3 WRs (currently %s)', v_wr_count)); END IF;
    IF v_te_count < 1 THEN v_missing := array_append(v_missing, FORMAT('1 TE (currently %s)', v_te_count)); END IF;
    IF v_k_count < 1 THEN v_missing := array_append(v_missing, FORMAT('1 K (currently %s)', v_k_count)); END IF;
    IF v_def_count < 1 THEN v_missing := array_append(v_missing, FORMAT('1 DEF (currently %s)', v_def_count)); END IF;

    RETURN QUERY SELECT
        v_current_spent,
        v_money_freed,
        v_money_needed,
        v_current_spent - v_money_freed + v_money_needed as new_total,
        100.0 - (v_current_spent - v_money_freed + v_money_needed) as remaining,
        (v_current_spent - v_money_freed + v_money_needed) <= 100.0 as affordable,
        v_position_valid,
        array_to_string(v_missing, ', '),
        v_free_transfers,
        v_transfers_count,
        v_point_cost,
        v_roster_count;
END;
$$;


--
-- Name: get_available_players(integer, character varying, numeric, numeric, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_available_players(p_season integer DEFAULT 2024, p_position character varying DEFAULT NULL::character varying, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_search_name character varying DEFAULT NULL::character varying, p_current_week character varying DEFAULT 'Preseason') RETURNS TABLE(player_id integer, player_name character varying, player_position character varying, player_team character varying, current_price numeric, avg_points numeric, season_total numeric, prev_season_total numeric, fixture_week_1 character varying, fixture_week_2 character varying, fixture_week_3 character varying, search_rank integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_next_week_1 INTEGER;
    v_next_week_2 INTEGER;
    v_next_week_3 INTEGER;
    v_is_preseason BOOLEAN;
BEGIN
    v_is_preseason := (p_current_week = 'Preseason' OR p_current_week = 'Setup');

    IF v_is_preseason THEN
        v_next_week_1 := 1;
        v_next_week_2 := 2;
        v_next_week_3 := 3;
    ELSE
        v_next_week_1 := p_current_week::integer + 1;
        v_next_week_2 := p_current_week::integer + 2;
        v_next_week_3 := p_current_week::integer + 3;
    END IF;

    RETURN QUERY
    SELECT
        p.player_id,
        p.name,
        p.position,
        p.team,
        pcp.current_price,
        CASE
            WHEN v_is_preseason THEN 0.0
            ELSE ROUND(AVG(ps.total_points), 2)
        END as avg_points,
        CASE
            WHEN v_is_preseason THEN 0.0
            ELSE ROUND(SUM(ps.total_points), 2)
        END as season_total,
        -- Previous season total points (for preseason display).
        -- Totals TABLE first: roll-forward-season archives the previous
        -- season out of player_stats (emptying the live scores view for
        -- that season) and computes player_season_totals precisely so
        -- this survives the roll. Live-view fallback covers seasons that
        -- were never rolled through (e.g. simulated mid-season testing).
        COALESCE(
          (SELECT pst_prev.total_points
           FROM player_season_totals pst_prev
           WHERE pst_prev.player_id = p.player_id
             AND pst_prev.season = p_season - 1
             AND pst_prev.league_format = 'ppr'),
          (SELECT ROUND(SUM(prev_ps.total_points), 2)
           FROM player_scores prev_ps
           WHERE prev_ps.player_id = p.player_id
             AND prev_ps.season = p_season - 1
             AND prev_ps.league_format = 'ppr')
        ) as prev_season_total,
        -- Next 3 fixtures (add @ if away)
        (SELECT CASE
            WHEN f1.home_team = p.team THEN f1.away_team
            WHEN f1.away_team = p.team THEN '@' || f1.home_team
            ELSE NULL
        END
        FROM nfl_fixtures f1
        WHERE f1.season = p_season AND f1.week = v_next_week_1
            AND (f1.home_team = p.team OR f1.away_team = p.team)
        LIMIT 1) as fixture_week_1,
        (SELECT CASE
            WHEN f2.home_team = p.team THEN f2.away_team
            WHEN f2.away_team = p.team THEN '@' || f2.home_team
            ELSE NULL
        END
        FROM nfl_fixtures f2
        WHERE f2.season = p_season AND f2.week = v_next_week_2
            AND (f2.home_team = p.team OR f2.away_team = p.team)
        LIMIT 1) as fixture_week_2,
        (SELECT CASE
            WHEN f3.home_team = p.team THEN f3.away_team
            WHEN f3.away_team = p.team THEN '@' || f3.home_team
            ELSE NULL
        END
        FROM nfl_fixtures f3
        WHERE f3.season = p_season AND f3.week = v_next_week_3
            AND (f3.home_team = p.team OR f3.away_team = p.team)
        LIMIT 1) as fixture_week_3,
        p.search_rank
    FROM players p
    JOIN player_current_prices pcp ON p.player_id = pcp.player_id
    LEFT JOIN player_scores ps ON p.player_id = ps.player_id
        AND ps.season = p_season
        AND ps.league_format = 'ppr'
        AND (v_is_preseason OR ps.week <= p_current_week::integer)
    WHERE pcp.season = p_season
        AND (p_position IS NULL OR p.position = p_position)
        AND (p_min_price IS NULL OR pcp.current_price >= p_min_price)
        AND (p_max_price IS NULL OR pcp.current_price <= p_max_price)
        AND (p_search_name IS NULL OR p.name ILIKE '%' || p_search_name || '%')
    GROUP BY p.player_id, p.name, p.position, p.team, pcp.current_price, p.search_rank
    ORDER BY pcp.current_price DESC;
END;
$$;


--
-- Name: get_league_history(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_league_history(p_league_id integer, p_season integer DEFAULT 2024) RETURNS TABLE(week integer, team_name character varying, rank integer, week_points numeric, total_points numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Live-computed from rosters × player_scores (starters only). There is
    -- no standings snapshot table — points are always current, and a week's
    -- history exists as soon as its rosters do.
    RETURN QUERY
    WITH weekly AS (
        SELECT r.team_id, r.week AS wk,
               COALESCE(SUM(ps.total_points), 0)::numeric AS pts
        FROM rosters r
        JOIN league_entries le ON le.team_id = r.team_id AND le.league_id = p_league_id
        LEFT JOIN player_scores ps ON ps.player_id = r.player_id
            AND ps.week = r.week AND ps.season = r.season
            AND ps.league_format = 'ppr'
        WHERE r.season = p_season
          AND r.position_slot != 'BENCH'
        GROUP BY r.team_id, r.week
    ),
    cum AS (
        SELECT w.team_id, w.wk, w.pts,
               SUM(w.pts) OVER (PARTITION BY w.team_id ORDER BY w.wk) AS tot
        FROM weekly w
    )
    SELECT c.wk,
           t.team_name,
           RANK() OVER (PARTITION BY c.wk ORDER BY c.tot DESC)::integer AS rank,
           c.pts,
           c.tot
    FROM cum c
    JOIN teams t ON c.team_id = t.team_id
    ORDER BY c.wk, 3, t.team_name;
END;
$$;


--
-- Name: get_league_standings(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_league_standings(p_league_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(rank integer, team_name character varying, user_email character varying, username character varying, week_points numeric, total_points numeric, roster_value numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Live-computed from rosters × player_scores (starters only, weeks 1..p_week).
    -- No snapshot table: mid-week the current week shows partial points as
    -- games complete; completed weeks are stable because stats are frozen.
    RETURN QUERY
    WITH weekly AS (
        SELECT r.team_id, r.week AS wk,
               COALESCE(SUM(ps.total_points), 0)::numeric AS pts
        FROM rosters r
        JOIN league_entries le ON le.team_id = r.team_id AND le.league_id = p_league_id
        LEFT JOIN player_scores ps ON ps.player_id = r.player_id
            AND ps.week = r.week AND ps.season = r.season
            AND ps.league_format = 'ppr'
        WHERE r.season = p_season
          AND r.week <= p_week
          AND r.position_slot != 'BENCH'
        GROUP BY r.team_id, r.week
    ),
    agg AS (
        SELECT w.team_id,
               COALESCE(SUM(w.pts) FILTER (WHERE w.wk = p_week), 0) AS wk_pts,
               COALESCE(SUM(w.pts), 0) AS tot_pts
        FROM weekly w
        GROUP BY w.team_id
    )
    SELECT
        RANK() OVER (ORDER BY COALESCE(a.tot_pts, 0) DESC)::integer AS rank,
        t.team_name,
        t.user_email,
        COALESCE(u.username, t.user_email)::character varying AS username,
        COALESCE(a.wk_pts, 0)::numeric AS week_points,
        COALESCE(a.tot_pts, 0)::numeric AS total_points,
        t.current_spent AS roster_value
    FROM league_entries le
    JOIN teams t ON le.team_id = t.team_id
    LEFT JOIN user_profiles u ON t.user_email = u.email
    LEFT JOIN agg a ON a.team_id = t.team_id
    WHERE le.league_id = p_league_id
    ORDER BY 1, t.team_name;
END;
$$;


--
-- Name: get_lineup_with_points(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lineup_with_points(p_team_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(player_id integer, player_name character varying, player_position character varying, player_team character varying, position_slot character varying, purchase_price numeric, current_price numeric, sell_price numeric, week_points numeric, season_avg numeric, is_starter boolean, opponent character varying, season_total numeric, fixture_week_1 character varying, fixture_week_2 character varying, fixture_week_3 character varying, prev_season_total numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.player_id,
        p.name,
        p.position,
        p.team,
        r.position_slot,
        COALESCE(t.price, pcp.current_price) as purchase_price,
        pcp.current_price as current_price,
        get_sell_price(p_team_id, p.player_id, p_season) as sell_price,
        ps.total_points as week_points,
        ROUND(AVG(ps_all.total_points) FILTER (WHERE ps_all.week < p_week), 2) as season_avg,
        (r.position_slot != 'BENCH') as is_starter,
        -- Current week opponent (add @ if away)
        CASE
            WHEN f.home_team = p.team THEN f.away_team
            WHEN f.away_team = p.team THEN '@' || f.home_team
            ELSE NULL
        END as opponent,
        -- Season total points
        ROUND(SUM(ps_all.total_points) FILTER (WHERE ps_all.week <= p_week), 2) as season_total,
        -- Next 3 fixtures (add @ if away)
        (SELECT CASE
            WHEN f1.home_team = p.team THEN f1.away_team
            WHEN f1.away_team = p.team THEN '@' || f1.home_team
            ELSE NULL
        END
        FROM nfl_fixtures f1
        WHERE f1.season = p_season AND f1.week = p_week + 1
            AND (f1.home_team = p.team OR f1.away_team = p.team)
        LIMIT 1) as fixture_week_1,
        (SELECT CASE
            WHEN f2.home_team = p.team THEN f2.away_team
            WHEN f2.away_team = p.team THEN '@' || f2.home_team
            ELSE NULL
        END
        FROM nfl_fixtures f2
        WHERE f2.season = p_season AND f2.week = p_week + 2
            AND (f2.home_team = p.team OR f2.away_team = p.team)
        LIMIT 1) as fixture_week_2,
        (SELECT CASE
            WHEN f3.home_team = p.team THEN f3.away_team
            WHEN f3.away_team = p.team THEN '@' || f3.home_team
            ELSE NULL
        END
        FROM nfl_fixtures f3
        WHERE f3.season = p_season AND f3.week = p_week + 3
            AND (f3.home_team = p.team OR f3.away_team = p.team)
        LIMIT 1) as fixture_week_3,
        -- Previous-season total for Preseason display (there are no
        -- current-season points before week 1)
        pst.total_points as prev_season_total
    FROM rosters r
    JOIN players p ON r.player_id = p.player_id
    JOIN player_current_prices pcp ON p.player_id = pcp.player_id
    LEFT JOIN transfers t ON t.team_id = p_team_id
        AND t.player_id = p.player_id
        AND t.transfer_type = 'buy'
        AND t.season = p_season
        AND t.week <= p_week
    LEFT JOIN player_scores ps ON p.player_id = ps.player_id
        AND ps.week = p_week AND ps.season = p_season AND ps.league_format = 'ppr'
    LEFT JOIN player_scores ps_all ON p.player_id = ps_all.player_id
        AND ps_all.season = p_season AND ps_all.league_format = 'ppr'
    LEFT JOIN player_season_totals pst ON pst.player_id = p.player_id
        AND pst.season = p_season - 1 AND pst.league_format = 'ppr'
    LEFT JOIN nfl_fixtures f ON f.season = p_season
        AND f.week = p_week
        AND (f.home_team = p.team OR f.away_team = p.team)
    WHERE r.team_id = p_team_id
        AND r.week = p_week
        AND r.season = p_season
    GROUP BY p.player_id, p.name, p.position, p.team, r.position_slot, r.bench_order, pcp.current_price, t.price, ps.total_points, pst.total_points, f.home_team, f.away_team
    ORDER BY
        CASE r.position_slot
            WHEN 'QB' THEN 1 WHEN 'RB1' THEN 2 WHEN 'RB2' THEN 3
            WHEN 'WR1' THEN 4 WHEN 'WR2' THEN 5 WHEN 'TE' THEN 6
            WHEN 'FLEX' THEN 7 WHEN 'DEF' THEN 8 WHEN 'K' THEN 9
            ELSE 10
        END,
        r.bench_order NULLS LAST,
        p.player_id;
END;
$$;


--
-- Name: copy_all_rosters_to_next_week(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copy_all_rosters_to_next_week(from_week integer, to_week integer, target_season integer DEFAULT 2024) RETURNS TABLE(teams_copied integer, players_copied integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  team_count INTEGER;
  player_count INTEGER;
BEGIN
  -- Replace any existing rosters for the target week, carrying bench order
  -- (auto_subbed resets to false via its default — a new week starts clean).
  DELETE FROM rosters
  WHERE week = to_week AND season = target_season;

  INSERT INTO rosters (team_id, player_id, week, season, position_slot, bench_order)
  SELECT team_id, player_id, to_week, season, position_slot, bench_order
  FROM rosters
  WHERE week = from_week AND season = target_season;

  GET DIAGNOSTICS player_count = ROW_COUNT;

  SELECT COUNT(DISTINCT team_id) INTO team_count
  FROM rosters
  WHERE week = to_week AND season = target_season;

  RETURN QUERY SELECT team_count, player_count;
END;
$$;


--
-- Name: get_team_league_positions(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_team_league_positions(p_team_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(league_name character varying, rank integer, total_teams integer, total_points numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Live-computed: rank this team within each of its leagues by cumulative
    -- starter points over weeks 1..p_week (no standings snapshot table).
    RETURN QUERY
    SELECT
        l.league_name,
        sub.rnk::integer AS rank,
        (SELECT COUNT(*) FROM league_entries le2 WHERE le2.league_id = l.league_id)::integer AS total_teams,
        sub.tot AS total_points
    FROM league_entries mine
    JOIN leagues l ON mine.league_id = l.league_id
    CROSS JOIN LATERAL (
        SELECT ranked.rnk, ranked.tot
        FROM (
            SELECT le.team_id,
                   RANK() OVER (ORDER BY COALESCE(agg.tot, 0) DESC) AS rnk,
                   COALESCE(agg.tot, 0)::numeric AS tot
            FROM league_entries le
            LEFT JOIN (
                SELECT r.team_id AS tid, COALESCE(SUM(ps.total_points), 0) AS tot
                FROM rosters r
                LEFT JOIN player_scores ps ON ps.player_id = r.player_id
                    AND ps.week = r.week AND ps.season = r.season
                    AND ps.league_format = 'ppr'
                WHERE r.season = p_season
                  AND r.week <= p_week
                  AND r.position_slot != 'BENCH'
                GROUP BY r.team_id
            ) agg ON agg.tid = le.team_id
            WHERE le.league_id = l.league_id
        ) ranked
        WHERE ranked.team_id = p_team_id
    ) sub
    WHERE mine.team_id = p_team_id
    ORDER BY l.league_name;
END;
$$;


--
-- Name: get_team_roster(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_team_roster(p_team_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(player_id integer, player_name character varying, player_position character varying, player_team character varying, position_slot character varying, current_price numeric, acquired_date date, recent_points numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.player_id,
        p.name,
        p.position,
        p.team,
        r.position_slot,
        pcp.current_price,
        r.acquired_date,
        ROUND(AVG(ps.total_points) FILTER (WHERE ps.week >= p_week - 3 AND ps.week < p_week), 2) as recent_points
    FROM rosters r
    JOIN players p ON r.player_id = p.player_id
    JOIN player_current_prices pcp ON p.player_id = pcp.player_id
    LEFT JOIN player_scores ps ON p.player_id = ps.player_id 
        AND ps.season = p_season AND ps.league_format = 'ppr'
    WHERE r.team_id = p_team_id 
        AND r.week = p_week 
        AND r.season = p_season
    GROUP BY p.player_id, p.name, p.position, p.team, r.position_slot, pcp.current_price, r.acquired_date
    ORDER BY 
        CASE r.position_slot
            WHEN 'QB' THEN 1 WHEN 'RB1' THEN 2 WHEN 'RB2' THEN 3
            WHEN 'WR1' THEN 4 WHEN 'WR2' THEN 5 WHEN 'TE' THEN 6
            WHEN 'FLEX' THEN 7 WHEN 'DEF' THEN 8 WHEN 'K' THEN 9
            ELSE 10
        END;
END;
$$;


--
-- Name: get_team_weekly_breakdown(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_team_weekly_breakdown(p_team_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(player_name character varying, player_position character varying, position_slot character varying, passing_points numeric, rushing_points numeric, receiving_points numeric, kicking_points numeric, defense_points numeric, misc_points numeric, total_points numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.name,
        p.position,
        r.position_slot,
        ps.passing_points,
        ps.rushing_points,
        ps.receiving_points,
        ps.kicking_points,
        ps.defense_points,
        ps.misc_points,
        ps.total_points
    FROM rosters r
    JOIN players p ON r.player_id = p.player_id
    JOIN player_scores ps ON p.player_id = ps.player_id
    WHERE r.team_id = p_team_id 
        AND r.week = p_week 
        AND r.season = p_season
        AND ps.week = p_week
        AND ps.season = p_season
        AND ps.league_format = 'ppr'
    ORDER BY ps.total_points DESC;
END;
$$;


--
-- Name: get_team_weekly_trends(integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_team_weekly_trends(p_team_id integer, p_current_week integer, p_season integer DEFAULT 2024, p_weeks_back integer DEFAULT 5) RETURNS TABLE(week integer, total_points numeric, starters_points numeric, bench_points numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.week,
        SUM(ps.total_points) as total_points,
        SUM(ps.total_points) FILTER (WHERE r.position_slot != 'BENCH') as starters_points,
        SUM(ps.total_points) FILTER (WHERE r.position_slot = 'BENCH') as bench_points
    FROM rosters r
    JOIN player_scores ps ON r.player_id = ps.player_id 
        AND ps.week = r.week AND ps.season = r.season AND ps.league_format = 'ppr'
    WHERE r.team_id = p_team_id 
        AND r.season = p_season
        AND r.week >= (p_current_week - p_weeks_back)
        AND r.week <= p_current_week
    GROUP BY r.week
    ORDER BY r.week;
END;
$$;


--
-- Name: get_transfer_history(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_transfer_history(p_team_id integer, p_season integer DEFAULT 2024, p_limit integer DEFAULT 20) RETURNS TABLE(transfer_date timestamp without time zone, week integer, player_name character varying, player_position character varying, transfer_type character varying, price numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.transfer_date,
        t.week,
        p.name,
        p.position,
        t.transfer_type,
        t.price
    FROM transfers t
    JOIN players p ON t.player_id = p.player_id
    WHERE t.team_id = p_team_id AND t.season = p_season
    ORDER BY t.transfer_date DESC
    LIMIT p_limit;
END;
$$;


--
-- Name: get_weekly_starter_bench_comparison(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_weekly_starter_bench_comparison(p_team_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(category text, points numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN r.position_slot = 'BENCH' THEN 'Bench'
            ELSE 'Starters'
        END::TEXT as category,
        SUM(ps.total_points) as points
    FROM rosters r
    JOIN player_scores ps ON r.player_id = ps.player_id
    WHERE r.team_id = p_team_id 
        AND r.week = p_week 
        AND r.season = p_season
        AND ps.week = p_week
        AND ps.season = p_season
        AND ps.league_format = 'ppr'
    GROUP BY 
        CASE 
            WHEN r.position_slot = 'BENCH' THEN 'Bench'
            ELSE 'Starters'
        END;
END;
$$;


--
-- Name: set_starting_lineup(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_starting_lineup(p_team_id integer, p_week integer, p_season integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    qb_count INTEGER := 0;
    rb_count INTEGER := 0;
    wr_count INTEGER := 0;
    te_count INTEGER := 0;
    flex_count INTEGER := 0;
    def_count INTEGER := 0;
    k_count INTEGER := 0;
    player_rec RECORD;
BEGIN
    -- First, set all to bench
    UPDATE rosters 
    SET position_slot = 'BENCH'
    WHERE team_id = p_team_id AND week = p_week AND season = p_season;
    
    -- Assign starters by position (ordered by price - best players first)
    FOR player_rec IN (
        SELECT r.roster_id, p.position
        FROM rosters r
        JOIN players p ON r.player_id = p.player_id
        JOIN player_current_prices pcp ON p.player_id = pcp.player_id
        WHERE r.team_id = p_team_id AND r.week = p_week AND r.season = p_season
        ORDER BY p.position, pcp.current_price DESC
    ) LOOP
        
        -- QB (1 starter)
        IF player_rec.position = 'QB' AND qb_count < 1 THEN
            UPDATE rosters SET position_slot = 'QB' WHERE roster_id = player_rec.roster_id;
            qb_count := qb_count + 1;
            
        -- RB (2 starters)
        ELSIF player_rec.position = 'RB' AND rb_count < 2 THEN
            UPDATE rosters SET position_slot = 'RB' || (rb_count + 1) WHERE roster_id = player_rec.roster_id;
            rb_count := rb_count + 1;
            
        -- WR (2 starters)
        ELSIF player_rec.position = 'WR' AND wr_count < 2 THEN
            UPDATE rosters SET position_slot = 'WR' || (wr_count + 1) WHERE roster_id = player_rec.roster_id;
            wr_count := wr_count + 1;
            
        -- TE (1 starter)
        ELSIF player_rec.position = 'TE' AND te_count < 1 THEN
            UPDATE rosters SET position_slot = 'TE' WHERE roster_id = player_rec.roster_id;
            te_count := te_count + 1;
            
        -- FLEX (1 starter - RB/WR/TE)
        ELSIF player_rec.position IN ('RB', 'WR', 'TE') AND flex_count < 1 THEN
            UPDATE rosters SET position_slot = 'FLEX' WHERE roster_id = player_rec.roster_id;
            flex_count := flex_count + 1;
            
        -- DEF (1 starter)
        ELSIF player_rec.position = 'DEF' AND def_count < 1 THEN
            UPDATE rosters SET position_slot = 'DEF' WHERE roster_id = player_rec.roster_id;
            def_count := def_count + 1;
            
        -- K (1 starter)
        ELSIF player_rec.position = 'K' AND k_count < 1 THEN
            UPDATE rosters SET position_slot = 'K' WHERE roster_id = player_rec.roster_id;
            k_count := k_count + 1;
        END IF;
        
    END LOOP;
END;
$$;


--
-- Name: validate_roster(integer[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_roster(p_player_ids integer[], p_season integer DEFAULT 2024) RETURNS TABLE(is_valid boolean, total_cost numeric, remaining_budget numeric, player_count integer, qb_count integer, rb_count integer, wr_count integer, te_count integer, k_count integer, def_count integer, validation_message text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    v_total_cost DECIMAL;
    v_player_count INTEGER;
    v_qb INTEGER;
    v_rb INTEGER;
    v_wr INTEGER;
    v_te INTEGER;
    v_k INTEGER;
    v_def INTEGER;
    v_message TEXT := 'Valid roster';
    v_valid BOOLEAN := TRUE;
BEGIN
    -- Get counts and total cost
    SELECT 
        COALESCE(SUM(pcp.current_price), 0),
        COUNT(*),
        COUNT(*) FILTER (WHERE p.position = 'QB'),
        COUNT(*) FILTER (WHERE p.position = 'RB'),
        COUNT(*) FILTER (WHERE p.position = 'WR'),
        COUNT(*) FILTER (WHERE p.position = 'TE'),
        COUNT(*) FILTER (WHERE p.position = 'K'),
        COUNT(*) FILTER (WHERE p.position = 'DEF')
    INTO v_total_cost, v_player_count, v_qb, v_rb, v_wr, v_te, v_k, v_def
    FROM unnest(p_player_ids) player_id
    JOIN players p ON p.player_id = player_id
    JOIN player_current_prices pcp ON p.player_id = pcp.player_id
    WHERE pcp.season = p_season;
    
    -- Validate constraints
    IF v_player_count != 15 THEN
        v_valid := FALSE;
        v_message := 'Must have exactly 15 players (currently ' || v_player_count || ')';
    ELSIF v_total_cost > 100.0 THEN
        v_valid := FALSE;
        v_message := 'Over budget: $' || v_total_cost || 'm (max $100m)';
    ELSIF v_qb < 1 THEN
        v_valid := FALSE;
        v_message := 'Must have at least 1 QB (currently ' || v_qb || ')';
    ELSIF v_rb < 3 THEN
        v_valid := FALSE;
        v_message := 'Must have at least 3 RBs (currently ' || v_rb || ')';
    ELSIF v_wr < 3 THEN
        v_valid := FALSE;
        v_message := 'Must have at least 3 WRs (currently ' || v_wr || ')';
    ELSIF v_te < 1 THEN
        v_valid := FALSE;
        v_message := 'Must have at least 1 TE (currently ' || v_te || ')';
    ELSIF v_k < 1 THEN
        v_valid := FALSE;
        v_message := 'Must have at least 1 K (currently ' || v_k || ')';
    ELSIF v_def < 1 THEN
        v_valid := FALSE;
        v_message := 'Must have at least 1 DEF (currently ' || v_def || ')';
    END IF;
    
    RETURN QUERY SELECT 
        v_valid,
        v_total_cost,
        100.0 - v_total_cost,
        v_player_count,
        v_qb, v_rb, v_wr, v_te, v_k, v_def,
        v_message;
END;
$_$;


--
-- Name: increment_weekly_transfers(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_weekly_transfers(p_season integer DEFAULT 2024) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_teams_updated INTEGER;
BEGIN
    -- Add 1 free transfer to all teams for the given season
    UPDATE teams
    SET free_transfers_remaining = free_transfers_remaining + 1
    WHERE season = p_season;

    GET DIAGNOSTICS v_teams_updated = ROW_COUNT;

    RETURN v_teams_updated;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: league_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_entries (
    entry_id integer NOT NULL,
    league_id integer,
    team_id integer,
    joined_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: league_entries_entry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.league_entries_entry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: league_entries_entry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.league_entries_entry_id_seq OWNED BY public.league_entries.entry_id;








--
-- Name: nfl_fixtures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nfl_fixtures (
    fixture_id integer NOT NULL,
    season integer NOT NULL,
    week integer NOT NULL,
    home_team character varying(10) NOT NULL,
    away_team character varying(10) NOT NULL
);


--
-- Name: nfl_fixtures_fixture_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nfl_fixtures_fixture_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lineup_deadlines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lineup_deadlines (
    deadline_id integer NOT NULL,
    season integer NOT NULL,
    week integer NOT NULL,
    deadline_datetime timestamp with time zone NOT NULL,
    deadline_day integer NOT NULL,
    description character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.lineup_deadlines_deadline_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.lineup_deadlines_deadline_id_seq OWNED BY public.lineup_deadlines.deadline_id;
ALTER TABLE ONLY public.lineup_deadlines ALTER COLUMN deadline_id SET DEFAULT nextval('public.lineup_deadlines_deadline_id_seq'::regclass);
ALTER TABLE ONLY public.lineup_deadlines ADD CONSTRAINT lineup_deadlines_pkey PRIMARY KEY (deadline_id);
ALTER TABLE ONLY public.lineup_deadlines ADD CONSTRAINT lineup_deadlines_season_week_key UNIQUE (season, week);


--
-- Name: nfl_fixtures_fixture_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nfl_fixtures_fixture_id_seq OWNED BY public.nfl_fixtures.fixture_id;


--
-- Name: leagues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leagues (
    league_id integer NOT NULL,
    league_name character varying(100) NOT NULL,
    season integer NOT NULL,
    created_by character varying(100),
    league_type character varying(20) DEFAULT 'season_long'::character varying,
    status character varying(20) DEFAULT 'open'::character varying,
    start_week integer DEFAULT 1,
    end_week integer DEFAULT 17,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    league_admin_email character varying(100),
    privacy_type character varying(20) DEFAULT 'public'::character varying,
    invite_code character varying(50),
    is_global boolean DEFAULT false
);


--
-- Name: leagues_league_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leagues_league_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leagues_league_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leagues_league_id_seq OWNED BY public.leagues.league_id;


--
-- Name: player_current_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_current_prices (
    player_id integer NOT NULL,
    current_price numeric(10,1) NOT NULL,
    algorithm_price numeric(10,1),
    manual_override boolean DEFAULT false,
    ownership_count integer DEFAULT 0,
    last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    season integer NOT NULL
);


--
-- Name: player_price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_price_history (
    history_id integer NOT NULL,
    player_id integer,
    price numeric(10,1) NOT NULL,
    price_change numeric(10,1) DEFAULT 0,
    change_reason character varying(50),
    week integer,
    day integer,
    season integer NOT NULL,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: player_price_history_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.player_price_history_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: player_price_history_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.player_price_history_history_id_seq OWNED BY public.player_price_history.history_id;


--
-- Name: player_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_stats (
    stat_id integer NOT NULL,
    player_id integer,
    week integer NOT NULL,
    season integer NOT NULL,
    opponent character varying(50),
    passing_yards integer DEFAULT 0,
    passing_tds integer DEFAULT 0,
    interceptions integer DEFAULT 0,
    completions integer DEFAULT 0,
    attempts integer DEFAULT 0,
    rushing_yards integer DEFAULT 0,
    rushing_tds integer DEFAULT 0,
    rushing_attempts integer DEFAULT 0,
    receptions integer DEFAULT 0,
    receiving_yards integer DEFAULT 0,
    receiving_tds integer DEFAULT 0,
    targets integer DEFAULT 0,
    fumbles_lost integer DEFAULT 0,
    two_point_conversions integer DEFAULT 0,
    game_date date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    fg_0_19 integer DEFAULT 0,
    fg_20_29 integer DEFAULT 0,
    fg_30_39 integer DEFAULT 0,
    fg_40_49 integer DEFAULT 0,
    fg_50p integer DEFAULT 0,
    xp_made integer DEFAULT 0,
    xp_missed integer DEFAULT 0,
    fga integer DEFAULT 0,
    def_td integer DEFAULT 0,
    points_allowed integer DEFAULT 0,
    team character varying(10)
);


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    player_id integer NOT NULL,
    name character varying(100) NOT NULL,
    "position" character varying(10) NOT NULL,
    team character varying(50),
    status character varying(50) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sleeper_id character varying(50),
    search_rank integer,
    age integer
);


--
-- Name: scoring; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring (
    scoring_id integer NOT NULL,
    scoring_type character varying(50) NOT NULL,
    points numeric(5,2) NOT NULL,
    league_format character varying(20) DEFAULT 'standard'::character varying,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    scoring_section integer
);


--
-- Name: player_scores; Type: VIEW; Schema: public; Owner: -
--

--
-- Archive-inclusive twins (added 2026-07-24, 2025-season testing):
-- roll-forward-season moves finished seasons from player_stats into
-- player_stats_archive, which emptied every historical read (the player
-- stats modal showed zeros for 2024). These views union live + archive
-- (live wins on collision). player_scores_all is GENERATED on prod from
-- pg_get_viewdef('player_scores') with player_stats -> player_stats_all,
-- so it can never drift from the scoring logic — regenerate it the same
-- way after any change to player_scores (see fantasy-nfl PR #11).
--

CREATE VIEW public.player_stats_all AS
 SELECT stat_id, player_id, week, season, opponent, passing_yards, passing_tds, interceptions,
        completions, attempts, rushing_yards, rushing_tds, rushing_attempts, receptions,
        receiving_yards, receiving_tds, targets, fumbles_lost, two_point_conversions,
        game_date, created_at, fg_0_19, fg_20_29, fg_30_39, fg_40_49, fg_50p,
        xp_made, xp_missed, fga, def_td, points_allowed, team
 FROM public.player_stats
 UNION ALL
 SELECT a.stat_id, a.player_id, a.week, a.season, a.opponent, a.passing_yards, a.passing_tds, a.interceptions,
        a.completions, a.attempts, a.rushing_yards, a.rushing_tds, a.rushing_attempts, a.receptions,
        a.receiving_yards, a.receiving_tds, a.targets, a.fumbles_lost, a.two_point_conversions,
        a.game_date, a.created_at, a.fg_0_19, a.fg_20_29, a.fg_30_39, a.fg_40_49, a.fg_50p,
        a.xp_made, a.xp_missed, a.fga, a.def_td, a.points_allowed, a.team
 FROM public.player_stats_archive a
 WHERE NOT EXISTS (SELECT 1 FROM public.player_stats s
   WHERE s.player_id = a.player_id AND s.week = a.week AND s.season = a.season);

-- player_scores_all: generated on prod (see comment above).

CREATE VIEW public.player_scores AS
 WITH scoring_pivot AS (
         SELECT scoring.league_format,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'passing_yard'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS passing_yard_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'passing_td'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS passing_td_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'interception'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS interception_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'rushing_yard'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS rushing_yard_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'rushing_td'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS rushing_td_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'reception'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS reception_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'receiving_yard'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS receiving_yard_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'receiving_td'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS receiving_td_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'fumble_lost'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS fumble_lost_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'two_point_conversion'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS two_point_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'fg_0_19'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS fg_0_19_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'fg_20_29'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS fg_20_29_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'fg_30_39'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS fg_30_39_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'fg_40_49'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS fg_40_49_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'fg_50p'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS fg_50p_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'kicking_xp'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS kicking_xp_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'kicking_miss'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS kicking_miss_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'defence_td'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS defence_td_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'defence_0pt'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS defence_0pt_pts,
            max(
                CASE
                    WHEN ((scoring.scoring_type)::text = 'defence_pta'::text) THEN scoring.points
                    ELSE NULL::numeric
                END) AS defence_pta_pts
           FROM public.scoring
          GROUP BY scoring.league_format
        )
 SELECT ps.player_id,
    ps.week,
    ps.season,
    sp.league_format,
    round((((((((((((((((((((ps.passing_yards)::numeric * COALESCE(sp.passing_yard_pts, (0)::numeric)) + ((ps.passing_tds)::numeric * COALESCE(sp.passing_td_pts, (0)::numeric))) + ((ps.interceptions)::numeric * COALESCE(sp.interception_pts, (0)::numeric))) + ((ps.rushing_yards)::numeric * COALESCE(sp.rushing_yard_pts, (0)::numeric))) + ((ps.rushing_tds)::numeric * COALESCE(sp.rushing_td_pts, (0)::numeric))) + ((ps.receptions)::numeric * COALESCE(sp.reception_pts, (0)::numeric))) + ((ps.receiving_yards)::numeric * COALESCE(sp.receiving_yard_pts, (0)::numeric))) + ((ps.receiving_tds)::numeric * COALESCE(sp.receiving_td_pts, (0)::numeric))) + ((ps.fumbles_lost)::numeric * COALESCE(sp.fumble_lost_pts, (0)::numeric))) + ((ps.two_point_conversions)::numeric * COALESCE(sp.two_point_pts, (0)::numeric))) + ((COALESCE(ps.fg_0_19, 0))::numeric * COALESCE(sp.fg_0_19_pts, (0)::numeric))) + ((COALESCE(ps.fg_20_29, 0))::numeric * COALESCE(sp.fg_20_29_pts, (0)::numeric))) + ((COALESCE(ps.fg_30_39, 0))::numeric * COALESCE(sp.fg_30_39_pts, (0)::numeric))) + ((COALESCE(ps.fg_40_49, 0))::numeric * COALESCE(sp.fg_40_49_pts, (0)::numeric))) + ((COALESCE(ps.fg_50p, 0))::numeric * COALESCE(sp.fg_50p_pts, (0)::numeric))) + ((COALESCE(ps.xp_made, 0))::numeric * COALESCE(sp.kicking_xp_pts, (0)::numeric))) + ((((COALESCE(ps.fga, 0) - ((((COALESCE(ps.fg_0_19, 0) + COALESCE(ps.fg_20_29, 0)) + COALESCE(ps.fg_30_39, 0)) + COALESCE(ps.fg_40_49, 0)) + COALESCE(ps.fg_50p, 0))) + COALESCE(ps.xp_missed, 0)))::numeric * COALESCE(sp.kicking_miss_pts, (0)::numeric))) +
        CASE
            WHEN ((p."position")::text = 'DEF'::text) THEN ((COALESCE(sp.defence_0pt_pts, (0)::numeric) + ((COALESCE(ps.def_td, 0))::numeric * COALESCE(sp.defence_td_pts, (0)::numeric))) + ((COALESCE(ps.points_allowed, 0))::numeric * COALESCE(sp.defence_pta_pts, (0)::numeric)))
            ELSE (0)::numeric
        END), 2) AS total_points,
    round(((((ps.passing_yards)::numeric * COALESCE(sp.passing_yard_pts, (0)::numeric)) + ((ps.passing_tds)::numeric * COALESCE(sp.passing_td_pts, (0)::numeric))) + ((ps.interceptions)::numeric * COALESCE(sp.interception_pts, (0)::numeric))), 2) AS passing_points,
    round((((ps.rushing_yards)::numeric * COALESCE(sp.rushing_yard_pts, (0)::numeric)) + ((ps.rushing_tds)::numeric * COALESCE(sp.rushing_td_pts, (0)::numeric))), 2) AS rushing_points,
    round(((((ps.receptions)::numeric * COALESCE(sp.reception_pts, (0)::numeric)) + ((ps.receiving_yards)::numeric * COALESCE(sp.receiving_yard_pts, (0)::numeric))) + ((ps.receiving_tds)::numeric * COALESCE(sp.receiving_td_pts, (0)::numeric))), 2) AS receiving_points,
    round(((((((((COALESCE(ps.fg_0_19, 0))::numeric * COALESCE(sp.fg_0_19_pts, (0)::numeric)) + ((COALESCE(ps.fg_20_29, 0))::numeric * COALESCE(sp.fg_20_29_pts, (0)::numeric))) + ((COALESCE(ps.fg_30_39, 0))::numeric * COALESCE(sp.fg_30_39_pts, (0)::numeric))) + ((COALESCE(ps.fg_40_49, 0))::numeric * COALESCE(sp.fg_40_49_pts, (0)::numeric))) + ((COALESCE(ps.fg_50p, 0))::numeric * COALESCE(sp.fg_50p_pts, (0)::numeric))) + ((COALESCE(ps.xp_made, 0))::numeric * COALESCE(sp.kicking_xp_pts, (0)::numeric))) + ((((COALESCE(ps.fga, 0) - ((((COALESCE(ps.fg_0_19, 0) + COALESCE(ps.fg_20_29, 0)) + COALESCE(ps.fg_30_39, 0)) + COALESCE(ps.fg_40_49, 0)) + COALESCE(ps.fg_50p, 0))) + COALESCE(ps.xp_missed, 0)))::numeric * COALESCE(sp.kicking_miss_pts, (0)::numeric))), 2) AS kicking_points,
    round(
        CASE
            WHEN ((p."position")::text = 'DEF'::text) THEN ((COALESCE(sp.defence_0pt_pts, (0)::numeric) + ((COALESCE(ps.def_td, 0))::numeric * COALESCE(sp.defence_td_pts, (0)::numeric))) + ((COALESCE(ps.points_allowed, 0))::numeric * COALESCE(sp.defence_pta_pts, (0)::numeric)))
            ELSE (0)::numeric
        END, 2) AS defense_points,
    round((((ps.fumbles_lost)::numeric * COALESCE(sp.fumble_lost_pts, (0)::numeric)) + ((ps.two_point_conversions)::numeric * COALESCE(sp.two_point_pts, (0)::numeric))), 2) AS misc_points
   FROM ((public.player_stats ps
     JOIN public.players p ON ((ps.player_id = p.player_id)))
     CROSS JOIN scoring_pivot sp);


--
-- Name: player_stats_stat_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.player_stats_stat_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: player_stats_stat_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.player_stats_stat_id_seq OWNED BY public.player_stats.stat_id;


--
-- Name: players_player_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.players_player_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: players_player_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.players_player_id_seq OWNED BY public.players.player_id;


--
-- Name: rosters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rosters (
    roster_id integer NOT NULL,
    player_id integer,
    week integer NOT NULL,
    season integer NOT NULL,
    acquired_date date DEFAULT CURRENT_DATE,
    position_slot character varying(10),
    team_id integer,
    auto_subbed boolean DEFAULT false,
    bench_order integer
);


--
-- Name: rosters_roster_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rosters_roster_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rosters_roster_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rosters_roster_id_seq OWNED BY public.rosters.roster_id;


--
-- Name: scoring_scoring_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scoring_scoring_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scoring_scoring_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scoring_scoring_id_seq OWNED BY public.scoring.scoring_id;


--
-- Name: scoring_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_sections (
    section_id integer NOT NULL,
    section_name character varying(50) NOT NULL,
    description text,
    display_order integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scoring_sections_section_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scoring_sections_section_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scoring_sections_section_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scoring_sections_section_id_seq OWNED BY public.scoring_sections.section_id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    team_id integer NOT NULL,
    team_name character varying(100) NOT NULL,
    user_email character varying(100),
    season integer NOT NULL,
    current_spent numeric(10,1) DEFAULT 0,
    remaining_budget numeric(10,1) DEFAULT 100.0,
    free_transfers_remaining integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: teams_team_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_team_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_team_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_team_id_seq OWNED BY public.teams.team_id;


--
-- Name: transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfers (
    transfer_id integer NOT NULL,
    team_id integer,
    player_id integer,
    transfer_type character varying(10) NOT NULL,
    price numeric(10,1) NOT NULL,
    week integer NOT NULL,
    season integer NOT NULL,
    transfer_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: transfers_transfer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transfers_transfer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transfers_transfer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transfers_transfer_id_seq OWNED BY public.transfers.transfer_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    email character varying(255) NOT NULL,
    username character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(255),
    role character varying(20) DEFAULT 'user'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_login timestamp without time zone
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    setting_id integer NOT NULL,
    setting_key character varying(50) NOT NULL,
    setting_value character varying(255) NOT NULL,
    description text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: app_settings_setting_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_settings_setting_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_settings_setting_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_settings_setting_id_seq OWNED BY public.app_settings.setting_id;


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
-- Lightweight copy of user data from the shared cogsAuth database.
-- Used for JOINs (e.g., displaying manager names). Synced lazily by the backend.
--

CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id integer NOT NULL,
    email character varying(255) NOT NULL,
    username character varying(100) NOT NULL,
    full_name character varying(255),
    CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id),
    CONSTRAINT user_profiles_email_key UNIQUE (email)
);


--
-- Name: league_entries entry_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_entries ALTER COLUMN entry_id SET DEFAULT nextval('public.league_entries_entry_id_seq'::regclass);




--
-- Name: nfl_fixtures fixture_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nfl_fixtures ALTER COLUMN fixture_id SET DEFAULT nextval('public.nfl_fixtures_fixture_id_seq'::regclass);


--
-- Name: leagues league_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues ALTER COLUMN league_id SET DEFAULT nextval('public.leagues_league_id_seq'::regclass);


--
-- Name: player_price_history history_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_price_history ALTER COLUMN history_id SET DEFAULT nextval('public.player_price_history_history_id_seq'::regclass);


--
-- Name: player_stats stat_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_stats ALTER COLUMN stat_id SET DEFAULT nextval('public.player_stats_stat_id_seq'::regclass);


--
-- Name: players player_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players ALTER COLUMN player_id SET DEFAULT nextval('public.players_player_id_seq'::regclass);


--
-- Name: rosters roster_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rosters ALTER COLUMN roster_id SET DEFAULT nextval('public.rosters_roster_id_seq'::regclass);


--
-- Name: scoring scoring_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring ALTER COLUMN scoring_id SET DEFAULT nextval('public.scoring_scoring_id_seq'::regclass);


--
-- Name: scoring_sections section_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_sections ALTER COLUMN section_id SET DEFAULT nextval('public.scoring_sections_section_id_seq'::regclass);


--
-- Name: teams team_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams ALTER COLUMN team_id SET DEFAULT nextval('public.teams_team_id_seq'::regclass);


--
-- Name: transfers transfer_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers ALTER COLUMN transfer_id SET DEFAULT nextval('public.transfers_transfer_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: league_entries league_entries_league_id_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_entries
    ADD CONSTRAINT league_entries_league_id_team_id_key UNIQUE (league_id, team_id);


--
-- Name: league_entries league_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_entries
    ADD CONSTRAINT league_entries_pkey PRIMARY KEY (entry_id);






--
-- Name: nfl_fixtures nfl_fixtures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nfl_fixtures
    ADD CONSTRAINT nfl_fixtures_pkey PRIMARY KEY (fixture_id);


--
-- Name: nfl_fixtures nfl_fixtures_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nfl_fixtures
    ADD CONSTRAINT nfl_fixtures_unique UNIQUE (season, week, home_team, away_team);


--
-- Name: leagues leagues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_pkey PRIMARY KEY (league_id);


--
-- Name: player_current_prices player_current_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_current_prices
    ADD CONSTRAINT player_current_prices_pkey PRIMARY KEY (player_id);


--
-- Name: player_price_history player_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_price_history
    ADD CONSTRAINT player_price_history_pkey PRIMARY KEY (history_id);


--
-- Name: player_stats player_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_stats
    ADD CONSTRAINT player_stats_pkey PRIMARY KEY (stat_id);


--
-- Name: player_stats player_stats_player_id_week_season_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_stats
    ADD CONSTRAINT player_stats_player_id_week_season_key UNIQUE (player_id, week, season);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (player_id);


--
-- Name: players players_sleeper_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_sleeper_id_key UNIQUE (sleeper_id);


--
-- Name: rosters rosters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rosters
    ADD CONSTRAINT rosters_pkey PRIMARY KEY (roster_id);


--
-- Name: rosters rosters_unique_player; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rosters
    ADD CONSTRAINT rosters_unique_player UNIQUE (team_id, player_id, week, season);


--
-- Name: scoring scoring_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring
    ADD CONSTRAINT scoring_pkey PRIMARY KEY (scoring_id);


--
-- Name: scoring scoring_scoring_type_league_format_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring
    ADD CONSTRAINT scoring_scoring_type_league_format_key UNIQUE (scoring_type, league_format);


--
-- Name: scoring_sections scoring_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_sections
    ADD CONSTRAINT scoring_sections_pkey PRIMARY KEY (section_id);


--
-- Name: scoring_sections scoring_sections_section_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_sections
    ADD CONSTRAINT scoring_sections_section_name_key UNIQUE (section_name);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (team_id);


--
-- Name: teams teams_team_name_user_email_season_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_team_name_user_email_season_key UNIQUE (team_name, user_email, season);


--
-- Name: transfers transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_pkey PRIMARY KEY (transfer_id);


--
-- Name: players unique_player_name_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT unique_player_name_position UNIQUE (name, "position");


--
-- Name: app_settings setting_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings ALTER COLUMN setting_id SET DEFAULT nextval('public.app_settings_setting_id_seq'::regclass);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (setting_id);


--
-- Name: app_settings app_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_setting_key_key UNIQUE (setting_key);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_league_entries_league; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_league_entries_league ON public.league_entries USING btree (league_id);


--
-- Name: idx_league_entries_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_league_entries_team ON public.league_entries USING btree (team_id);




--
-- Name: idx_fixtures_season_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_season_week ON public.nfl_fixtures USING btree (season, week);


--
-- Name: idx_fixtures_teams; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_teams ON public.nfl_fixtures USING btree (home_team, away_team);


--
-- Name: idx_player_price_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_price_history ON public.player_price_history USING btree (player_id, "timestamp" DESC);


--
-- Name: idx_player_stats_week_season; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_stats_week_season ON public.player_stats USING btree (week, season);


--
-- Name: idx_players_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_position ON public.players USING btree ("position");


--
-- Name: idx_players_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_team ON public.players USING btree (team);


--
-- Name: idx_rosters_position_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rosters_position_slot ON public.rosters USING btree (position_slot);


--
-- Name: idx_rosters_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rosters_team ON public.rosters USING btree (team_id, week, season);


--
-- Name: idx_teams_season; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_season ON public.teams USING btree (season);


--
-- Name: idx_transfers_team_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transfers_team_week ON public.transfers USING btree (team_id, week, season);


--
-- Name: scoring fk_scoring_section; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring
    ADD CONSTRAINT fk_scoring_section FOREIGN KEY (scoring_section) REFERENCES public.scoring_sections(section_id);


--
-- Name: league_entries league_entries_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_entries
    ADD CONSTRAINT league_entries_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(league_id) ON DELETE CASCADE;


--
-- Name: league_entries league_entries_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_entries
    ADD CONSTRAINT league_entries_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id) ON DELETE CASCADE;






--
-- Name: player_current_prices player_current_prices_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_current_prices
    ADD CONSTRAINT player_current_prices_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(player_id) ON DELETE CASCADE;


--
-- Name: player_price_history player_price_history_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_price_history
    ADD CONSTRAINT player_price_history_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(player_id) ON DELETE CASCADE;


--
-- Name: player_stats player_stats_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_stats
    ADD CONSTRAINT player_stats_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(player_id) ON DELETE CASCADE;


--
-- Name: rosters rosters_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rosters
    ADD CONSTRAINT rosters_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(player_id) ON DELETE CASCADE;


--
-- Name: rosters rosters_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rosters
    ADD CONSTRAINT rosters_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id) ON DELETE CASCADE;


--
-- Name: transfers transfers_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(player_id) ON DELETE CASCADE;


--
-- Name: transfers transfers_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id) ON DELETE CASCADE;


--
-- Name: player_prices_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_prices_archive (
    archive_id integer NOT NULL,
    season integer NOT NULL,
    player_id integer NOT NULL,
    final_price numeric(5,1),
    algorithm_price numeric(5,1),
    price numeric(5,1),
    price_change numeric(5,1),
    change_reason character varying(100),
    week integer,
    day integer,
    record_type character varying(20) NOT NULL,
    original_timestamp timestamp without time zone,
    archived_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.player_prices_archive_archive_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.player_prices_archive_archive_id_seq OWNED BY public.player_prices_archive.archive_id;

ALTER TABLE ONLY public.player_prices_archive ALTER COLUMN archive_id SET DEFAULT nextval('public.player_prices_archive_archive_id_seq'::regclass);

ALTER TABLE ONLY public.player_prices_archive
    ADD CONSTRAINT player_prices_archive_pkey PRIMARY KEY (archive_id);

CREATE INDEX idx_prices_archive_season ON public.player_prices_archive USING btree (season);
CREATE INDEX idx_prices_archive_player ON public.player_prices_archive USING btree (player_id, season);


--
-- Name: scoring_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_archive (
    archive_id integer NOT NULL,
    season integer NOT NULL,
    scoring_type character varying(50) NOT NULL,
    points numeric(5,2) NOT NULL,
    league_format character varying(20) DEFAULT 'standard'::character varying,
    description text,
    scoring_section integer,
    section_name character varying(50),
    archived_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.scoring_archive_archive_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.scoring_archive_archive_id_seq OWNED BY public.scoring_archive.archive_id;

ALTER TABLE ONLY public.scoring_archive ALTER COLUMN archive_id SET DEFAULT nextval('public.scoring_archive_archive_id_seq'::regclass);

ALTER TABLE ONLY public.scoring_archive
    ADD CONSTRAINT scoring_archive_pkey PRIMARY KEY (archive_id);

CREATE INDEX idx_scoring_archive_season ON public.scoring_archive USING btree (season);


--
-- Name: player_season_totals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_season_totals (
    player_id integer NOT NULL,
    season integer NOT NULL,
    league_format character varying(20) NOT NULL DEFAULT 'ppr'::character varying,
    total_points numeric(8,2) DEFAULT 0,
    passing_points numeric(8,2) DEFAULT 0,
    rushing_points numeric(8,2) DEFAULT 0,
    receiving_points numeric(8,2) DEFAULT 0,
    kicking_points numeric(8,2) DEFAULT 0,
    defense_points numeric(8,2) DEFAULT 0,
    misc_points numeric(8,2) DEFAULT 0,
    games_played integer DEFAULT 0
);

ALTER TABLE ONLY public.player_season_totals
    ADD CONSTRAINT player_season_totals_pkey PRIMARY KEY (player_id, season, league_format);

ALTER TABLE ONLY public.player_season_totals
    ADD CONSTRAINT player_season_totals_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(player_id);

CREATE INDEX idx_player_season_totals_season ON public.player_season_totals USING btree (season);


--
-- Name: player_stats_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_stats_archive (
    stat_id integer NOT NULL,
    player_id integer,
    week integer NOT NULL,
    season integer NOT NULL,
    opponent character varying(50),
    passing_yards integer DEFAULT 0,
    passing_tds integer DEFAULT 0,
    interceptions integer DEFAULT 0,
    completions integer DEFAULT 0,
    attempts integer DEFAULT 0,
    rushing_yards integer DEFAULT 0,
    rushing_tds integer DEFAULT 0,
    rushing_attempts integer DEFAULT 0,
    receptions integer DEFAULT 0,
    receiving_yards integer DEFAULT 0,
    receiving_tds integer DEFAULT 0,
    targets integer DEFAULT 0,
    fumbles_lost integer DEFAULT 0,
    two_point_conversions integer DEFAULT 0,
    game_date date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    fg_0_19 integer DEFAULT 0,
    fg_20_29 integer DEFAULT 0,
    fg_30_39 integer DEFAULT 0,
    fg_40_49 integer DEFAULT 0,
    fg_50p integer DEFAULT 0,
    xp_made integer DEFAULT 0,
    xp_missed integer DEFAULT 0,
    fga integer DEFAULT 0,
    def_td integer DEFAULT 0,
    points_allowed integer DEFAULT 0,
    team character varying(10),
    archived_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ONLY public.player_stats_archive
    ADD CONSTRAINT player_stats_archive_pkey PRIMARY KEY (player_id, week, season);

CREATE INDEX idx_stats_archive_season ON public.player_stats_archive USING btree (season);
CREATE INDEX idx_stats_archive_player ON public.player_stats_archive USING btree (player_id, season);


--
-- PostgreSQL database dump complete
--

\unrestrict DFzpX8IFhUmOdAItxDWiFe5qiDd7JhDcTKCAi29Oxd42IZf4GHtvOfVJgqy1SYG

