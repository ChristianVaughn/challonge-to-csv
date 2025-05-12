# Challonge to CSV Exporter

A tool to export Challonge tournament data to CSV format.

## Features
- OAuth authentication with Challonge
- CSV export of tournament matches and participant data
- Support for regular tournaments and community tournaments
- Detailed match data including scores, rounds, and tournament stages

## Getting Started

### Prerequisites
- Bun runtime
- Challonge API credentials

### Installation
1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```
3. Create a `.env` file with the following variables:
   ```
   CHALLONGE_CLIENT_ID=your_client_id
   CHALLONGE_CLIENT_SECRET=your_client_secret
   CHALLONGE_REDIRECT=http://localhost:3000/auth/challonge/callback
   ```

## Development
To start the development server run:
```bash
bun run dev
```

Open http://localhost:3000/ with your browser to see the result.

## Usage

### Simple API Key Endpoints (Recommended)

The simplified endpoints require only your Challonge API key as a query parameter:

#### Tournament Export
- Export tournament data: `/simple-brackets/{tournamentId}?apiKey=your_challonge_api_key`

#### Community Tournament Export
- Export tournament from a subdomain/community: `/simple-brackets/{tournamentId}/community/{subdomain}?apiKey=your_challonge_api_key`
- This accesses tournaments at `{subdomain}.challonge.com/{tournamentId}`
- Example: `/simple-brackets/my_tourney/community/myteam?apiKey=123` gets data from `myteam.challonge.com/my_tourney`

These simplified endpoints:
- Require only the API key - no OAuth authentication needed
- Work directly with the Challonge API v1
- Properly set the "Authorization" header to your API key and "Authorization-Type" to "v1"
- Return CSV files with tournament match data
- Support both regular and community tournaments

### Legacy OAuth-based Endpoints

#### OAuth Authentication (Browser-based)
1. Authenticate with Challonge by visiting: `/auth/challonge`
2. For community tournaments, you can authenticate with a specific community by visiting: `/auth/challonge/community/{communityId}`

#### OAuth Endpoints
- After authenticating: `/brackets/{tournamentId}`
- Community tournament data: `/brackets/{tournamentId}/community/{communityId}`

#### Communities
- View all your communities: `/communities`
- View details of a specific community: `/communities/{communityId}`

## Notes
- The exported CSV includes match data with player names, scores, tournament stages, and more.
- For community tournaments, you must log in via the community-specific authentication endpoint.