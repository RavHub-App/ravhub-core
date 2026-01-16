#!/bin/bash

# Script to generate RSA key pair for license signing
# Run once during initial setup

set -e

KEYS_DIR=".keys"
PRIVATE_KEY="$KEYS_DIR/private.pem"
PUBLIC_KEY="$KEYS_DIR/public.pem"

echo "🔐 Generating RSA key pair for license signing..."

# Create keys directory
mkdir -p "$KEYS_DIR"

# Check if keys already exist
if [ -f "$PRIVATE_KEY" ] && [ -f "$PUBLIC_KEY" ]; then
    echo "⚠️  Keys already exist in $KEYS_DIR/"
    read -p "Do you want to regenerate them? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "✅ Using existing keys"
        exit 0
    fi
fi

# Generate private key (RSA 2048-bit)
openssl genrsa -out "$PRIVATE_KEY" 2048

# Generate public key from private key
openssl rsa -in "$PRIVATE_KEY" -outform PEM -pubout -out "$PUBLIC_KEY"

# Set restrictive permissions
chmod 600 "$PRIVATE_KEY"
chmod 644 "$PUBLIC_KEY"

echo "✅ Keys generated successfully!"
echo ""
echo "Private key: $PRIVATE_KEY (KEEP SECRET)"
echo "Public key:  $PUBLIC_KEY"
echo ""
echo "Next steps:"
echo "1. Add private key to license-portal/.env.local:"
echo "   LICENSE_PRIVATE_KEY=\"\$(cat $PRIVATE_KEY | awk '{printf \"%s\\\\n\", \$0}')\""
echo ""
echo "2. Add public key to product docker-compose:"
echo "   LICENSE_PUBLIC_KEY: |"
echo "     \$(cat $PUBLIC_KEY)"
echo ""
echo "⚠️  NEVER commit $PRIVATE_KEY to git!"
echo "⚠️  In production, rotate keys periodically"
