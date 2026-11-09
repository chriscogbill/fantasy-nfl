-- 2026-11: transfer hits are deducted from scores.
-- One row per executed transfer batch that went over the free allowance
-- (points = 6 per extra transfer). Standings, history and team league
-- positions subtract them. Function signatures and return types are
-- unchanged, so CREATE OR REPLACE is enough.
--
-- Apply to prod BEFORE deploying the API change that writes transfer_hits.
-- Before applying, diff these three functions against prod
-- (pg_get_functiondef) — schema.sql has lagged prod before.

BEGIN;

CREATE TABLE IF NOT EXISTS public.transfer_hits (
    hit_id SERIAL PRIMARY KEY,
    team_id integer NOT NULL REFERENCES public.teams(team_id) ON DELETE CASCADE,
    week integer NOT NULL,
    season integer NOT NULL,
    transfers integer NOT NULL,
    points integer NOT NULL CHECK (points > 0),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transfer_hits_team_week ON public.transfer_hits (team_id, season, week);

CREATE OR REPLACE FUNCTION public.get_league_standings(p_league_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(rank integer, team_name character varying, user_email character varying, username character varying, week_points numeric, total_points numeric, roster_value numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Live-computed from rosters × player_scores (starters only, weeks 1..p_week),
    -- minus transfer hits (−6 per extra transfer, recorded in transfer_hits).
    -- No snapshot table: mid-week the current week shows partial points as
    -- games complete; completed weeks are stable because stats are frozen.
    RETURN QUERY
    WITH gross AS (
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
    hits AS (
        SELECT th.team_id, th.week AS wk, SUM(th.points)::numeric AS pts
        FROM transfer_hits th
        WHERE th.season = p_season
          AND th.week <= p_week
        GROUP BY th.team_id, th.week
    ),
    weekly AS (
        SELECT COALESCE(g.team_id, h.team_id) AS team_id, COALESCE(g.wk, h.wk) AS wk,
               COALESCE(g.pts, 0) - COALESCE(h.pts, 0) AS pts
        FROM gross g
        FULL OUTER JOIN hits h ON h.team_id = g.team_id AND h.wk = g.wk
        -- hits only count for teams in this league
        WHERE COALESCE(g.team_id, h.team_id) IN (SELECT team_id FROM league_entries WHERE league_id = p_league_id)
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

CREATE OR REPLACE FUNCTION public.get_league_history(p_league_id integer, p_season integer DEFAULT 2024) RETURNS TABLE(week integer, team_name character varying, rank integer, week_points numeric, total_points numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Live-computed from rosters × player_scores (starters only), minus
    -- transfer hits. There is no standings snapshot table — points are always
    -- current, and a week's history exists as soon as its rosters do.
    RETURN QUERY
    WITH gross AS (
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
    hits AS (
        SELECT th.team_id, th.week AS wk, SUM(th.points)::numeric AS pts
        FROM transfer_hits th
        WHERE th.season = p_season
        GROUP BY th.team_id, th.week
    ),
    weekly AS (
        SELECT g.team_id, g.wk, g.pts - COALESCE(h.pts, 0) AS pts
        FROM gross g
        LEFT JOIN hits h ON h.team_id = g.team_id AND h.wk = g.wk
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

CREATE OR REPLACE FUNCTION public.get_team_league_positions(p_team_id integer, p_week integer, p_season integer DEFAULT 2024) RETURNS TABLE(league_name character varying, rank integer, total_teams integer, total_points numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Live-computed: rank this team within each of its leagues by cumulative
    -- starter points over weeks 1..p_week, minus transfer hits (no standings
    -- snapshot table).
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
                SELECT pts.tid, SUM(pts.p) AS tot
                FROM (
                    SELECT r.team_id AS tid, COALESCE(ps.total_points, 0) AS p
                    FROM rosters r
                    LEFT JOIN player_scores ps ON ps.player_id = r.player_id
                        AND ps.week = r.week AND ps.season = r.season
                        AND ps.league_format = 'ppr'
                    WHERE r.season = p_season
                      AND r.week <= p_week
                      AND r.position_slot != 'BENCH'
                    UNION ALL
                    -- transfer hits (−6 per extra transfer)
                    SELECT th.team_id, -th.points
                    FROM transfer_hits th
                    WHERE th.season = p_season AND th.week <= p_week
                ) pts
                GROUP BY pts.tid
            ) agg ON agg.tid = le.team_id
            WHERE le.league_id = l.league_id
        ) ranked
        WHERE ranked.team_id = p_team_id
    ) sub
    WHERE mine.team_id = p_team_id
    ORDER BY l.league_name;
END;
$$;

COMMIT;
