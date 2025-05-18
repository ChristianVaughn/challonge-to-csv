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
  forfeited: boolean; // Added forfeited property

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
  scoreDifference: number | null;
  winner: string | null;
  state: string;
  groupStage: string | null;
  stageName: string | null;
  playOrder: number | null;
  createdAt: string;
  updatedAt: string;
  player1Id: string | null;
  player2Id: string | null;
  forfeited: boolean; // Added forfeited property
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
        player2Id: match.player2_id,
        forfeited: match.forfeited // Added forfeited property

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
        player2Id: match.player2_id,
        forfeited: match.forfeited
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
  // Create a map to store player statistics
  const playerStatsMap = new Map<string, PlayerStats>();

  // Get group stage matches and final stage matches
  const groupMatches = matches.filter(match => match.stageName === "Group Stage");
  const finalMatches = matches.filter(match => match.stageName === "Final Stage" || match.stageName === "Main Bracket");

  // Get unique players from all matches
  const players = new Set<string>();
  matches.forEach(match => {
    if (match.player1 && match.player1 !== "BYE") players.add(match.player1);
    if (match.player2 && match.player2 !== "BYE") players.add(match.player2);
  });

  // Initialize player stats
  players.forEach(player => {
    playerStatsMap.set(player, {
      event_id: tournament.id,
      player: player,
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

  // Calculate Swiss/Group stage stats
  if (groupMatches.length > 0) {
    // Count number of rounds in group stage to detect byes
    const groupRounds = new Set(groupMatches.map(match => match.round)).size;

    // Track current win streaks and total streak bonuses
    const winStreaks = new Map<string, number>();
    const totalStreakBonuses = new Map<string, number>();

    // Initialize streak tracking for all players
    players.forEach(player => {
      winStreaks.set(player, 0);
      totalStreakBonuses.set(player, 0);
    });

    // Process group matches by round to accurately track streaks
    const roundsMap = new Map<number, MatchWithPlayers[]>();
    groupMatches.forEach(match => {
      if (!roundsMap.has(match.round)) {
        roundsMap.set(match.round, []);
      }
      roundsMap.get(match.round)?.push(match);
    });

    // Process rounds in order
    [...roundsMap.keys()].sort().forEach(round => {
      const roundMatches = roundsMap.get(round) || [];

      roundMatches.forEach(match => {
        if (match.state !== "complete") return;

        const player1 = match.player1;
        const player2 = match.player2;

        // Skip if either player is "BYE" or not available
        if (!player1 || !player2 || player1 === "BYE" || player2 === "BYE") {
          // Handle bye matches - only count for bye calculation later
          return;
        }

        const winner = match.winner;
        const loser = winner === player1 ? player2 : player1;

        // Skip if no winner identified
        if (!winner || !loser) return;

        const isForfeit = match.forfeited === true;
        console.log(match)
        const hasScore = match.player1Score !== null && match.player2Score !== null;

        // 1. BYE (no score, not a forfeit)
        if (!isForfeit && !hasScore) {
          // Counts only toward the "bye" tally later – no other stats
          return;
        }

        // 2. FORFEIT
        if (isForfeit) {
          console.log(isForfeit)
          console.log("we in here boyo")
          // Winner: normal win, but NO streak increment
          const winnerStats = playerStatsMap.get(winner);
          if (winnerStats) {
            console.log(winnerStats);
            console.log("we were in hete inr the arspa")
            winnerStats.swiss_wins += 1;
            // Leave streak unchanged (don't increment for forfeit wins)
          }

          // Loser: 0 points, streak broken; do NOT add to loss counters
          winStreaks.set(loser, 0);
          return; // Done with this match
        }

        // 3. PLAYED MATCH
        const winnerStats = playerStatsMap.get(winner);
        if (winnerStats) {
          winnerStats.swiss_wins += 1;

          // Update win streak
          const currentStreak = winStreaks.get(winner) || 0;
          const newStreak = currentStreak + 1;
          winStreaks.set(winner, newStreak);

          // If streak reaches 2 or more, add 0.5 to streak bonus
          if (newStreak >= 2) {
            // Only add bonus when reaching a new streak milestone
            if (newStreak > currentStreak && currentStreak >= 1) {
              const currentBonus = totalStreakBonuses.get(winner) || 0;
              totalStreakBonuses.set(winner, currentBonus + 0.5);
            }
          }
        }

        const loserStats = playerStatsMap.get(loser);
        if (loserStats) {
          if (match.scoreDifference !== null && match.scoreDifference <= 2) {
            loserStats.swiss_close_losses += 1;
          } else {
            loserStats.swiss_losses += 1;
          }

          // Reset win streak
          winStreaks.set(loser, 0);
        }
      });
    });

    // Apply accumulated streak bonuses to player stats
    players.forEach(player => {
      const stats = playerStatsMap.get(player);
      const totalBonus = totalStreakBonuses.get(player) || 0;
      if (stats) {
        stats.streak_bonus = totalBonus;
      }
    });

    // Calculate byes based on number of matches played vs total group rounds
    players.forEach(player => {
      const stats = playerStatsMap.get(player);
      if (stats) {
        const playerMatches = groupMatches.filter(
          match => (match.player1 === player || match.player2 === player) && match.state === "complete"
        );

        // If player played fewer matches than rounds, they had byes
        const actualMatches = playerMatches.length;

        // Override calculated byes
        stats.byes = Math.max(0, groupRounds - actualMatches);
      }
    });

    // Wipe events for any player who never played a scored, non-forfeit game
    players.forEach(player => {
      const stats = playerStatsMap.get(player);
      if (stats) {
        const everPlayed = matches.some(
          match => (match.player1 === player || match.player2 === player) &&
            match.state === "complete" &&
            match.forfeited !== true &&
            ((match.player1Score !== null && match.player2Score !== null) ||
              (match.scoreDifference !== null))
        );

        if (!everPlayed) {
          // Reset all stats to 0 for players who never played a real game
          stats.swiss_wins = 0;
          stats.swiss_losses = 0;
          stats.swiss_close_losses = 0;
          stats.byes = 0;
          stats.streak_bonus = 0;
          stats.finals_points = 0;
          stats.event_total = 0;
        }
      }
    });
  }

  // Calculate finals placement and points (unchanged)
  if (finalMatches.length > 0) {
    // Get participants with final ranks
    const finalists = tournament.participants
      .map(p => p.participant)
      .filter(p => p.final_rank !== undefined)
      .sort((a, b) => (a.final_rank || 999) - (b.final_rank || 999));

    // Assign finals points based on placement
    finalists.forEach(finalist => {
      const playerName = finalist.name;
      const stats = playerStatsMap.get(playerName);

      if (stats && finalist.final_rank !== undefined) {
        stats.finals_place = finalist.final_rank;

        // Assign points based on placement
        if (finalist.final_rank === 1) {
          stats.finals_points = 6; // 1st place: +6 points
        } else if (finalist.final_rank === 2) {
          stats.finals_points = 4; // 2nd place: +4 points
        } else if (finalist.final_rank === 3) {
          stats.finals_points = 3; // 3rd place: +3 points
        } else if (finalist.final_rank === 4) {
          stats.finals_points = 2; // 4th-8th place: +2 points
        } else if (finalist.final_rank >= 5 && finalist.final_rank <= 8) {
          stats.finals_points = 1; // 4th-8th place: +2 points
        }
      }
    });
  }

  // Calculate total points
  players.forEach(player => {
    const stats = playerStatsMap.get(player);
    if (stats) {
      // Swiss Rounds points
      // Win: +3 points
      const swissWinsPoints = stats.swiss_wins * 3;

      // Close Loss (≤2 pt difference): +1.5 points
      const closeLossPoints = stats.swiss_close_losses * 1.5;

      // Loss: +0.5 points
      const lossPoints = stats.swiss_losses * 0.5;

      // Consecutive Wins Bonus: +0.5 per win in a streak
      const streakPoints = stats.streak_bonus;

      // Byes: +3 points
      const byePoints = stats.byes * 3;

      // Finals points already calculated
      const finalsPoints = stats.finals_points;

      // Calculate total
      stats.event_total = swissWinsPoints + closeLossPoints + lossPoints + streakPoints + byePoints + finalsPoints;
    }
  });

  // Convert map to array and sort by total points (highest first)
  return Array.from(playerStatsMap.values())
    .sort((a, b) => b.event_total - a.event_total);
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
