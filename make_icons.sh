#!/bin/bash

echo "🖼️  Prüfe auf app-icon.png..."

if [ ! -f "app-icon.png" ]; then
  echo "❌ FEHLER: Keine 'app-icon.png' im aktuellen Ordner gefunden!"
  echo "Bitte lege dein quadratisches Icon (z.B. 512x512) hier ab und starte das Skript neu."
  exit 1
fi

echo "📦 1. Kopiere Icon in den React public-Ordner..."
mkdir -p public
cp app-icon.png public/app-icon.png

echo "🛠️  2. Generiere native Tauri Icons (kann einen Moment dauern)..."
# Nutzt das offizielle Tauri CLI, um alle Formate für Linux, Windows und Mac zu erzeugen
npx @tauri-apps/cli icon app-icon.png

echo "✅ FERTIG! Alle Icons wurden in src-tauri/icons/ generiert."
echo "⚠️  WICHTIG: Wenn dein Icon vorher nicht 1:1 quadratisch war, öffne es kurz in einem Bildbearbeitungsprogramm, schneide es quadratisch zu und führe dieses Skript noch einmal aus!"
