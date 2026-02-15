# AlexMessenger - Simple Real-time Chat

A minimal real-time messaging application built with FastAPI (backend) and Next.js (frontend), featuring WebSocket communication and PostgreSQL database storage.

## Features

- 🚀 Real-time messaging via WebSocket
- 💾 Message persistence in PostgreSQL
- 🎨 Clean, responsive UI with Tailwind CSS
- 📱 No authentication required - just enter a username and chat
- ☁️ Ready for deployment on Railway (backend) and Vercel (frontend)

## Tech Stack

**Backend:**
- Python 3.12
- FastAPI
- WebSocket
- SQLAlchemy 2.0 (async)
- PostgreSQL
- Alembic (migrations)

**Frontend:**
- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Native WebSocket API

## Local Development

### Prerequisites

- Python 3.12+
- Node.js 18+
- Docker Desktop (for PostgreSQL)

### 1. Start PostgreSQL

```bash
docker-compose up -d
```

This starts a PostgreSQL database on `localhost:5432`.

### 2. Setup Backend

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --reload --port 8000
```

Backend will be available at `http://localhost:8000`

### 3. Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Copy environment variables
cp .env.local.example .env.local

# Start the dev server
npm run dev
```

Frontend will be available at `http://localhost:3000`

## Testing Locally

1. Open http://localhost:3000 in your browser
2. Enter a username (e.g., "Alice")
3. Type a message and click Send
4. Open another browser tab/window
5. Enter a different username (e.g., "Bob")
6. You should see Alice's messages
7. Send messages from both tabs to see real-time updates

## Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/chatdb
```

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
```

## Deployment

### Backend on Railway

1. Create a new project on Railway
2. Add a PostgreSQL database
3. Deploy the `backend` directory
4. Railway will automatically detect the `Procfile`
5. Set environment variable:
   - `DATABASE_URL` (automatically set by Railway Postgres)

### Frontend on Vercel

1. Create a new project on Vercel
2. Import your repository
3. Set root directory to `frontend`
4. Set environment variables:
   - `NEXT_PUBLIC_API_URL=https://your-backend.railway.app`
   - `NEXT_PUBLIC_WS_URL=wss://your-backend.railway.app/ws`
5. Deploy

## Project Structure

```
/
├── backend/
│   ├── app/
│   │   ├── models/
│   │   │   └── message.py          # Database model
│   │   ├── database.py             # Database connection
│   │   ├── websocket_manager.py    # WebSocket connection manager
│   │   └── main.py                 # FastAPI application
│   ├── alembic/
│   │   └── versions/               # Database migrations
│   ├── requirements.txt
│   └── Procfile                    # Railway deployment
├── frontend/
│   ├── app/
│   │   ├── page.tsx                # Main chat UI
│   │   └── layout.tsx              # Root layout
│   ├── hooks/
│   │   └── useWebSocket.ts         # WebSocket hook
│   ├── lib/
│   │   └── api.ts                  # API client
│   ├── types/
│   │   └── message.ts              # TypeScript types
│   └── package.json
├── docker-compose.yml              # Local PostgreSQL
└── README.md
```

## API Endpoints

### REST API

- `GET /` - Health check
- `GET /api/messages` - Get message history

### WebSocket

- `WS /ws` - WebSocket endpoint
  - Send: `{username: string, content: string}`
  - Receive: `{id: number, username: string, content: string, created_at: string}`

## Database Schema

### messages table
- `id` - Integer (Primary Key, Auto-increment)
- `username` - VARCHAR(100) - Sender's name
- `content` - TEXT - Message content
- `created_at` - TIMESTAMP - Message timestamp

## License

MIT
