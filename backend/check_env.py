#!/usr/bin/env python3
"""
Startup environment check for Railway deployment
"""
import os
import sys

def check_environment():
    """Check required environment variables"""
    print("=" * 50)
    print("AlexMessenger Backend - Environment Check")
    print("=" * 50)

    # Check Python version
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    print(f"✓ Python version: {python_version}")

    # Check DATABASE_URL
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        # Mask password for security
        masked_url = database_url
        if "@" in masked_url and ":" in masked_url:
            parts = masked_url.split("@")
            if ":" in parts[0]:
                user_pass = parts[0].split(":")
                if len(user_pass) >= 3:
                    masked_url = f"{user_pass[0]}:{user_pass[1]}:***@{parts[1]}"
        print(f"✓ DATABASE_URL is set: {masked_url[:50]}...")
    else:
        print("✗ DATABASE_URL is NOT set!")
        print("  Please set the DATABASE_URL environment variable on Railway")
        sys.exit(1)

    # Check PORT
    port = os.getenv("PORT", "Not set")
    print(f"✓ PORT: {port}")

    print("=" * 50)
    print("All environment checks passed!")
    print("=" * 50)

if __name__ == "__main__":
    check_environment()
