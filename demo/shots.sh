#!/bin/sh
# Screenshots with headless Chrome. URL hash #s=<scenario>&t=<turn> selects a view.
cd "$(dirname "$0")"; U="file://$PWD/index.html"
shot(){ google-chrome --headless=new --no-sandbox --hide-scrollbars --virtual-time-budget=2000 --window-size=$1 --screenshot=shots/$2.png "$U#$3" 2>/dev/null; }
shot 1280,1250 desktop-1-reship "s=1"
shot 1280,1250 desktop-2-injection "s=2"
shot 1280,1250 desktop-3-approval-voided "s=3&t=2"
shot 390,2300 mobile-3-approval-voided "s=3&t=2"
shot 390,2300 mobile-2-injection "s=2"
