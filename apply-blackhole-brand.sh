#!/bin/bash
echo "Applying Blackhole Rebrand..."

# --- Rebrand Moonlight Web Stream (Proxy) ---
echo "Rebranding Proxy Engine..."
PROXY_WEB="/Users/mac/moonlight-web-stream/web"
cp /Users/mac/DarkExplorer/blackhole.svg "$PROXY_WEB/resources/moonlight.svg"

# Replace User-Facing Text in TS Locales (only strings)
sed -i '' 's/appTitle: "Moonlight Web"/appTitle: "Blackhole"/g' "$PROXY_WEB/locales/en.ts"
sed -i '' 's/moonlightClientId: "Moonlight Client Id"/moonlightClientId: "Client Unique Id"/g' "$PROXY_WEB/locales/en.ts"

# Replace User-Facing Text in HTML
find "$PROXY_WEB" -name "*.html" -type f -exec sed -i '' 's/<title>Moonlight<\/title>/<title>Blackhole<\/title>/g' {} +
sed -i '' 's/Moonlight Web/Blackhole/g' "$PROXY_WEB/index.ts"
sed -i '' 's/Moonlight Web/Blackhole/g' "$PROXY_WEB/admin.ts"
sed -i '' 's/Moonlight/Blackhole/g' "$PROXY_WEB/manifest.json"

# Rebuild proxy
cd /Users/mac/moonlight-web-stream && npm run build-light

# --- Rebrand Sunshine App ---
echo "Rebranding Sunshine App..."
SUNSHINE_RES="/Applications/Sunshine.app/Contents/Resources"
SUNSHINE_WEB="$SUNSHINE_RES/assets/web"

if [ -d "$SUNSHINE_WEB" ]; then
    # Replace the Sunshine logo with proper PNG
    cp /Users/mac/DarkExplorer/blackhole.png "$SUNSHINE_RES/assets/box.png"
    
    # Hide the footer links (Donate, Moonlight Community, etc) in all HTML files
    find "$SUNSHINE_WEB" -name "*.html" -type f -exec sed -i '' 's/<footer.*/<footer style="display:none !important;">/g' {} +
    
    # Replace "Sunshine" with "Blackhole" in HTML, JS, and JSON files
    find "$SUNSHINE_WEB" -type f \( -name "*.html" -o -name "*.js" -o -name "*.json" \) -exec sed -i '' 's/Sunshine/Blackhole/g' {} +
    find "$SUNSHINE_WEB" -type f \( -name "*.html" -o -name "*.js" -o -name "*.json" \) -exec sed -i '' 's/sunshine/blackhole/g' {} +

    # Rename CSS and change theme colors
    if [ -f "$SUNSHINE_WEB/assets/css/sunshine.css" ]; then
        mv "$SUNSHINE_WEB/assets/css/sunshine.css" "$SUNSHINE_WEB/assets/css/blackhole.css"
    fi
    
    BLACKHOLE_CSS="$SUNSHINE_WEB/assets/css/blackhole.css"
    if [ -f "$BLACKHOLE_CSS" ]; then
        sed -i '' 's/--bg-color: #1e1e2e;/--bg-color: #050b14;/g' "$BLACKHOLE_CSS"
        sed -i '' 's/--primary-color: #89b4fa;/--primary-color: #3b82f6;/g' "$BLACKHOLE_CSS"
        
        # Inject custom CSS to forcefully hide unwanted elements
        echo "
/* Hide Featured Tab in Navbar */
a[href*=\"featured\"] { display: none !important; }
/* Hide Resources and Legal sections */
.resource-card { display: none !important; }
" >> "$BLACKHOLE_CSS"
    fi

    # Explicitly hide the Resource-Card in the index.html template
    if [ -f "$SUNSHINE_WEB/index.html" ]; then
        sed -i '' 's/<Resource-Card><\/Resource-Card>/<div style="display:none !important;"><Resource-Card><\/Resource-Card><\/div>/g' "$SUNSHINE_WEB/index.html"
    fi
fi

# Rebrand macOS App Bundle Metadata
INFO_PLIST="/Applications/Sunshine.app/Contents/Info.plist"
if [ -f "$INFO_PLIST" ]; then
    sed -i '' 's/<string>Sunshine<\/string>/<string>Blackhole<\/string>/g' "$INFO_PLIST"
    sed -i '' 's/Sunshine requires access/Blackhole requires access/g' "$INFO_PLIST"
fi

# Apply the proper macOS App Icon (.icns)
cp /Users/mac/DarkExplorer/blackhole.icns "$SUNSHINE_RES/sunshine.icns" || true
touch /Applications/Sunshine.app

echo "Blackhole rebrand applied successfully! If you update from upstream, simply run this script again."
