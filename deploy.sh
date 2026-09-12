#!/bin/bash
# CHUGAZ Stationery - Auto Deploy Script
# Run this to deploy frontend to Vercel and backend to Railway
# Prerequisites: Install Vercel CLI and Railway CLI

echo "=== CHUGAZ Stationery Auto Deploy ==="

# Install Vercel CLI
echo "Installing Vercel CLI..."
cd frontend && npm install -g vercel --no-audit --no-fund

# Install Railway CLI
echo "Installing Railway CLI..."
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/railwayapp/cli/releases/latest/download/railway-windows-amd64.exe' -OutFile '$env:USERPROFILE\AppData\Local\Programs\railway.exe'"

# Deploy Frontend to Vercel
echo "Deploying frontend to Vercel..."
cd frontend && vercel --prod --yes

# Deploy Backend to Railway
echo "Deploying backend to Railway..."
railway init
railway up

echo "=== Deployment Complete ==="
echo "Check https://vercel.com for frontend URL"
echo "Check https://railway.app for backend URL"
