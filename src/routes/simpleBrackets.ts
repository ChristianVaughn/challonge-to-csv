import { Elysia } from "elysia";
import { stringify } from "csv-stringify/sync";

// Define our data types based on Challonge API structure
interface ChallongeTournament {
  id: string;
  name: string;
  url: string;
  description?: string;
  tournament_type: string;
  group_stages_enabled: boolean;
  started_at: string;
  completed_at: string;
  state: string;
  game_name?: string;
  group_stages?: {
    id: string;
    identifier: string;
    state: string;
  }[];
  participants: ChallongeParticipant[];
  matches: ChallongeMatch[];

}

interface ChallongeMatch {
  match: ChallongeMatchData;
}

interface ChallongeMatchData {
  id: string;
  tournament_id: string;
  identifier: string;
  round: number;
  state: string;
  player1_id: string;
  player2_id: string;
  player1_score?: number;
  player2_score?: number;
  winner_id?: string;
  loser_id?: string;
  group_id?: string;
  suggested_play_order?: number;
  started_at?: string;
  created_at: string;
  updated_at: string;
  scores_csv?: string; // Format: "number-number", ex: "5-2"
}

interface ChallongeParticipant {
  participant: ChallongeParticipantData;
}

interface ChallongeParticipantData {
  id: string;
  tournament_id: string;
  name: string;
  final_rank?: number;
  seed?: number;
  group_player_ids?: string[];  // Array of player IDs used in group stages
}

interface MatchWithPlayers {
  matchId: string;
  round: number;
  player1: string;
  player2: string;
  player1Score: number | null;
  player2Score: number | null;
  scoreDifference: number | null;  // Added for close loss calculation
  winner: string | null;
  state: string;
  groupStage: string | null;      // Group stage identifier
  stageName: string | null;       // Stage name (e.g., "Group Stage", "Final Stage")
  playOrder: number | null;
  createdAt: string;
  updatedAt: string;
  player1Id: string | null;
  player2Id: string | null;
}

// Get the appropriate API headers
function getApiHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": apiKey,
    "Authorization-Type": "v1"
  };
}

