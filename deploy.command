#!/bin/bash
cd "/Users/madisonmoore/Projects/Honolulu Marathon training tracker/webapp"
git add -A
git commit -m "update - $(date '+%b %d %Y %H:%M')"
git push
echo ""
echo "✅ Live at:"
echo "https://projectmanager-army.github.io/health-app-tracker/"
echo ""
read -p "Press Enter to close..."
