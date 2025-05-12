# Challonge to CSV Exporter

A simple tool to export Challonge tournament data to CSV format.

## Features

- Simple API endpoints to export tournament data to CSV
- Support for both regular tournaments and community tournaments
- Detailed match data including:
  - Player names and IDs
  - Match scores and results
  - Round information
  - Tournament stages (group stages vs finals)
  - Match timestamps

## Getting Started

### Prerequisites

- [Bun runtime](https://bun.sh/)
- Challonge API key (obtained from your Challonge account)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```

## Development

To start the development server with auto-reload:

```bash
bun run dev
```

The server runs at http://localhost:3000/

## Usage

### API Endpoints

#### Export Tournament Data

```
GET /simple-brackets/{tournamentId}?apiKey=your_challonge_api_key
```

This endpoint fetches data for a regular tournament and returns it as a CSV file.

- `tournamentId`: The ID or URL of the tournament on Challonge
- `apiKey`: Your Challonge API key (required)

#### Export Community Tournament Data

```
GET /simple-brackets/{tournamentId}/community/{subdomain}?apiKey=your_challonge_api_key
```

This endpoint fetches tournament data from a Challonge community/subdomain.

- `tournamentId`: The ID or URL of the tournament
- `subdomain`: The subdomain of the community (e.g., "myteam" for "myteam.challonge.com")
- `apiKey`: Your Challonge API key (required)

### CSV Format

The exported CSV includes the following columns:

- Match ID, Round
- Player names and IDs
- Player scores and score difference
- Winner information
- Match state
- Tournament stage information (group stages, etc.)
- Match creation and update timestamps

## Built With

- [Elysia](https://elysiajs.com/) - Lightweight TypeScript framework
- [csv-stringify](https://www.npmjs.com/package/csv-stringify) - For CSV generation
- [Bun](https://bun.sh/) - JavaScript runtime and package manager