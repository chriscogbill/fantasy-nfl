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

    -- Calculate money from selling players
    SELECT COALESCE(SUM(pcp.current_price), 0) INTO v_money_freed
    FROM unnest(p_players_out) AS p_out(player_id)
    JOIN player_current_prices pcp ON pcp.player_id = p_out.player_id
    WHERE pcp.season = p_season;

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

CREATE FUNCTION public.get_available_players(p_season integer DEFAULT 2024, p_position character varying DEFAULT NULL::character varying, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_search_name character varying DEFAULT NULL::character varying, p_current_week character varying DEFAULT 'Preseason') RETURNS TABLE(player_id integer, player_name character varying, player_position character varying, player_team character varying, current_price numeric, avg_points numeric, season_total numeric, fixture_week_1 character varying, fixture_week_2 character varying, fixture_week_3 character varying)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_next_week_1 INTEGER;
    v_next_week_2 INTEGER;
    v_next_week_3 INTEGER;
BEGIN
    -- Calculate next 3 weeks based on current week
    IF p_current_week = 'Preseason' THEN
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
            WHEN p_current_week = 'Preseason' THEN 0.0
            ELSE ROUND(AVG(ps.total_points), 2)
        END as avg_points,
        CASE
            WHEN p_current_week = 'Preseason' THEN 0.0
            ELSE ROUND(SUM(ps.total_points), 2)
        END as season_total,
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
        LIMIT 1) as fixture_week_3
    FROM players p
    JOIN player_current_prices pcp ON p.player_id = pcp.player_id
    LEFT JOIN player_scores ps ON p.player_id = ps.player_id
        AND ps.season = p_season
        AND ps.league_format = 'ppr'
        AND (p_current_week = 'Preseason' OR ps.week <= p_current_week::integer)
    WHERE pcp.season = p_season
        AND (p_position IS NULL OR p.position = p_position)
        AND (p_min_price IS NULL OR pcp.current_price >= p_min_price)
        AND (p_max_price IS NULL OR pcp.current_price <= p_max_price)
        AND (p_search_name IS NULL OR p.name ILIKE '%' || p_search_name || '%')
    GROUP BY p.player_id, p.name, p.position, p.team, pcp.current_price
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
    RETURN QUERY
    SELECT 
        ls.week,
        t.team_name,
        ls.rank,
        ls.week_points,
        ls.total_points
    FROM league_standings ls
    JOIN teams t ON ls.team_id = t.team_id
    WHERE ls.league_id = p_league_id 
        AND ls.season = p_season
    ORDER BY ls.week, ls.rank;
END;
$$;