// Helper function to fetch data from Challonge API
async function fetchFromChallonge(endpoint: string, apiKey: string) {
  try {
    const response = await fetch(`https://api.challonge.com/v1/${endpoint}`, {
      headers: getApiHeaders(apiKey)
    });

    if (!response.ok) {
      let errorText;
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = "Could not parse error response";
      }

      // If we get a 403 on participants endpoint, let's create a dummy response
      if (endpoint.includes("/participants.json") && response.status === 403) {
        return { participants: [] };
      }

      throw new Error(`Challonge API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    // Special handling for participants endpoint - return empty data rather than failing
    if (endpoint.includes("/participants.json")) {
      return { participants: [] };
    }

    throw error;
  }
}

// Extract scores from scores_csv field
function extractScoresFromCsv(match: ChallongeMatchData) {
  let player1Score = null;
  let player2Score = null;

  if (match.scores_csv) {
    // Parse scores in format "5-2"
    const scoresParts = match.scores_csv.split('-');
    if (scoresParts.length >= 2) {
      const score1 = parseInt(scoresParts[0], 10);
      const score2 = parseInt(scoresParts[1], 10);

      if (!isNaN(score1) && !isNaN(score2)) {
        // In scores_csv, the first number is typically the winner's score
        // We need to determine which player (1 or 2) this corresponds to
        if (match.winner_id === match.player1_id) {
          // If player1 won, they should have score1 (the higher score)
          player1Score = score1;
          player2Score = score2;
        } else if (match.winner_id === match.player2_id) {
          // If player2 won, they should have score1 (the higher score)
          player2Score = score1;
          player1Score = score2;
        } else {
          // If no winner or tie, assign the scores as they appear
          player1Score = score1;
          player2Score = score2;
        }
      }
    }
  } else {
    // Fall back to player1_score and player2_score if available
    player1Score = match.player1_score !== undefined ? match.player1_score : null;
    player2Score = match.player2_score !== undefined ? match.player2_score : null;
  }

  return { player1Score, player2Score };
}

// Processing tournament data
async function processTournamentData(tournamentId: string, apiKey: string) {
  try {
    // We can get all data in a single request - the response includes participants and matches
    const data = await fetchFromChallonge(`tournaments/${tournamentId}.json?include_participants=1&include_matches=1&api_key=${apiKey}`, apiKey);

    // Extract tournament data
    const tournament: ChallongeTournament = data.tournament;

    // Extract participants from the nested data
    let participants: ChallongeParticipantData[] = [];
    if (tournament.participants) {
      participants = tournament.participants.map(p => p.participant);
    }

    // Extract matches from the nested data
    let matches: ChallongeMatchData[] = [];
    if (tournament.matches) {
      matches = tournament.matches.map(m => m.match);
    }

    // Create participant lookup by ID
    const participantMap = new Map<string, string>();

    // Also create a secondary map for group player IDs
    const groupPlayerMap = new Map<string, string>();

    participants.forEach(p => {
      // Standard participant ID mapping
      participantMap.set(p.id, p.name);

      // Map any group player IDs to participant names if available
      if (p.group_player_ids && Array.isArray(p.group_player_ids)) {
        p.group_player_ids.forEach(groupId => {
          groupPlayerMap.set(String(groupId), p.name);
        });
      }
    });

    // Create a general player ID mapping for all unique player IDs in all matches
    // This will be needed for final stages
    const allPlayerIds = new Set<string>();
    matches.forEach(m => {
      if (m.player1_id) allPlayerIds.add(String(m.player1_id));
      if (m.player2_id) allPlayerIds.add(String(m.player2_id));
    });

    // If we have exactly one player ID per participant, create 1:1 mappings
    if (allPlayerIds.size === participants.length) {
      const playerIdArray = Array.from(allPlayerIds);

      participants.forEach((p, index) => {
        if (index < playerIdArray.length) {
          const playerId = playerIdArray[index];
          if (!groupPlayerMap.has(playerId)) {
            groupPlayerMap.set(playerId, p.name);
          }
        }
      });
    }

    // Process matches with player names and essential data
    const processedMatches: MatchWithPlayers[] = matches.map(match => {
      // Add direct variable that tells us if this is a final stage match in a tournament with groups
      const isFinalsMatch = tournament.group_stages_enabled && !match.group_id;

      // Player IDs as strings for lookup
      const player1Id = match.player1_id ? String(match.player1_id) : null;
      const player2Id = match.player2_id ? String(match.player2_id) : null;
      const winnerId = match.winner_id ? String(match.winner_id) : null;

      // Get player names based on match type
      let player1Name, player2Name, winnerName;

      if (isFinalsMatch) {
        // For final stages, use the original direct approach that worked
        player1Name = match.player1_id ? participantMap.get(match.player1_id) || "Player 1" : "BYE";
        player2Name = match.player2_id ? participantMap.get(match.player2_id) || "Player 2" : "BYE";
        winnerName = match.winner_id ? participantMap.get(match.winner_id) || "Winner" : null;
      } else {
        // For group stages and regular tournaments, use the maps
        player1Name = player1Id ?
          (participantMap.get(player1Id) || groupPlayerMap.get(player1Id) || "Player 1")
          : "BYE";

        player2Name = player2Id ?
          (participantMap.get(player2Id) || groupPlayerMap.get(player2Id) || "Player 2")
          : "BYE";

        winnerName = winnerId ?
          (participantMap.get(winnerId) || groupPlayerMap.get(winnerId) || "Winner")
          : null;
      }

      // Extract scores
      const { player1Score, player2Score } = extractScoresFromCsv(match);

      // Calculate score difference for close loss detection
      let scoreDifference = null;
      if (player1Score !== null && player2Score !== null) {
        scoreDifference = Math.abs(player1Score - player2Score);
      }

      // Determine group stage and tournament stage
      let groupStage = null;
      let stageName = "Main Bracket";

      if (tournament.group_stages_enabled) {
        if (match.group_id) {
          // This is a group stage match
          const group = tournament.group_stages?.find(g => g.id === match.group_id);
          groupStage = group ? group.identifier : `Group ${match.group_id}`;
          stageName = "Group Stage";
        } else {
          // If tournament has group stages but this match has no group_id, it's a finals match
          stageName = "Final Stage";
          groupStage = null;
        }
      } else {
        // Regular tournament without group stages
        stageName = "Main Bracket";
        groupStage = null;
      }

      return {
        matchId: match.id,
        round: match.round,
        player1: player1Name,
        player2: player2Name,
        player1Score: player1Score,
        player2Score: player2Score,
        scoreDifference: scoreDifference,
        winner: winnerName,
        state: match.state,
        groupStage: groupStage,
        stageName: stageName,
        playOrder: match.suggested_play_order || null,
        createdAt: match.created_at,
        updatedAt: match.updated_at,
        player1Id: match.player1_id,
        player2Id: match.player2_id
      };
    });

    return {
      tournament,
      processedMatches
    };
  } catch (error) {
    throw error;
  }
}

// Process community tournament data
async function processCommunityTournamentData(tournamentId: string, communityId: string, apiKey: string) {
  try {
    // Format the tournament ID as subdomain-tournament_url format
    const formattedId = `${communityId}-${tournamentId}`;

    // Use the same endpoint as regular tournaments, but with the formatted subdomain-tournament_url
    const data = await fetchFromChallonge(
      `tournaments/${formattedId}.json?include_participants=1&include_matches=1&api_key=${apiKey}`,
      apiKey
    );

    // Extract tournament data
    const tournament: ChallongeTournament = data.tournament;

    // Extract participants from the nested data
    let participants: ChallongeParticipantData[] = [];
    if (tournament.participants) {
      participants = tournament.participants.map(p => p.participant);
    }

    // Extract matches from the nested data
    let matches: ChallongeMatchData[] = [];
    if (tournament.matches) {
      matches = tournament.matches.map(m => m.match);
    }

    // Create participant lookup
    const participantMap = new Map<string, string>();

    // Also create a secondary map for group player IDs
    const groupPlayerMap = new Map<string, string>();

    participants.forEach(p => {
      // Standard participant ID mapping
      participantMap.set(p.id, p.name);

      // Map any group player IDs to participant names if available
      if (p.group_player_ids && Array.isArray(p.group_player_ids)) {
        p.group_player_ids.forEach(groupId => {
          groupPlayerMap.set(String(groupId), p.name);
        });
      }
    });

    // Process matches with player names and essential data
    const processedMatches: MatchWithPlayers[] = matches.map(match => {
      // Add direct variable that tells us if this is a final stage match in a tournament with groups
      const isFinalsMatch = tournament.group_stages_enabled && !match.group_id;

      // Player IDs as strings for lookup
      const player1Id = match.player1_id ? String(match.player1_id) : null;
      const player2Id = match.player2_id ? String(match.player2_id) : null;
      const winnerId = match.winner_id ? String(match.winner_id) : null;

      // Get player names based on match type
      let player1Name, player2Name, winnerName;

      if (isFinalsMatch) {
        // For final stages, use the original direct approach that worked
        player1Name = match.player1_id ? participantMap.get(match.player1_id) || "Player 1" : "BYE";
        player2Name = match.player2_id ? participantMap.get(match.player2_id) || "Player 2" : "BYE";
        winnerName = match.winner_id ? participantMap.get(match.winner_id) || "Winner" : null;
      } else {
        // For group stages and regular tournaments, use the maps
        player1Name = player1Id ?
          (participantMap.get(player1Id) || groupPlayerMap.get(player1Id) || "Player 1")
          : "BYE";

        player2Name = player2Id ?
          (participantMap.get(player2Id) || groupPlayerMap.get(player2Id) || "Player 2")
          : "BYE";

        winnerName = winnerId ?
          (participantMap.get(winnerId) || groupPlayerMap.get(winnerId) || "Winner")
          : null;
      }

      // Extract scores
      const { player1Score, player2Score } = extractScoresFromCsv(match);

      // Calculate score difference for close loss detection
      let scoreDifference = null;
      if (player1Score !== null && player2Score !== null) {
        scoreDifference = Math.abs(player1Score - player2Score);
      }

      // Determine group stage and tournament stage
      let groupStage = null;
      let stageName = "Main Bracket";

      if (tournament.group_stages_enabled) {
        if (match.group_id) {
          // This is a group stage match
          const group = tournament.group_stages?.find(g => g.id === match.group_id);
          groupStage = group ? group.identifier : `Group ${match.group_id}`;
          stageName = "Group Stage";
        } else {
          // If tournament has group stages but this match has no group_id, it's a finals match
          stageName = "Final Stage";
          groupStage = null;
        }
      } else {
        // Regular tournament without group stages
        stageName = "Main Bracket";
        groupStage = null;
      }

      return {
        matchId: match.id,
        round: match.round,
        player1: player1Name,
        player2: player2Name,
        player1Score: player1Score,
        player2Score: player2Score,
        scoreDifference: scoreDifference,
        winner: winnerName,
        state: match.state,
        groupStage: groupStage,
        stageName: stageName,
        playOrder: match.suggested_play_order || null,
        createdAt: match.created_at,
        updatedAt: match.updated_at,
        player1Id: match.player1_id,
        player2Id: match.player2_id
      };
    });

    return {
      tournament,
      processedMatches
    };
  } catch (error) {
    throw error;
  }
}

// Convert matches to CSV with tournament and match data
function convertToCSV(matches: MatchWithPlayers[], tournamentName: string = "Tournament") {
  // Add header row and data
  const records = [
    [
      'Match ID', 'Round', 'Player 1', 'Player 2',
      'Player 1 Score', 'Player 2 Score', 'Score Difference', 'Winner', 'State',
      'Stage Name', 'Play Order', 'Updated At'
    ],
    ...matches.map(match => [
      match.matchId || 'unknown',
      match.round || 0,
      match.player1 || 'Unknown Player 1',
      match.player2 || 'Unknown Player 2',
      match.player1Score !== null ? match.player1Score : '',
      match.player2Score !== null ? match.player2Score : '',
      match.scoreDifference !== null ? match.scoreDifference : '',
      match.winner || '',
      match.state || 'unknown',
      match.stageName || 'Main Bracket',
      match.playOrder !== null ? match.playOrder : '',
      match.updatedAt || ''
    ])
  ];

  // Generate CSV content
  const csvContent = stringify(records);
  return csvContent;
}

// Player stats interface for points calculation
interface PlayerStats {
  event_id: string;
  player: string;
  swiss_wins: number;
  swiss_losses: number;
  swiss_close_losses: number;
  byes: number;
  streak_bonus: number;
  finals_place: number | null;
  finals_points: number;
  event_total: number;
}

// Calculate points for each player based on tournament matches
function calculatePlayerPoints(tournament: ChallongeTournament, matches: MatchWithPlayers[]): PlayerStats[] {
  // ---- initialise -------------------------------
  const playerStatsMap = new Map<string, PlayerStats>();

  // Split stages
  const groupMatches = matches.filter(m => m.stageName === "Group Stage");
  const finalMatches = matches.filter(m => m.stageName === "Final Stage" || m.stageName === "Main Bracket");

  // Collect unique player names (excluding BYE placeholders)
  const players = new Set<string>();
  matches.forEach(m => {
    if (m.player1 && m.player1 !== "BYE") players.add(m.player1);
    if (m.player2 && m.player2 !== "BYE") players.add(m.player2);
  });

  // Seed stats
  players.forEach(p => {
    playerStatsMap.set(p, {
      event_id: String(tournament.id),
      player: p,
      swiss_wins: 0,
      swiss_losses: 0,
      swiss_close_losses: 0,
      byes: 0,
      streak_bonus: 0,
      finals_place: null,
      finals_points: 0,
      event_total: 0
    });
  });

  // ------------- Swiss / Group stage ----------------------------------
  if (groupMatches.length) {
    // groupRounds for bye estimation
    const groupRounds = new Set(groupMatches.map(m => m.round)).size;

    // Track *current* streak length (we don't need historical max,
    // only final streak when Swiss ends as per original logic)
    const winStreaks = new Map<string, number>();

    // Process rounds in order so streaks make sense
    const rounds = new Map<number, MatchWithPlayers[]>();
    groupMatches.forEach(m => {
      if (!rounds.has(m.round)) rounds.set(m.round, []);
      rounds.get(m.round)!.push(m);
    });

    [...rounds.keys()].sort((a, b) => a - b).forEach(rnd => {
      (rounds.get(rnd) || []).forEach(match => {
        if (match.state !== "complete") return;
        const { player1: p1, player2: p2 } = match;
        if (!p1 || !p2 || p1 === "BYE" || p2 === "BYE") return; // Shouldn’t happen in Challonge Swiss

        const isForfeit = match.forfeited === true;
        const hasScore = match.scores_csv && match.scores_csv.trim().length > 0;

        // Bye handling (not represented by Challonge, but stay cautious)
        if (!isForfeit && !hasScore) {
          // treat as bye => award nothing, don’t affect streaks
          return;
        }

        // Identify winner/loser
        const winner = match.winner;
        const loser = winner === p1 ? p2 : p1;

        if (isForfeit) {
          // ---- WINNER: counts as normal win but NO streak bonus ----
          if (winner) {
            const ws = playerStatsMap.get(winner)!;
            ws.swiss_wins += 1;
            // Break streak: no increment
            winStreaks.set(winner, winStreaks.get(winner) || 0);
          }

          // ---- LOSER: 0 points, break any streak ---------------
          if (loser) {
            winStreaks.set(loser, 0);
          }
          // Do NOT increment swiss_losses / close losses
          return; // early exit, we’re done with this match
        }

        // -------- Regular played match ----------------------
        if (winner) {
          const ws = playerStatsMap.get(winner)!;
          ws.swiss_wins += 1;

          const newStreak = (winStreaks.get(winner) || 0) + 1;
          winStreaks.set(winner, newStreak);
        }

        if (loser) {
          const ls = playerStatsMap.get(loser)!;
          if (match.scoreDifference !== null && match.scoreDifference <= 2) {
            ls.swiss_close_losses += 1;
          } else {
            ls.swiss_losses += 1;
          }
          winStreaks.set(loser, 0);
        }
      });
    });

    // Convert streak lengths to bonus (0.5 per consecutive win past the first)
    players.forEach(p => {
      const streak = winStreaks.get(p) || 0;
      const stats = playerStatsMap.get(p)!;
      stats.streak_bonus = Math.max(0, streak - 1) * 0.5;
    });

    // ---------- Byes ------------
    players.forEach(p => {
      const stats = playerStatsMap.get(p)!;
      const playedMatches = groupMatches.filter(m =>
        (m.player1 === p || m.player2 === p) && m.state === "complete"
      ).length;
      stats.byes = Math.max(0, groupRounds - playedMatches);
    });
  }

  // ------------- Finals / Knock‑out stage (unchanged) ------------------
  finalMatches.forEach(match => {
    if (match.state !== "complete") return;
    const winner = match.winner;
    const loser = match.winner === match.player1 ? match.player2 : match.player1;

    // Finals placement points logic – retained from original:
    if (winner) {
      const wStats = playerStatsMap.get(winner)!;
      if (match.identifier === "G") {
        wStats.finals_place = 1;
        wStats.finals_points = 6;
      } else if (match.identifier === "3P") {
        wStats.finals_place = 3;
        wStats.finals_points = 3;
      }
    }
    if (loser) {
      const lStats = playerStatsMap.get(loser)!;
      if (match.identifier === "G") {
        lStats.finals_place = 2;
        lStats.finals_points = 4;
      } else if (match.identifier === "3P") {
        lStats.finals_place = 4;
        lStats.finals_points = 2;
      }
    }
  });

  // ------------- Compute totals -----------------------------
  playerStatsMap.forEach(stats => {
    const swissPoints = stats.swiss_wins * 3;
    const closeLossPoints = stats.swiss_close_losses * 1.5;
    const lossPoints = stats.swiss_losses * 0.5;
    const streakPoints = stats.streak_bonus;
    const byePoints = stats.byes * 3;
    const finalsPoints = stats.finals_points;

    stats.event_total = swissPoints + closeLossPoints + lossPoints + streakPoints + byePoints + finalsPoints;
  });

  // ---- Ignore players who never actually played ----------
  players.forEach(p => {
    const played = matches.some(m =>
      (m.player1 === p || m.player2 === p) &&
      m.state === "complete" &&
      m.forfeited !== true &&
      m.scores_csv && m.scores_csv.trim().length > 0
    );
    if (!played) {
      const stats = playerStatsMap.get(p)!;
      stats.event_total = 0;
      stats.swiss_wins = stats.swiss_losses = stats.swiss_close_losses = 0;
      stats.streak_bonus = 0;
      stats.finals_points = 0;
      stats.byes = 0;
    }
  });

  return Array.from(playerStatsMap.values()).sort((a, b) => b.event_total - a.event_total);
}


// Convert player stats to CSV
function convertPlayerStatsToCSV(playerStats: PlayerStats[]): string {
  // Add header row and data
  const records = [
    [
      'Event ID', 'Player', 'Swiss Wins', 'Swiss Losses', 'Swiss Close Losses',
      'Byes', 'Streak Bonus', 'Finals Place', 'Finals Points', 'Event Total'
    ],
    ...playerStats.map(stats => [
      stats.event_id || 'unknown',
      stats.player || 'Unknown Player',
      stats.swiss_wins,
      stats.swiss_losses,
      stats.swiss_close_losses,
      stats.byes,
      stats.streak_bonus,
      stats.finals_place !== null ? stats.finals_place : '',
      stats.finals_points,
      stats.event_total
    ])
  ];

  // Generate CSV content
  const csvContent = stringify(records);
  return csvContent;
}

/**
 * Simplified endpoints for fetching tournament data using API key and exporting to CSV
 */
export const SimpleBracketRoutes = new Elysia({ prefix: "/simple-brackets" })
  // Tournament ID only endpoint
  .get("/:tournamentId", async ({ params, query, set }) => {
    try {
      const { tournamentId } = params;
      const apiKey = query.apiKey as string;

      if (!apiKey) {
        set.status = 401;
        return { error: "API key is required" };
      }

      const { tournament, processedMatches } = await processTournamentData(tournamentId, apiKey);

      // Get tournament name if available, otherwise use the ID
      const tournamentName = tournament?.name || `Tournament_${tournamentId}`;

      // Generate CSV
      const csvContent = convertToCSV(processedMatches, tournamentName);

      // Set headers for CSV download with a safe filename
      const safeFilename = tournamentName.replace(/[^a-z0-9]/gi, '_');
      set.headers = {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${safeFilename}.csv"`
      };
      // Add CORS headers explicitly to this response
      set.headers["Access-Control-Allow-Origin"] = "*";
      set.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
      set.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Authorization-Type";
      set.headers["Access-Control-Expose-Headers"] = "Content-Disposition";

      return csvContent;
    } catch (error) {
      set.status = 500;
      return { error: "Failed to process tournament data", details: error instanceof Error ? error.message : String(error) };
    }
  })

  // Tournament ID with community ID endpoint (uses subdomain format)
  // Example: /simple-brackets/mytourney/community/test
  // Will access: test.challonge.com/mytourney as 'test-mytourney'
  .get("/:tournamentId/community/:communityId", async ({ params, query, set }) => {
    try {
      const { tournamentId, communityId } = params;
      const apiKey = query.apiKey as string;

      if (!apiKey) {
        set.status = 401;
        return { error: "API key is required" };
      }

      const { tournament, processedMatches } = await processCommunityTournamentData(tournamentId, communityId, apiKey);

      // Get tournament name if available, otherwise use the ID
      const tournamentName = tournament?.name || `Community_Tournament_${tournamentId}`;

      // Generate CSV
      const csvContent = convertToCSV(processedMatches, tournamentName);

      // Set headers for CSV download with a safe filename
      const safeFilename = `Community_${communityId}_${tournamentName.replace(/[^a-z0-9]/gi, '_')}`;
      set.headers = {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${safeFilename}.csv"`
      };
      // Add CORS headers explicitly to this response
      set.headers["Access-Control-Allow-Origin"] = "*";
      set.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
      set.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Authorization-Type";
      set.headers["Access-Control-Expose-Headers"] = "Content-Disposition";


      return csvContent;
    } catch (error) {
      set.status = 500;
      return { error: "Failed to process community tournament data", details: error instanceof Error ? error.message : String(error) };
    }
  })

  // Tournament points route for community tournaments (one row per player with points calculation)
  // Example: /simple-brackets/mytourney/community/test/points
  .get("/:tournamentId/community/:communityId/points", async ({ params, query, set }) => {
    try {
      const { tournamentId, communityId } = params;
      const apiKey = query.apiKey as string;

      if (!apiKey) {
        set.status = 401;
        return { error: "API key is required" };
      }

      const { tournament, processedMatches } = await processCommunityTournamentData(tournamentId, communityId, apiKey);

      // Get tournament name if available, otherwise use the ID
      const tournamentName = tournament?.name || `Community_Tournament_${tournamentId}`;

      // Calculate player points
      const playerStats = calculatePlayerPoints(tournament, processedMatches);

      // Generate CSV
      const csvContent = convertPlayerStatsToCSV(playerStats);

      // Set headers for CSV download with a safe filename
      const safeFilename = `Community_${communityId}_${tournamentName.replace(/[^a-z0-9]/gi, '_')}_Points`;
      set.headers = {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${safeFilename}.csv"`
      };
      // Add CORS headers explicitly to this response
      set.headers["Access-Control-Allow-Origin"] = "*";
      set.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
      set.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Authorization-Type";
      set.headers["Access-Control-Expose-Headers"] = "Content-Disposition";

      return csvContent;
    } catch (error) {
      set.status = 500;
      return { error: "Failed to process community tournament points data", details: error instanceof Error ? error.message : String(error) };
    }
  });
