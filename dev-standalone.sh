#!/bin/bash

# Sitrec Standalone Development Server
# This script builds and runs Sitrec with a Node.js server for testing

echo "🚀 Starting Sitrec Standalone Development Server..."
echo ""

# Check if PHP is available
if ! command -v php &> /dev/null; then
    echo "❌ PHP is not installed or not in PATH"
    echo "   Please install PHP to run the backend server"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed or not in PATH"
    exit 1
fi

echo "✅ PHP version: $(php -v | head -n 1)"
echo "✅ Node.js version: $(node -v)"
echo ""

# Build the standalone version
echo "📦 Building Sitrec..."
npm run build-standalone

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo ""
echo "🎉 Build successful!"
echo ""

# Start the server
echo "🌐 Starting servers..."
npm run start-standalone