--
-- Name: get_league_standings(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_league_standings(p_league_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(rank integer, team_name character varying, user_email character varying, username character varying, week_points numeric, total_points numeric, roster_value numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if standings exist for this league/week/season
    IF EXISTS (
        SELECT 1 FROM league_standings
        WHERE league_id = p_league_id
        AND week = p_week
        AND season = p_season
    ) THEN
        -- Return actual standings
        RETURN QUERY
        SELECT
            ls.rank,
            t.team_name,
            t.user_email,
            COALESCE(u.username, t.user_email) as username,
            ls.week_points,
            ls.total_points,
            t.current_spent as roster_value
        FROM league_standings ls
        JOIN teams t ON ls.team_id = t.team_id
        LEFT JOIN users u ON t.user_email = u.email
        WHERE ls.league_id = p_league_id
            AND ls.week = p_week
            AND ls.season = p_season
        ORDER BY ls.rank;
    ELSE
        -- Return all teams in league with 0 points
        RETURN QUERY
        SELECT
            ROW_NUMBER() OVER (ORDER BY t.team_name)::integer as rank,
            t.team_name,
            t.user_email,
            COALESCE(u.username, t.user_email) as username,
            0::numeric as week_points,
            0::numeric as total_points,
            t.current_spent as roster_value
        FROM league_entries le
        JOIN teams t ON le.team_id = t.team_id
        LEFT JOIN users u ON t.user_email = u.email
        WHERE le.league_id = p_league_id
            AND t.season = p_season
        ORDER BY t.team_name;
    END IF;
END;
$$;


--
-- Name: get_lineup_with_points(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lineup_with_points(p_team_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(player_id integer, player_name character varying, player_position character varying, player_team character varying, position_slot character varying, purchase_price numeric, current_price numeric, sell_price numeric, week_points numeric, season_avg numeric, is_starter boolean, opponent character varying, season_total numeric, fixture_week_1 character varying, fixture_week_2 character varying, fixture_week_3 character varying)
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
        pcp.current_price as sell_price,
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
        LIMIT 1) as fixture_week_3
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
    LEFT JOIN nfl_fixtures f ON f.season = p_season
        AND f.week = p_week
        AND (f.home_team = p.team OR f.away_team = p.team)
    WHERE r.team_id = p_team_id
        AND r.week = p_week
        AND r.season = p_season
    GROUP BY p.player_id, p.name, p.position, p.team, r.position_slot, pcp.current_price, t.price, ps.total_points, f.home_team, f.away_team
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
-- Name: get_team_league_positions(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_team_league_positions(p_team_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(league_name character varying, rank integer, total_teams integer, total_points numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.league_name,
        ls.rank,
        (SELECT COUNT(*) FROM league_entries WHERE league_id = l.league_id)::INTEGER as total_teams,
        ls.total_points
    FROM league_standings ls
    JOIN leagues l ON ls.league_id = l.league_id
    WHERE ls.team_id = p_team_id 
        AND ls.week = p_week 
        AND ls.season = p_season
    ORDER BY ls.rank;
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
-- Name: league_standings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_standings (
    standing_id integer NOT NULL,
    league_id integer,
    team_id integer,
    week integer,
    season integer NOT NULL,
    week_points numeric(10,2) DEFAULT 0,
    total_points numeric(10,2) DEFAULT 0,
    rank integer
);


--
-- Name: league_standings_standing_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.league_standings_standing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: league_standings_standing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.league_standings_standing_id_seq OWNED BY public.league_standings.standing_id;


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
    end_week integer DEFAULT 18,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    league_admin_email character varying(100),
    privacy_type character varying(20) DEFAULT 'public'::character varying,
    invite_code character varying(50)
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
    points_allowed integer DEFAULT 0
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
    sleeper_id character varying(50)
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
-- Name: roster_constraints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_constraints (
    constraint_id integer NOT NULL,
    season integer NOT NULL,
    total_budget numeric(10,1) DEFAULT 100.0 NOT NULL,
    total_roster_spots integer DEFAULT 15 NOT NULL,
    qb_spots integer DEFAULT 2 NOT NULL,
    rb_spots integer DEFAULT 4 NOT NULL,
    wr_spots integer DEFAULT 4 NOT NULL,
    te_spots integer DEFAULT 2 NOT NULL,
    def_spots integer DEFAULT 2 NOT NULL,
    k_spots integer DEFAULT 1 NOT NULL,
    starting_qb integer DEFAULT 1 NOT NULL,
    starting_rb integer DEFAULT 2 NOT NULL,
    starting_wr integer DEFAULT 2 NOT NULL,
    starting_te integer DEFAULT 1 NOT NULL,
    starting_flex integer DEFAULT 1 NOT NULL,
    starting_def integer DEFAULT 1 NOT NULL,
    starting_k integer DEFAULT 1 NOT NULL
);


--
-- Name: roster_constraints_constraint_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roster_constraints_constraint_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roster_constraints_constraint_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roster_constraints_constraint_id_seq OWNED BY public.roster_constraints.constraint_id;


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
    team_id integer
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
    setting_key character varying(100) NOT NULL,
    setting_value character varying(255),
    description text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: league_entries entry_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_entries ALTER COLUMN entry_id SET DEFAULT nextval('public.league_entries_entry_id_seq'::regclass);


--
-- Name: league_standings standing_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_standings ALTER COLUMN standing_id SET DEFAULT nextval('public.league_standings_standing_id_seq'::regclass);


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
-- Name: roster_constraints constraint_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_constraints ALTER COLUMN constraint_id SET DEFAULT nextval('public.roster_constraints_constraint_id_seq'::regclass);


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
-- Name: league_standings league_standings_league_id_team_id_week_season_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_standings
    ADD CONSTRAINT league_standings_league_id_team_id_week_season_key UNIQUE (league_id, team_id, week, season);


--
-- Name: league_standings league_standings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_standings
    ADD CONSTRAINT league_standings_pkey PRIMARY KEY (standing_id);


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
-- Name: roster_constraints roster_constraints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_constraints
    ADD CONSTRAINT roster_constraints_pkey PRIMARY KEY (constraint_id);


--
-- Name: roster_constraints roster_constraints_season_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_constraints
    ADD CONSTRAINT roster_constraints_season_key UNIQUE (season);


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
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (setting_key);


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
-- Name: idx_league_standings; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_league_standings ON public.league_standings USING btree (league_id, season, total_points DESC);


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
-- Name: league_standings league_standings_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_standings
    ADD CONSTRAINT league_standings_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(league_id) ON DELETE CASCADE;


--
-- Name: league_standings league_standings_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_standings
    ADD CONSTRAINT league_standings_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id) ON DELETE CASCADE;


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
-- PostgreSQL database dump complete
--

\unrestrict DFzpX8IFhUmOdAItxDWiFe5qiDd7JhDcTKCAi29Oxd42IZf4GHtvOfVJgqy1SYG

