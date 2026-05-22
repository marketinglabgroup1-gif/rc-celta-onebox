#!/bin/sh
# Double-click this file to launch the landing page.
# It starts the local server and opens the page in your browser.
# Keep the Terminal window that opens RUNNING while you use the form.
# To stop the server later: close that Terminal window or press Ctrl+C in it.

cd "$(dirname "$0")" || exit 1

PORT=3000

# Open the browser once the server is up.
( for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -s -o /dev/null "http://localhost:$PORT/"; then
        open "http://localhost:$PORT/"
        break
    fi
    sleep 1
  done ) &

echo "Starting the landing page server..."
echo "Leave this window open while using the form."
echo "When you're done, close this window."
echo

exec ./node server.js
