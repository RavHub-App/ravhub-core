#!/bin/bash

# Script para generar claves RSA y hashes para el sistema de licencias
# Uso: ./generate-license-keys.sh

set -e

echo "🔐 Generador de Claves para Sistema de Licencias JWT"
echo "=================================================="
echo ""

# Crear directorio para claves si no existe
mkdir -p ./keys

# Generar clave privada (4096 bits para máxima seguridad)
echo "📝 Generando clave privada RSA (4096 bits)..."
openssl genrsa -out ./keys/private_key.pem 4096

# Extraer clave pública
echo "📝 Extrayendo clave pública..."
openssl rsa -in ./keys/private_key.pem -pubout -out ./keys/public_key.pem

# Calcular hash SHA-256 de la clave pública
echo "📝 Calculando hash SHA-256 de la clave pública..."
PUBLIC_KEY_HASH=$(sha256sum ./keys/public_key.pem | awk '{print $1}')

echo ""
echo "✅ Claves generadas exitosamente!"
echo ""
echo "=================================================="
echo "📋 CONFIGURACIÓN DEL PORTAL (services/license-portal)"
echo "=================================================="
echo ""
echo "Añade al .env.local del portal:"
echo ""
echo "LICENSE_PRIVATE_KEY=\"$(awk '{printf "%s\\n", $0}' ./keys/private_key.pem | sed 's/\\n$//')\""
echo ""
echo "=================================================="
echo "📋 CONFIGURACIÓN DEL PRODUCTO (apps/api)"
echo "=================================================="
echo ""
echo "Añade al .env del producto:"
echo ""
echo "LICENSE_PUBLIC_KEY=\"$(awk '{printf "%s\\n", $0}' ./keys/public_key.pem | sed 's/\\n$//')\""
echo ""
echo "LICENSE_PUBLIC_KEY_HASH=$PUBLIC_KEY_HASH"
echo ""
echo "=================================================="
echo "⚠️  SEGURIDAD"
echo "=================================================="
echo ""
echo "🔴 NUNCA compartas private_key.pem"
echo "🔴 NUNCA subas private_key.pem a git"
echo "🔴 NUNCA expongas private_key.pem en APIs"
echo ""
echo "🟢 Puedes compartir public_key.pem (se distribuye con el producto)"
echo "🟢 El hash es público (se embebe en el código)"
echo ""
echo "📁 Archivos generados en ./keys/"
echo "   - private_key.pem (4096 bits) - SECRETO"
echo "   - public_key.pem - Público"
echo ""
echo "🔄 Recomendación: Rotar claves cada 6-12 meses"
echo ""
