from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging
import os

from app.database import get_db
from app.models.message import Message
from app.websocket_manager import manager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="AlexMessenger Simple",
    description="Simple real-time chat with WebSocket and PostgreSQL",
    version="1.0.0"
)

# Get allowed origins from environment variable
FRONTEND_URL = os.getenv("FRONTEND_URL", "*")
allowed_origins = [FRONTEND_URL] if FRONTEND_URL != "*" else ["*"]

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """Root endpoint - health check"""
    return {"status": "ok", "message": "AlexMessenger API is running"}

@app.get("/api/messages")
async def get_messages(db: AsyncSession = Depends(get_db)):
    """Get all messages from database (message history)"""
    result = await db.execute(
        select(Message).order_by(Message.created_at.asc())
    )
    messages = result.scalars().all()
    return [msg.to_dict() for msg in messages]

@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db)
):
    """WebSocket endpoint for real-time messaging"""
    await manager.connect(websocket)

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_json()

            logger.info(f"Received message: {data}")

            # Extract username and content
            username = data.get("username", "Anonymous")
            content = data.get("content", "")

            if not content:
                continue  # Skip empty messages

            # Save message to database
            message = Message(
                username=username,
                content=content
            )
            db.add(message)
            await db.commit()
            await db.refresh(message)

            logger.info(f"Saved message to DB: {message.id}")

            # Broadcast message to all connected clients
            await manager.broadcast(message.to_dict())

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)
